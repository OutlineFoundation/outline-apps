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

func isEquivalentAddrPort(addr1, addr2 netip.AddrPort) bool {
	return addr1.Addr().Unmap() == addr2.Addr().Unmap() && addr1.Port() == addr2.Port()
}

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

type dnsInterceptor struct {
	baseProxy             network.PacketProxy
	dnsProxy              network.PacketProxy
	resolverLinkLocalAddr netip.AddrPort
	resolverRemoteAddr    netip.AddrPort
}

// NewDNSInterceptor creates a PacketProxy that intercepts packets destined for resolverLinkLocalAddr
// and routes them to dnsProxy, remapping the destination to resolverRemoteAddr.
// All other packets are routed to baseProxy.
// In responses from dnsProxy, it remaps the source address from resolverRemoteAddr back to resolverLinkLocalAddr.
func NewDNSInterceptor(base network.PacketProxy, dns network.PacketProxy, resolverLinkLocalAddr, resolverRemoteAddr netip.AddrPort) (network.PacketProxy, error) {
	if base == nil {
		return nil, errors.New("base PacketProxy must be provided")
	}
	if dns == nil {
		return nil, errors.New("dns PacketProxy must be provided")
	}
	return &dnsInterceptor{
		// We use lazy proxies, so that we only create target sockets when needed.
		baseProxy:             &lazyPacketProxy{baseProxy: base},
		dnsProxy:              &lazyPacketProxy{baseProxy: dns},
		resolverLinkLocalAddr: resolverLinkLocalAddr,
		resolverRemoteAddr:    resolverRemoteAddr,
	}, nil
}

func (i *dnsInterceptor) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	// Open Questions:
	// - What happens if the association has a mix of dns and non dns writes?
	// - What error does the caller expects to close the association? Timeout? EOF? ErrClosed? I think we just need to
	//   close the receiver.
	//
	// Closing behavior
	//
	// On session end, we should close the PacketResponseReceiver, so the caller knows the session is over an can clean up.
	// In that case, we shouldn't receive any more writes, except due to race conditions. It should be enough to return ErrClosed.
	// The caller should start a new session if they want to use the same address again after close.
	//
	// We should react to closing signal from the caller too. Meaning, if our sender gets a close, we should close
	// the inner sender we created too. The response receiver should return ErrClosed on incoming packets after close.
	baseSender, err := i.baseProxy.NewSession(resp)
	if err != nil {
		return nil, err
	}

	dnsResp := &natResponseReceiver{
		PacketResponseReceiver: resp,
		localAddr:              i.resolverLinkLocalAddr,
		remoteAddr:             i.resolverRemoteAddr,
	}
	dnsSender, err := i.dnsProxy.NewSession(dnsResp)
	if err != nil {
		baseSender.Close()
		return nil, err
	}

	return &dnsInterceptorRequestSender{
		baseSender:            baseSender,
		dnsSender:             dnsSender,
		resolverLinkLocalAddr: i.resolverLinkLocalAddr,
		resolverRemoteAddr:    i.resolverRemoteAddr,
	}, nil
}

type dnsInterceptorRequestSender struct {
	closeMu               sync.Mutex
	isClosed              bool
	baseSender            network.PacketRequestSender
	dnsSender             network.PacketRequestSender
	resolverLinkLocalAddr netip.AddrPort
	resolverRemoteAddr    netip.AddrPort
}

func (s *dnsInterceptorRequestSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	s.closeMu.Lock()
	defer s.closeMu.Unlock()

	if s.isClosed {
		return 0, net.ErrClosed
	}

	if isEquivalentAddrPort(destination, s.resolverLinkLocalAddr) {
		return s.dnsSender.WriteTo(p, s.resolverRemoteAddr)
	}
	return s.baseSender.WriteTo(p, destination)
}

func (s *dnsInterceptorRequestSender) Close() error {
	s.closeMu.Lock()
	if s.isClosed {
		s.closeMu.Unlock()
		return net.ErrClosed
	}
	s.isClosed = true

	baseSender := s.baseSender
	s.baseSender = nil
	dnsSender := s.dnsSender
	s.dnsSender = nil

	s.closeMu.Unlock()

	// We close the underlying senders outside the lock, in case they are slow or try to write somehow.
	var joinError error
	if baseSender != nil {
		joinError = baseSender.Close()
	}
	if dnsSender != nil {
		joinError = errors.Join(joinError, dnsSender.Close())
	}
	return joinError
}

// natResponseReceiver is a simple PacketResponseReceiver that translates an external address to an internal one.
type natResponseReceiver struct {
	network.PacketResponseReceiver
	remoteAddr netip.AddrPort
	localAddr  netip.AddrPort
}

func (r *natResponseReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	if addr, ok := source.(*net.UDPAddr); ok && isEquivalentAddrPort(addr.AddrPort(), r.remoteAddr) {
		source = net.UDPAddrFromAddrPort(r.localAddr)
	}
	return r.PacketResponseReceiver.WriteFrom(p, source)
}
