// Copyright 2025 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package dnsintercept

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"sync"

	"golang.getoutline.org/sdk/network"
	"golang.getoutline.org/sdk/transport"
)

// NewDNSRedirectStreamDialer creates a StreamDialer to intercept and redirect TCP based DNS connections.
// It intercepts all TCP connection for `resolverLinkLocalAddr:53` and redirects them to `resolverRemoteAddr` via the `base` StreamDialer.
func NewDNSRedirectStreamDialer(base transport.StreamDialer, resolverLinkLocalAddr, resolverRemoteAddr netip.AddrPort) (transport.StreamDialer, error) {
	if base == nil {
		return nil, errors.New("base StreamDialer must be provided")
	}
	return transport.FuncStreamDialer(func(ctx context.Context, targetAddr string) (transport.StreamConn, error) {
		if dst, err := netip.ParseAddrPort(targetAddr); err == nil && isEquivalentAddrPort(dst, resolverLinkLocalAddr) {
			targetAddr = resolverRemoteAddr.String()
		}
		return base.DialStream(ctx, targetAddr)
	}), nil
}

// dnsRedirectPacketProxy wraps another PacketProxy to intercept and redirect DNS packets.
type dnsRedirectPacketProxy struct {
	baseProxy                                      network.PacketProxy
	resolverLinkLocalAddr, resolverRemoteAddr netip.AddrPort
}

type dnsRedirectPacketReqSender struct {
	network.PacketRequestSender
	fpp *dnsRedirectPacketProxy
}

// dnsRedirectPacketRespReceiver intercepts incoming packets from the remote DNS resolver.
// It remaps the source address from the remote resolver back to the local DNS address,
// and closes the underlying session after delivering the first DNS response to free the
// transport session immediately rather than waiting for the idle timeout.
type dnsRedirectPacketRespReceiver struct {
	network.PacketResponseReceiver
	fpp    *dnsRedirectPacketProxy
	once   sync.Once                   // ensures the session is closed at most once
	mu     sync.Mutex                  // protects sender; required for Go memory model correctness
	sender network.PacketRequestSender // the request sender to close after first DNS response
}

var _ network.PacketProxy = (*dnsRedirectPacketProxy)(nil)

// NewDNSRedirectPacketProxy creates a PacketProxy to intercept and redirect UDP based DNS packets.
// It intercepts all packets to `resolverLinkLocalAddr` and redirects them to `resolverRemoteAddr` via the `base` PacketProxy.
func NewDNSRedirectPacketProxy(base network.PacketProxy, resolverLinkLocalAddr, resolverRemoteAddr netip.AddrPort) (network.PacketProxy, error) {
	if base == nil {
		return nil, errors.New("base PacketProxy must be provided")
	}
	return &dnsRedirectPacketProxy{
		baseProxy:                  base,
		resolverLinkLocalAddr: resolverLinkLocalAddr,
		resolverRemoteAddr:    resolverRemoteAddr,
	}, nil
}

// NewSession implements PacketProxy.NewSession.
func (fpp *dnsRedirectPacketProxy) NewSession(resp network.PacketResponseReceiver) (_ network.PacketRequestSender, err error) {
	wrapper := &dnsRedirectPacketRespReceiver{PacketResponseReceiver: resp, fpp: fpp}
	baseSender, err := fpp.baseProxy.NewSession(wrapper)
	if err != nil {
		return nil, err
	}
	wrapper.mu.Lock()
	wrapper.sender = baseSender
	wrapper.mu.Unlock()
	return &dnsRedirectPacketReqSender{baseSender, fpp}, nil
}

// WriteTo intercepts outgoing DNS request packets.
// If a packet is destined for the local resolver, it remaps the destination to the remote resolver.
func (req *dnsRedirectPacketReqSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	if isEquivalentAddrPort(destination, req.fpp.resolverLinkLocalAddr) {
		destination = req.fpp.resolverRemoteAddr
	}
	return req.PacketRequestSender.WriteTo(p, destination)
}

// WriteFrom intercepts incoming DNS response packets.
// If a packet is received from the remote resolver, it remaps the source address to the local
// resolver and then closes the underlying session.  DNS is one-shot (one query, one response),
// so closing immediately frees the transport session rather than holding it open until the 30-second
// write-idle timeout, preventing resource exhaustion under sustained DNS load.
func (resp *dnsRedirectPacketRespReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	if addr, ok := source.(*net.UDPAddr); ok && isEquivalentAddrPort(addr.AddrPort(), resp.fpp.resolverRemoteAddr) {
		source = net.UDPAddrFromAddrPort(resp.fpp.resolverLinkLocalAddr)
		n, err := resp.PacketResponseReceiver.WriteFrom(p, source)
		resp.once.Do(func() {
			resp.mu.Lock()
			s := resp.sender
			resp.mu.Unlock()
			s.Close()
		})
		return n, err
	}
	return resp.PacketResponseReceiver.WriteFrom(p, source)
}
