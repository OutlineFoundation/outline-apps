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

// dnsForwardPacketProxy wraps another PacketProxy to close the session after the first response.
type dnsForwardPacketProxy struct {
	baseProxy network.PacketProxy
}

type dnsForwardPacketReqSender struct {
	network.PacketRequestSender
}

// dnsForwardPacketRespReceiver closes the underlying session after delivering the first packet
// to free the transport session immediately rather than waiting for the idle timeout.
type dnsForwardPacketRespReceiver struct {
	network.PacketResponseReceiver
	once   sync.Once                   // ensures the session is closed at most once
	mu     sync.Mutex                  // protects sender; required for Go memory model correctness
	sender network.PacketRequestSender // the request sender to close after first response
}

var _ network.PacketProxy = (*dnsForwardPacketProxy)(nil)

// NewDNSForwardPacketProxy creates a PacketProxy that closes the underlying session after the first response.
// This is useful for DNS-over-UDP which is one-shot.
func NewDNSForwardPacketProxy(base network.PacketProxy) (network.PacketProxy, error) {
	if base == nil {
		return nil, errors.New("base PacketProxy must be provided")
	}
	return &dnsForwardPacketProxy{
		baseProxy: base,
	}, nil
}

// NewSession implements PacketProxy.NewSession.
func (fpp *dnsForwardPacketProxy) NewSession(resp network.PacketResponseReceiver) (_ network.PacketRequestSender, err error) {
	wrapper := &dnsForwardPacketRespReceiver{PacketResponseReceiver: resp}
	baseSender, err := fpp.baseProxy.NewSession(wrapper)
	if err != nil {
		return nil, err
	}
	wrapper.mu.Lock()
	wrapper.sender = baseSender
	wrapper.mu.Unlock()
	return &dnsForwardPacketReqSender{baseSender}, nil
}

// WriteFrom intercepts incoming packets and closes the underlying session after the first one.
func (resp *dnsForwardPacketRespReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	n, err := resp.PacketResponseReceiver.WriteFrom(p, source)
	resp.once.Do(func() {
		resp.mu.Lock()
		s := resp.sender
		resp.mu.Unlock()
		s.Close()
	})
	return n, err
}
