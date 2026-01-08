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

	"golang.getoutline.org/sdk/network"
	"golang.getoutline.org/sdk/transport"
	"github.com/stretchr/testify/require"
)

// ----- forward StreamDialer tests -----

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
	local := netip.MustParseAddrPort("192.0.2.1:53")
	resolver := netip.MustParseAddrPort("8.8.8.8:53")

	_, err := WrapForwardStreamDialer(nil, local, resolver)
	require.Error(t, err)

	dialer, err := WrapForwardStreamDialer(sd, local, resolver)
	require.NoError(t, err)

	_, err = dialer.DialStream(context.TODO(), "192.0.2.1:53")
	require.Error(t, err)
	require.Equal(t, "8.8.8.8:53", sd.dialedAddr)

	_, err = dialer.DialStream(context.TODO(), "198.51.100.1:443")
	require.Error(t, err)
	require.Equal(t, "198.51.100.1:443", sd.dialedAddr)
}

// ----- forward PacketProxy tests -----

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

func TestWrapForwardPacketProxy(t *testing.T) {
	pp := &packetProxyWithGivenRequestSender{req: &lastDestPacketRequestSender{}}
	resp := &lastSourcePacketResponseReceiver{}

	local := netip.MustParseAddrPort("192.0.2.2:53")
	resolver := netip.MustParseAddrPort("8.8.4.4:53")
	resolverUDPAddr := net.UDPAddrFromAddrPort(resolver)
	nonResolver := netip.MustParseAddrPort("203.0.113.10:123")
	nonResolverUDPAddr := net.UDPAddrFromAddrPort(nonResolver)

	_, err := WrapForwardPacketProxy(nil, local, resolver)
	require.Error(t, err)

	fpp, err := WrapForwardPacketProxy(pp, local, resolver)
	require.NoError(t, err)

	req, err := fpp.NewSession(resp)
	require.NoError(t, err)

	n, err := req.WriteTo([]byte("request"), local)
	require.NoError(t, err)
	require.Equal(t, 7, n)
	require.Equal(t, resolver, pp.req.lastDst)

	n, err = req.WriteTo([]byte("request"), nonResolver)
	require.NoError(t, err)
	require.Equal(t, 7, n)
	require.Equal(t, nonResolver, pp.req.lastDst)

	require.NotNil(t, pp.resp)
	n, err = pp.resp.WriteFrom([]byte("response"), resolverUDPAddr)
	require.NoError(t, err)
	require.Equal(t, 8, n)
	require.Equal(t, net.UDPAddrFromAddrPort(local), resp.lastSrc)

	n, err = pp.resp.WriteFrom([]byte("response"), nonResolverUDPAddr)
	require.NoError(t, err)
	require.Equal(t, 8, n)
	require.Equal(t, nonResolverUDPAddr, resp.lastSrc)

	require.NoError(t, req.Close())
	require.True(t, pp.req.closed)
}
