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
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/network"
	"golang.getoutline.org/sdk/transport"
)

// ----- StreamDialer tests -----

type lastAddrStreamDialer struct {
	transport.StreamDialer
	dialedAddr string
}

func (d *lastAddrStreamDialer) DialStream(ctx context.Context, addr string) (transport.StreamConn, error) {
	d.dialedAddr = addr
	return nil, errors.New("not used in test")
}

func TestWrapForwardStreamDialer(t *testing.T) {
	sd := &lastAddrStreamDialer{}
	resolverLinkLocalAddr := netip.MustParseAddrPort("192.0.2.1:53")
	resolverRemoteAddr := netip.MustParseAddrPort("8.8.8.8:53")

	_, err := NewDNSRedirectStreamDialer(nil, resolverLinkLocalAddr, resolverRemoteAddr)
	require.Error(t, err)

	dialer, err := NewDNSRedirectStreamDialer(sd, resolverLinkLocalAddr, resolverRemoteAddr)
	require.NoError(t, err)

	_, err = dialer.DialStream(context.TODO(), "192.0.2.1:53")
	require.Error(t, err)
	require.Equal(t, "8.8.8.8:53", sd.dialedAddr)

	_, err = dialer.DialStream(context.TODO(), "198.51.100.1:443")
	require.Error(t, err)
	require.Equal(t, "198.51.100.1:443", sd.dialedAddr)
}

// ----- PacketProxy tests -----

type packetProxyWithGivenRequestSender struct {
	network.PacketProxy
	req  *lastDestPacketRequestSender
	resp network.PacketResponseReceiver
}

func (p *packetProxyWithGivenRequestSender) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	p.resp = resp
	return p.req, nil
}

type lastDestPacketRequestSender struct {
	lastDst netip.AddrPort
	closed  bool
}

func (s *lastDestPacketRequestSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	s.lastDst = destination
	return len(p), nil
}

func (s *lastDestPacketRequestSender) Close() error {
	s.closed = true
	return nil
}

type lastSourcePacketResponseReceiver struct {
	lastSrc    net.Addr
	lastPacket []byte
}

func (r *lastSourcePacketResponseReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	r.lastSrc = source
	r.lastPacket = make([]byte, len(p))
	copy(r.lastPacket, p)
	return len(p), nil
}

func (r *lastSourcePacketResponseReceiver) Close() error {
	return nil
}

func TestDNSInterceptor(t *testing.T) {
	basePP := &packetProxyWithGivenRequestSender{req: &lastDestPacketRequestSender{}}
	dnsPP := &packetProxyWithGivenRequestSender{req: &lastDestPacketRequestSender{}}
	resp := &lastSourcePacketResponseReceiver{}

	resolverLinkLocalAddr := netip.MustParseAddrPort("192.0.2.1:53")
	resolverRemoteAddr := netip.MustParseAddrPort("8.8.8.8:53")
	otherAddr := netip.MustParseAddrPort("1.1.1.1:443")

	interceptor, err := NewDNSInterceptor(basePP, dnsPP, resolverLinkLocalAddr, resolverRemoteAddr)
	require.NoError(t, err)

	req, err := interceptor.NewSession(resp)
	require.NoError(t, err)

	// Send to local DNS address -> should be remapped to remote DNS
	n, err := req.WriteTo([]byte("dns query"), resolverLinkLocalAddr)
	require.NoError(t, err)
	require.Equal(t, 9, n)
	require.Equal(t, resolverRemoteAddr, dnsPP.req.lastDst)
	require.Equal(t, netip.AddrPort{}, basePP.req.lastDst)

	// Receive from remote DNS -> should be remapped to local DNS
	require.NotNil(t, dnsPP.resp)
	n, err = dnsPP.resp.WriteFrom([]byte("dns response"), net.UDPAddrFromAddrPort(resolverRemoteAddr))
	require.NoError(t, err)
	require.Equal(t, 12, n)
	require.Equal(t, net.UDPAddrFromAddrPort(resolverLinkLocalAddr), resp.lastSrc)

	// Since it's a DNS session, it should close immediately after receiving the response.
	require.True(t, dnsPP.req.closed)

	// Try to write again to the closed DNS session
	_, err = req.WriteTo([]byte("another dns query"), resolverLinkLocalAddr)
	require.Error(t, err)
	require.ErrorIs(t, err, net.ErrClosed)

	// --- Test Regular Session ---
	resp2 := &lastSourcePacketResponseReceiver{}
	basePP.req = &lastDestPacketRequestSender{}

	req2, err := interceptor.NewSession(resp2)
	require.NoError(t, err)

	// Send to other address -> should go to base and NOT be remapped
	n, err = req2.WriteTo([]byte("http request"), otherAddr)
	require.NoError(t, err)
	require.Equal(t, 12, n)
	require.Equal(t, otherAddr, basePP.req.lastDst)

	require.NoError(t, req2.Close())
	require.True(t, basePP.req.closed)
}
