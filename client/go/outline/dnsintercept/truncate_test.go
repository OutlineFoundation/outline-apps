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
	"net/netip"
	"testing"

	"golang.org/x/net/dns/dnsmessage"

	"github.com/stretchr/testify/require"
)

func TestWrapTruncatePacketProxy(t *testing.T) {
	pp := &packetProxyWithGivenRequestSender{req: &lastDestPacketRequestSender{}}
	resp := &lastSourcePacketResponseReceiver{}

	local := netip.MustParseAddrPort("192.0.2.2:53")
	udpAddr := netip.MustParseAddrPort("203.0.113.10:123")

	_, err := WrapTruncatePacketProxy(nil, local)
	require.Error(t, err)

	tpp, err := WrapTruncatePacketProxy(pp, local)
	require.NoError(t, err)

	req, err := tpp.NewSession(resp)
	require.NoError(t, err)

	msg := dnsmessage.Message{
		Header: dnsmessage.Header{ID: 1234},
		Questions: []dnsmessage.Question{{
			Name:  dnsmessage.MustNewName("example.com."),
			Type:  dnsmessage.TypeA,
			Class: dnsmessage.ClassINET,
		}},
	}
	query, err := msg.Pack()
	require.NoError(t, err)

	_, err = req.WriteTo(query, local)
	require.NoError(t, err)
	require.NotNil(t, resp.lastPacket)

	var p dnsmessage.Parser
	header, err := p.Start(resp.lastPacket)
	require.NoError(t, err)
	require.True(t, header.Response)
	require.True(t, header.Truncated)

	_, err = req.WriteTo([]byte("not-a-dns-packet"), udpAddr)
	require.NoError(t, err)
	require.Equal(t, udpAddr, pp.req.lastDst)

	require.NoError(t, req.Close())
	require.True(t, pp.req.closed)
}
