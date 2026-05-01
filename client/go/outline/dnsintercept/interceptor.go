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
	"sync/atomic"

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

// NewSession implements PacketProxy.NewSession.
// It creates sessions on both the base proxy and the DNS proxy, and returns a sender
// that dispatches packets to the appropriate session based on destination.
func (i *dnsInterceptor) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	// Create session for base (non-DNS) traffic.
	baseSender, err := i.baseProxy.NewSession(resp)
	if err != nil {
		return nil, err
	}

	sentCount := new(int32)

	// Wrap the response receiver for DNS traffic to remap source addresses.
	dnsResp := &natResponseReceiver{
		PacketResponseReceiver: resp,
		localAddr:              i.resolverLinkLocalAddr,
		remoteAddr:             i.resolverRemoteAddr,
	}

	// Further wrap it to auto-close the session after the first response (if single-write).
	singleResp := &singleResponseReceiver{
		PacketResponseReceiver: dnsResp,
		sentCount:              sentCount,
	}

	// Create session for DNS traffic.
	dnsSender, err := i.dnsProxy.NewSession(singleResp)
	if err != nil {
		baseSender.Close()
		return nil, err
	}

	return &dnsInterceptorRequestSender{
		baseSender:            baseSender,
		dnsSender:             dnsSender,
		resolverLinkLocalAddr: i.resolverLinkLocalAddr,
		resolverRemoteAddr:    i.resolverRemoteAddr,
		sentCount:             sentCount,
	}, nil
}

// dnsInterceptorRequestSender handles dispatching of outgoing packets.
type dnsInterceptorRequestSender struct {
	closeMu               sync.Mutex
	isClosed              bool
	baseSender            network.PacketRequestSender
	dnsSender             network.PacketRequestSender
	resolverLinkLocalAddr netip.AddrPort
	resolverRemoteAddr    netip.AddrPort
	sentCount             *int32 // tracked to determine if we can auto-close on response
}

// WriteTo intercepts outgoing packets.
// If the destination is the link-local DNS address, it routes the packet to the DNS session
// and remaps the destination to the remote resolver address.
// All other packets are routed to the base session without modification.
func (s *dnsInterceptorRequestSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	s.closeMu.Lock()
	defer s.closeMu.Unlock()

	if s.isClosed {
		return 0, net.ErrClosed
	}

	if isEquivalentAddrPort(destination, s.resolverLinkLocalAddr) {
		atomic.AddInt32(s.sentCount, 1)
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

// singleResponseReceiver closes the inner receiver when a response is received and there was only one write.
type singleResponseReceiver struct {
	network.PacketResponseReceiver
	sentCount *int32
}

func (r *singleResponseReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	n, err := r.PacketResponseReceiver.WriteFrom(p, source)
	if atomic.LoadInt32(r.sentCount) == 1 {
		r.PacketResponseReceiver.Close()
	}
	return n, err
}
