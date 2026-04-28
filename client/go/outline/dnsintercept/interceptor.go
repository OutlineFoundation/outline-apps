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
	// Desired logic:
	// - Timeouts are always set on Writes. Set ReadDeadline to max(currentDeadline, Now() + timeout).
	// - The default timeout is 5m. for DNS, it's 17s.
	// - On sender WriteTo, call getSender(isDNS) to lazily create the session.
	// - On first read, if it's DNS, set deadline to Now() to end session.
	// - On timeout, close everything. Consider returning EOF the first time.
	//
	// Open Questions:
	// - should the timeout be in the underlying proxies instead? NewPacketProxyFromPacketListener
	//   uses PacketListenerProxy with a 30s idle timeout already. That way this dispatcher doesn't need to know
	//   the values.
	// - What happens if the association has a mix of dns and non dns writes?
	// - What error does the caller expects to close the association? Timeout? EOF? ErrClosed?
	//
	// Closing behavior
	//
	// On session end, we should close the PacketResponseReceiver, so the caller knows the session is over an can clean up.
	// In that case, we shouldn't receive any more writes, except due to race conditions. It should be enough to return ErrClosed.
	// The caller should start a new session if they want to use the same address again after close.
	//
	// We should react to closing signal from the caller too. Meaning, if our sender gets a close, we should close
	// the inner sender we created too. The response receiver should return ErrClosed on incoming packets after close.
	//
	// Timeouts (as used in https://github.com/OutlineFoundation/tunnel-server/blob/master/service/udp.go):
	// - default: 5m - A UDP NAT timeout of at least 5 minutes is recommended in RFC 4787 Section 4.3.
	// - DNS: 17s - shortest timeout, as required by RFC 5452 Section 10.
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
	// TODO(fortuna): use something like s.getDNSSession().WriteTo() and s.getForwardSession().WriteTo()
	// to create the session on demand.
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
