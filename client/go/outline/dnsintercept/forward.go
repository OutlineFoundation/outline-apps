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

// WrapForwardStreamDialer creates a StreamDialer to intercept and redirect TCP based DNS connections.
// It intercepts all TCP connection for `localIP:53` and redirects them to `resolverAddr` via the `base` StreamDialer.
func WrapForwardStreamDialer(base transport.StreamDialer, localAddr, resolverAddr netip.AddrPort) (transport.StreamDialer, error) {
	if base == nil {
		return nil, errors.New("base StreamDialer must be provided")
	}
	return transport.FuncStreamDialer(func(ctx context.Context, addr string) (transport.StreamConn, error) {
		if dst, err := netip.ParseAddrPort(addr); err == nil && isEquivalentAddrPort(dst, localAddr) {
			addr = resolverAddr.String()
		}
		return base.DialStream(ctx, addr)
	}), nil
}

// forwardPacketProxy wraps another PacketProxy to intercept and redirect DNS packets.
type forwardPacketProxy struct {
	base          network.PacketProxy
	local, resolv netip.AddrPort
}

type forwardPacketReqSender struct {
	network.PacketRequestSender
	fpp *forwardPacketProxy
}

// forwardPacketRespReceiver intercepts incoming packets from the remote DNS resolver.
// It remaps the source address from the remote resolver back to the local DNS address,
// and closes the underlying session after delivering the first DNS response to free the
// transport session immediately rather than waiting for the idle timeout.
type forwardPacketRespReceiver struct {
	network.PacketResponseReceiver
	fpp    *forwardPacketProxy
	once   sync.Once                   // ensures the session is closed at most once
	mu     sync.Mutex                  // protects sender; required for Go memory model correctness
	sender network.PacketRequestSender // the request sender to close after first DNS response
}

var _ network.PacketProxy = (*forwardPacketProxy)(nil)

// WrapForwardPacketProxy creates a PacketProxy to intercept and redirect UDP based DNS packets.
// It intercepts all packets to `localAddr` and redirecrs them to `resolverAddr` via the `base` PacketProxy.
func WrapForwardPacketProxy(base network.PacketProxy, localAddr, resolverAddr netip.AddrPort) (network.PacketProxy, error) {
	if base == nil {
		return nil, errors.New("base PacketProxy must be provided")
	}
	return &forwardPacketProxy{
		base:   base,
		local:  localAddr,
		resolv: resolverAddr,
	}, nil
}

// NewSession implements PacketProxy.NewSession.
func (fpp *forwardPacketProxy) NewSession(resp network.PacketResponseReceiver) (_ network.PacketRequestSender, err error) {
	wrapper := &forwardPacketRespReceiver{PacketResponseReceiver: resp, fpp: fpp}
	base, err := fpp.base.NewSession(wrapper)
	if err != nil {
		return nil, err
	}
	wrapper.mu.Lock()
	wrapper.sender = base
	wrapper.mu.Unlock()
	return &forwardPacketReqSender{base, fpp}, nil
}

// WriteTo intercepts outgoing DNS request packets.
// If a packet is destined for the local resolver, it remaps the destination to the remote resolver.
func (req *forwardPacketReqSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	if isEquivalentAddrPort(destination, req.fpp.local) {
		destination = req.fpp.resolv
	}
	return req.PacketRequestSender.WriteTo(p, destination)
}

// WriteFrom intercepts incoming DNS response packets.
// If a packet is received from the remote resolver, it remaps the source address to the local
// resolver and then closes the underlying session.  DNS is one-shot (one query, one response),
// so closing immediately frees the transport session rather than holding it open until the 30-second
// write-idle timeout, preventing resource exhaustion under sustained DNS load.
func (resp *forwardPacketRespReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	if addr, ok := source.(*net.UDPAddr); ok && isEquivalentAddrPort(addr.AddrPort(), resp.fpp.resolv) {
		source = net.UDPAddrFromAddrPort(resp.fpp.local)
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

