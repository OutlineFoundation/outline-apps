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
	"errors"
	"net"
	"net/netip"

	"golang.getoutline.org/sdk/network"
)

type dnsInterceptor struct {
	baseProxy             network.PacketProxy
	dnsProxy              network.PacketProxy
	resolverLinkLocalAddr netip.AddrPort
	resolverRemoteAddr    netip.AddrPort
}

type dnsInterceptorRequestSender struct {
	baseSender            network.PacketRequestSender
	dnsSender             network.PacketRequestSender
	resolverLinkLocalAddr netip.AddrPort
	resolverRemoteAddr    netip.AddrPort
}

type dnsInterceptorResponseReceiver struct {
	network.PacketResponseReceiver
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

func (i *dnsInterceptor) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	baseSender, err := i.baseProxy.NewSession(resp)
	if err != nil {
		return nil, err
	}
	dnsResp := &dnsInterceptorResponseReceiver{
		PacketResponseReceiver: resp,
		resolverLinkLocalAddr:  i.resolverLinkLocalAddr,
		resolverRemoteAddr:     i.resolverRemoteAddr,
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

func (s *dnsInterceptorRequestSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	if isEquivalentAddrPort(destination, s.resolverLinkLocalAddr) {
		return s.dnsSender.WriteTo(p, s.resolverRemoteAddr)
	}
	return s.baseSender.WriteTo(p, destination)
}

func (s *dnsInterceptorRequestSender) Close() error {
	return errors.Join(s.baseSender.Close(), s.dnsSender.Close())
}

func (r *dnsInterceptorResponseReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	if addr, ok := source.(*net.UDPAddr); ok && isEquivalentAddrPort(addr.AddrPort(), r.resolverRemoteAddr) {
		source = net.UDPAddrFromAddrPort(r.resolverLinkLocalAddr)
	}
	return r.PacketResponseReceiver.WriteFrom(p, source)
}
