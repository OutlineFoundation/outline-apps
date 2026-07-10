// Copyright 2026 The Outline Authors
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

package configregistry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/meta"
	"localhost/client/go/composer/netconfig"
)

func parseSD(t *testing.T, text string) (netconfig.StreamDialerConfig, *meta.Table) {
	t.Helper()
	tables := newRegistryTables(&transport.TCPDialer{}, &transport.UDPDialer{})
	node, err := composer.ParseYAML([]byte(text))
	require.NoError(t, err)
	ctx, table := meta.WithTable(context.Background())
	cfg, err := tables.streamDialers.Parse(ctx, node)
	require.NoError(t, err)
	return cfg, table
}

func TestRegistry_DirectFallbackInfo(t *testing.T) {
	cfg, table := parseSD(t, "")
	info, ok := meta.Get[ConnectionProviderInfo](table, cfg)
	require.True(t, ok)
	require.Equal(t, ConnectionProviderInfo{ConnTypeDirect, ""}, info)
}

func TestRegistry_ShadowsocksInfo(t *testing.T) {
	cfg, table := parseSD(t, `
$type: shadowsocks
endpoint: example.com:1234
cipher: chacha20-ietf-poly1305
secret: SECRET
`)
	info, ok := meta.Get[ConnectionProviderInfo](table, cfg)
	require.True(t, ok)
	require.Equal(t, ConnTypeTunneled, info.ConnType)
	require.Equal(t, "example.com:1234", info.FirstHop)
}

func TestRegistry_WebsocketOverShadowsocks(t *testing.T) {
	cfg, table := parseSD(t, `
$type: shadowsocks
cipher: chacha20-ietf-poly1305
secret: SECRET
endpoint:
  $type: websocket
  url: wss://cdn.example.com/tcp
`)
	info, ok := meta.Get[ConnectionProviderInfo](table, cfg)
	require.True(t, ok)
	require.Equal(t, ConnTypeTunneled, info.ConnType)
	// Websocket copies its inner (direct dial) endpoint's info: the
	// first hop is the CDN address.
	require.Equal(t, "cdn.example.com:443", info.FirstHop)
	// The websocket config carries the Outline User-Agent.
	ws := findWebsocket(cfg)
	require.NotNil(t, ws)
	require.NotEmpty(t, ws.Headers.Get("User-Agent"))
}

// findWebsocket digs the websocket config out of a shadowsocks dialer config.
func findWebsocket(cfg netconfig.StreamDialerConfig) *netconfig.WebsocketEndpointConfig {
	ss, ok := cfg.(*netconfig.ShadowsocksStreamDialerConfig)
	if !ok {
		return nil
	}
	ws, _ := ss.Endpoint.(*netconfig.WebsocketEndpointConfig)
	return ws
}

func TestRegistry_FirstSupportedPassthrough(t *testing.T) {
	cfg, table := parseSD(t, `
$type: first-supported
options:
  - $type: warp-drive
  - $type: block
`)
	info, ok := meta.Get[ConnectionProviderInfo](table, cfg)
	require.True(t, ok)
	require.Equal(t, ConnTypeBlocked, info.ConnType)
}

func TestRegistry_SSURLStringFallback(t *testing.T) {
	cfg, table := parseSD(t, `"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@example.com:1234"`)
	info, ok := meta.Get[ConnectionProviderInfo](table, cfg)
	require.True(t, ok)
	require.Equal(t, ConnTypeTunneled, info.ConnType)
	require.Equal(t, "example.com:1234", info.FirstHop)
	_ = cfg
}

func TestRegistry_MissingTableErrors(t *testing.T) {
	tables := newRegistryTables(&transport.TCPDialer{}, &transport.UDPDialer{})
	node, err := composer.ParseYAML([]byte("$type: block"))
	require.NoError(t, err)
	_, err = tables.streamDialers.Parse(context.Background(), node) // no table in ctx
	require.Error(t, err)
}
