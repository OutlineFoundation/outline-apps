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

type forwardPacketRespReceiver struct {
	network.PacketResponseReceiver
	fpp *forwardPacketProxy
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
	base, err := fpp.base.NewSession(&forwardPacketRespReceiver{resp, fpp})
	if err != nil {
		return nil, err
	}
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

// ReadFrom intercepts incoming DNS response packets.
// If a packet is received from the remote resolver, it remaps the source address to be the local resolver.
func (resp *forwardPacketRespReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	if addr, ok := source.(*net.UDPAddr); ok && isEquivalentAddrPort(addr.AddrPort(), resp.fpp.resolv) {
		source = net.UDPAddrFromAddrPort(resp.fpp.local)
	}
	return resp.PacketResponseReceiver.WriteFrom(p, source)
}
