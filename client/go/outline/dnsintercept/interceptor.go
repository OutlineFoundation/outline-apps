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
	"time"

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
		baseProxy:             base,
		dnsProxy:              dns,
		resolverLinkLocalAddr: resolverLinkLocalAddr,
		resolverRemoteAddr:    resolverRemoteAddr,
	}, nil
}

const (
	// Shorten timeout as required by RFC 5452 Section 10.
	dnsTimeout = 17 * time.Second
	// A UDP NAT timeout of at least 5 minutes is recommended in RFC 4787 Section 4.3.
	udpTimeout = 5 * time.Minute
)

type dnsInterceptorRequestSender struct {
	mu                    sync.Mutex
	interceptor           *dnsInterceptor
	respReceiver          *dnsInterceptorResponseReceiver
	activeSender          network.PacketRequestSender
	isDNS                 bool
	timer                 *time.Timer
	closed                bool
}

type dnsInterceptorResponseReceiver struct {
	network.PacketResponseReceiver
	mu                    sync.Mutex
	reqSender             *dnsInterceptorRequestSender
	resolverLinkLocalAddr netip.AddrPort
	resolverRemoteAddr    netip.AddrPort
	reqCount              int
	respCount             int
	closed                bool
}

func (i *dnsInterceptor) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	reqSender := &dnsInterceptorRequestSender{
		interceptor: i,
	}
	dnsResp := &dnsInterceptorResponseReceiver{
		PacketResponseReceiver: resp,
		reqSender:              reqSender,
		resolverLinkLocalAddr:  i.resolverLinkLocalAddr,
		resolverRemoteAddr:     i.resolverRemoteAddr,
	}
	reqSender.respReceiver = dnsResp
	return reqSender, nil
}

func (s *dnsInterceptorRequestSender) getOrCreateSenderLocked(destination netip.AddrPort) (network.PacketRequestSender, error) {
	if s.closed {
		return nil, net.ErrClosed
	}

	if s.activeSender != nil {
		return s.activeSender, nil
	}

	s.isDNS = isEquivalentAddrPort(destination, s.interceptor.resolverLinkLocalAddr)

	var err error
	if s.isDNS {
		s.activeSender, err = s.interceptor.dnsProxy.NewSession(s.respReceiver)
	} else {
		s.activeSender, err = s.interceptor.baseProxy.NewSession(s.respReceiver)
	}

	if err != nil {
		return nil, err
	}

	timeout := udpTimeout
	if s.isDNS {
		timeout = dnsTimeout
	}
	
	s.timer = time.AfterFunc(timeout, func() {
		s.Close()
	})

	return s.activeSender, nil
}

func (s *dnsInterceptorRequestSender) resetTimerLocked() {
	if s.timer != nil {
		timeout := udpTimeout
		if s.isDNS {
			timeout = dnsTimeout
		}
		s.timer.Reset(timeout)
	}
}

func (s *dnsInterceptorRequestSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	s.mu.Lock()
	sender, err := s.getOrCreateSenderLocked(destination)
	if err != nil {
		s.mu.Unlock()
		return 0, err
	}
	s.resetTimerLocked()
	isDNS := s.isDNS
	s.mu.Unlock()

	s.respReceiver.incrementReqCount()

	if isDNS {
		return sender.WriteTo(p, s.interceptor.resolverRemoteAddr)
	}
	return sender.WriteTo(p, destination)
}

func (s *dnsInterceptorRequestSender) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return net.ErrClosed
	}
	s.closed = true
	sender := s.activeSender
	if s.timer != nil {
		s.timer.Stop()
	}
	s.mu.Unlock()

	// Notify caller that the session is closed via the response receiver
	s.respReceiver.Close()

	if sender != nil {
		return sender.Close()
	}
	return nil
}

func (r *dnsInterceptorResponseReceiver) incrementReqCount() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reqCount++
}

func (r *dnsInterceptorResponseReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return 0, net.ErrClosed
	}

	r.reqSender.mu.Lock()
	r.reqSender.resetTimerLocked()
	isDNS := r.reqSender.isDNS
	r.reqSender.mu.Unlock()

	r.respCount++
	shouldClose := false
	if isDNS && r.respCount >= r.reqCount {
		shouldClose = true
	}
	r.mu.Unlock()

	if addr, ok := source.(*net.UDPAddr); ok && isEquivalentAddrPort(addr.AddrPort(), r.resolverRemoteAddr) {
		source = net.UDPAddrFromAddrPort(r.resolverLinkLocalAddr)
	}

	n, err := r.PacketResponseReceiver.WriteFrom(p, source)

	if shouldClose {
		r.reqSender.Close()
	}

	return n, err
}

func (r *dnsInterceptorResponseReceiver) Close() error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return net.ErrClosed
	}
	r.closed = true
	r.mu.Unlock()

	return r.PacketResponseReceiver.Close()
}
