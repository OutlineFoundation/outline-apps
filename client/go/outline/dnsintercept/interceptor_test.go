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
	"net"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/require"
)

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

	// Send to other address -> should go to base and NOT be remapped
	n, err = req.WriteTo([]byte("http request"), otherAddr)
	require.NoError(t, err)
	require.Equal(t, 12, n)
	require.Equal(t, otherAddr, basePP.req.lastDst)

	require.NoError(t, req.Close())
	require.True(t, basePP.req.closed)
	require.True(t, dnsPP.req.closed)
}
