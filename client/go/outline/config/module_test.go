// Copyright 2024 The Outline Authors
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

package config

import (
	"context"
	"fmt"
	"net"
	"testing"

	"localhost/client/go/configyaml"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
)

func newTestTransportProvider() *configyaml.TypeParser[*TransportPair] {
	tcpDialer := &transport.TCPDialer{Dialer: net.Dialer{KeepAlive: -1}}
	udpDialer := &transport.UDPDialer{}
	return NewDefaultTransportProvider(tcpDialer, udpDialer)
}

func TestRegisterDefaultProviders(t *testing.T) {
	provider := newTestTransportProvider()

	node, err := configyaml.ParseConfigYAML(`
$type: tcpudp
tcp: &shared
  $type: shadowsocks
  endpoint: example.com:1234
  cipher: chacha20-ietf-poly1305
  secret: SECRET
udp: *shared`)
	require.NoError(t, err)

	d, err := provider.Parse(context.Background(), node)
	require.NoError(t, err)

	require.NotNil(t, d.StreamDialer)
	require.NotNil(t, d.PacketProxy)
	require.Equal(t, "example.com:1234", d.StreamDialer.FirstHop)
	require.Equal(t, ConnTypeTunneled, d.StreamDialer.ConnType)
	require.Equal(t, "example.com:1234", d.PacketProxy.FirstHop)
	require.Equal(t, ConnTypeTunneled, d.PacketProxy.ConnType)
}

func TestRegisterParseURL(t *testing.T) {
	provider := newTestTransportProvider()

	node, err := configyaml.ParseConfigYAML(`ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpaTXJSMW92ZmRBaEQ@example.com:4321/#My%20Server`)
	require.NoError(t, err)

	d, err := provider.Parse(context.Background(), node)
	require.NoError(t, err)

	require.NotNil(t, d.StreamDialer)
	require.NotNil(t, d.PacketProxy)
	require.Equal(t, "example.com:4321", d.StreamDialer.FirstHop)
	require.Equal(t, ConnTypeTunneled, d.StreamDialer.ConnType)
	require.Equal(t, "example.com:4321", d.PacketProxy.FirstHop)
	require.Equal(t, ConnTypeTunneled, d.PacketProxy.ConnType)
}

func TestRegisterParseURLInQuotes(t *testing.T) {
	provider := newTestTransportProvider()

	node, err := configyaml.ParseConfigYAML(`"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpaTXJSMW92ZmRBaEQ@example.com:4321/#My%20Server"`)
	require.NoError(t, err)

	d, err := provider.Parse(context.Background(), node)
	require.NoError(t, err)

	require.NotNil(t, d.StreamDialer)
	require.NotNil(t, d.PacketProxy)
	require.Equal(t, "example.com:4321", d.StreamDialer.FirstHop)
	require.Equal(t, ConnTypeTunneled, d.StreamDialer.ConnType)
	require.Equal(t, "example.com:4321", d.PacketProxy.FirstHop)
	require.Equal(t, ConnTypeTunneled, d.PacketProxy.ConnType)
}

type errorStreamDialer struct {
	name string
}

func (d *errorStreamDialer) DialStream(ctx context.Context, addr string) (transport.StreamConn, error) {
	return nil, fmt.Errorf("dialer '%s' called for address '%s'", d.name, addr)
}

func TestParseIPTableTCP(t *testing.T) {
	tp := NewDefaultTransportProvider(
		&errorStreamDialer{name: "default-tcp"},
		nil, // UDP transport not under test.
	)

	yamlConfig := `$type: tcpudp
tcp:
  $type: iptable
  table:
    - ips:
        - 192.168.1.128
      dialer: &shared
        $type: shadowsocks
        endpoint: example.com:1234
        cipher: chacha20-ietf-poly1305
        secret: SECRET
    - ips:
        - 2001:db8:1:1::/64
      dialer: *shared
udp: null`

	node, err := configyaml.ParseConfigYAML(yamlConfig)
	require.NoError(t, err)

	transportPair, err := tp.Parse(context.Background(), node)
	require.NoError(t, err)
	require.NotNil(t, transportPair.StreamDialer, "StreamDialer should be configured")

	_, err = transportPair.DialStream(context.Background(), "192.168.1.128:12345")
	require.Error(t, err)
	require.Contains(t, err.Error(), "dialer 'default-tcp' called for address 'example.com:1234'", "Traffic to proxy IP should use the default mock dialer via shadowsocks config")

	_, err = transportPair.DialStream(context.Background(), "[2001:db8:1:1::a:b]:443")
	require.Error(t, err)
	require.Contains(t, err.Error(), "dialer 'default-tcp' called for address 'example.com:1234'", "Traffic to proxy IPv6 should use the default mock dialer")

	_, err = transportPair.DialStream(context.Background(), "8.8.8.8:53")
	require.Error(t, err)
	require.Contains(t, err.Error(), "no dialer available for address 8.8.8.8:53")
}

func TestParseDefaultAndBlockTCP(t *testing.T) {
	provider := newTestTransportProvider()
	ctx := context.Background()

	t.Run("direct", func(t *testing.T) {
		node, err := configyaml.ParseConfigYAML(`
$type: tcpudp
tcp:
  $type: direct
udp: null`)
		require.NoError(t, err)

		transportPair, err := provider.Parse(ctx, node)
		require.NoError(t, err)
		require.NotNil(t, transportPair)
		require.NotNil(t, transportPair.StreamDialer)
		require.Equal(t, ConnTypeDirect, transportPair.StreamDialer.ConnType)
	})

	t.Run("block", func(t *testing.T) {
		node, err := configyaml.ParseConfigYAML(`
$type: tcpudp
tcp:
  $type: block
udp: null`)
		require.NoError(t, err)

		transportPair, err := provider.Parse(ctx, node)
		require.NoError(t, err)
		require.NotNil(t, transportPair)
		require.NotNil(t, transportPair.StreamDialer)
		require.Equal(t, ConnTypeBlocked, transportPair.StreamDialer.ConnType)

		_, err = transportPair.StreamDialer.Dial(ctx, "example.com:123")
		require.Error(t, err)
		require.Equal(t, "blocked by config", err.Error())
	})
}

func TestIPTableEndpointParsingBugFailing(t *testing.T) {
	provider := newTestTransportProvider()
	ctx := context.Background()

	// Test the failing configuration from the bug report.
	failingConfig := `
$type: tcpudp
tcp:
  $type: iptable
  table:
    - ips:
        - 34.117.59.0/24
      dialer:
        $type: shadowsocks
        endpoint: sub.domain.com:443
        cipher: chacha20-ietf-poly1305
        secret: xf0Wzuz5NyAUaCV95q4p9N
  fallback:
    $type: direct
udp:
  $type: shadowsocks
  endpoint: sub.domain.com:443
  cipher: chacha20-ietf-poly1305
  secret: xf0Wzuz5NyAUaCV95q4p9N
`
	failingNode, err := configyaml.ParseConfigYAML(failingConfig)
	require.NoError(t, err)

	transportPair, err := provider.Parse(ctx, failingNode)
	require.NoError(t, err)
	require.NotNil(t, transportPair)
	require.NotNil(t, transportPair.StreamDialer)
	fmt.Printf("Parsed Failing Config StreamDialer: %+v\n", transportPair.StreamDialer)
	require.Equal(t, "sub.domain.com:443", transportPair.StreamDialer.FirstHop)
}

func TestIPTableEndpointParsingBugWorking(t *testing.T) {
	provider := newTestTransportProvider()
	ctx := context.Background()

	// Test the working configuration from the bug report.
	workingConfig := `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint: sub.domain.com:443
  cipher: chacha20-ietf-poly1305
  secret: xf0Wzuz5NyAUaCV95q4p9N
udp:
  $type: shadowsocks
  endpoint: sub.domain.com:443
  cipher: chacha20-ietf-poly1305
  secret: xf0Wzuz5NyAUaCV95q4p9N
`
	workingNode, err := configyaml.ParseConfigYAML(workingConfig)
	require.NoError(t, err)

	transportPair, err := provider.Parse(ctx, workingNode)
	require.NoError(t, err)
	require.NotNil(t, transportPair)
	require.NotNil(t, transportPair.StreamDialer)
	fmt.Printf("Parsed Working Config StreamDialer: %+v\n", transportPair.StreamDialer)
	require.Equal(t, "sub.domain.com:443", transportPair.StreamDialer.FirstHop)
}

func TestIPTableEndpointParsingBugFailing2(t *testing.T) {
	provider := newTestTransportProvider()
	ctx := context.Background()

	// Test the working configuration from the bug report.
	workingConfig := `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint: '140.245.119.11:80'
  cipher: chacha20-ietf-poly1305
  secret: abcd
udp:
  $type: shadowsocks
  endpoint: '140.245.119.11:443'
  cipher: chacha20-ietf-poly1305
  secret: abcd
`
	workingNode, err := configyaml.ParseConfigYAML(workingConfig)
	require.NoError(t, err)
	transportPair, err := provider.Parse(ctx, workingNode)
	require.NoError(t, err)
	require.NotNil(t, transportPair)
	require.NotNil(t, transportPair.StreamDialer)
	fmt.Printf("Parsed Working Config StreamDialer: %+v\n", transportPair.StreamDialer)
	require.Equal(t, "140.245.119.11:80", transportPair.StreamDialer.FirstHop)
}
