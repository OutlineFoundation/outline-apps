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

package netconfig

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
	"localhost/client/go/composer/registry"
)

func parseRegistered[Cfg any](t *testing.T, r registry.Composer, kind registry.Kind[Cfg], yaml string) Cfg {
	t.Helper()
	node, err := composer.ParseYAML([]byte(yaml))
	require.NoError(t, err)
	cfg, err := registry.Parser(r, kind)(context.Background(), node)
	require.NoError(t, err)
	return cfg
}

func TestRegisterDirectUsesCallerNameAndInjectedConfigs(t *testing.T) {
	r := registry.New()
	stream := NewDirectStreamDialerConfig(nil)
	packet := NewDirectPacketDialerConfig(nil)
	listener := NewDirectPacketListenerConfig(nil)
	require.NoError(t, RegisterDirect(r, "plain", stream, packet, listener))

	require.Same(t, stream, parseRegistered(t, r, StreamDialerKind, "$type: plain"))
	require.Same(t, packet, parseRegistered(t, r, PacketDialerKind, "$type: plain"))
	require.Same(t, listener, parseRegistered(t, r, PacketListenerKind, "$type: plain"))
}

func TestRegisterDirectRejectsRequiredFields(t *testing.T) {
	r := registry.New()
	stream := NewDirectStreamDialerConfig(nil)
	packet := NewDirectPacketDialerConfig(nil)
	listener := NewDirectPacketListenerConfig(nil)
	require.NoError(t, RegisterDirect(r, "plain", stream, packet, listener))
	require.NoError(t, RegisterBlock(r, "deny"))

	node, err := composer.ParseYAML([]byte(`
$type: first-supported
options:
  - $type: plain
    required_policy: true
  - $type: deny
`))
	require.NoError(t, err)
	cfg, err := registry.Parser(r, StreamDialerKind)(context.Background(), node)
	require.NoError(t, err)
	require.IsType(t, &BlockConfig{}, cfg)

	directNode, err := composer.ParseYAML([]byte("$type: plain\nrequired_policy: true"))
	require.NoError(t, err)
	_, err = registry.Parser(r, StreamDialerKind)(context.Background(), directNode)
	require.ErrorIs(t, err, errors.ErrUnsupported)
}

func TestRegistrationHelpersCoverTheirKinds(t *testing.T) {
	r := registry.New()
	stream := NewDirectStreamDialerConfig(nil)
	packet := NewDirectPacketDialerConfig(nil)
	listener := NewDirectPacketListenerConfig(nil)
	require.NoError(t, RegisterDirect(r, "plain", stream, packet, listener))
	require.NoError(t, RegisterDialEndpoint(r, "connect"))
	require.NoError(t, RegisterWebsocket(r, "socket"))
	require.NoError(t, RegisterShadowsocks(r, "secret"))
	require.NoError(t, RegisterBlock(r, "deny"))

	streamEndpoint := parseRegistered(t, r, StreamEndpointKind, `
$type: connect
address: direct.example:443
dialer:
  $type: plain
`)
	require.IsType(t, &StreamDialEndpointConfig{}, streamEndpoint)
	packetEndpoint := parseRegistered(t, r, PacketEndpointKind, `
$type: connect
address: direct.example:53
dialer:
  $type: plain
`)
	require.IsType(t, &PacketDialEndpointConfig{}, packetEndpoint)

	websocketYAML := `
$type: socket
url: wss://cdn.example/path
endpoint:
  $type: connect
  address: cdn.example:443
  dialer:
    $type: plain
`
	require.IsType(t, &WebsocketEndpointConfig{}, parseRegistered(t, r, StreamEndpointKind, websocketYAML))
	require.IsType(t, &WebsocketEndpointConfig{}, parseRegistered(t, r, PacketEndpointKind, websocketYAML))

	shadowsocksYAML := `
$type: secret
endpoint:
  $type: connect
  address: ss.example:4321
  dialer:
    $type: plain
cipher: chacha20-ietf-poly1305
secret: SECRET
`
	require.IsType(t, &ShadowsocksStreamDialerConfig{}, parseRegistered(t, r, StreamDialerKind, shadowsocksYAML))
	require.IsType(t, &ShadowsocksPacketDialerConfig{}, parseRegistered(t, r, PacketDialerKind, shadowsocksYAML))
	require.IsType(t, &ShadowsocksPacketListenerConfig{}, parseRegistered(t, r, PacketListenerKind, shadowsocksYAML))

	require.IsType(t, &BlockConfig{}, parseRegistered(t, r, StreamDialerKind, "$type: deny"))
	require.IsType(t, &BlockConfig{}, parseRegistered(t, r, PacketDialerKind, "$type: deny"))
}

func TestRegistrationHelpersCanUseMultipleNamesAndOptions(t *testing.T) {
	r := registry.New()
	require.NoError(t, RegisterBlock(r, "deny"))
	require.NoError(t, RegisterBlock(r, "reject"))
	require.IsType(t, &BlockConfig{}, parseRegistered(t, r, StreamDialerKind, "$type: deny"))
	require.IsType(t, &BlockConfig{}, parseRegistered(t, r, StreamDialerKind, "$type: reject"))

	stream := NewDirectStreamDialerConfig(nil)
	packet := NewDirectPacketDialerConfig(nil)
	listener := NewDirectPacketListenerConfig(nil)
	require.NoError(t, RegisterDirect(r, "plain", stream, packet, listener))
	require.NoError(t, RegisterDialEndpoint(r, "connect"))
	require.NoError(t, RegisterWebsocket(r, "socket-a", WithWebsocketHeaders(http.Header{"X-App": []string{"a"}})))
	require.NoError(t, RegisterWebsocket(r, "socket-b", WithWebsocketHeaders(http.Header{"X-App": []string{"b"}})))

	parseWebsocket := func(name string) *WebsocketEndpointConfig {
		return parseRegistered(t, r, StreamEndpointKind, `
$type: `+name+`
url: wss://cdn.example/path
endpoint:
  $type: connect
  address: cdn.example:443
  dialer:
    $type: plain
`).(*WebsocketEndpointConfig)
	}
	a := parseWebsocket("socket-a")
	b := parseWebsocket("socket-b")
	require.Equal(t, "a", a.Headers.Get("X-App"))
	require.Equal(t, "b", b.Headers.Get("X-App"))
	a.Headers.Set("X-App", "changed")
	require.Equal(t, "b", b.Headers.Get("X-App"), "parsed headers must not share mutable state")
}

func TestRegistrationHelpersInstallNoFallback(t *testing.T) {
	r := registry.New()
	require.NoError(t, RegisterBlock(r, "deny"))
	node, err := composer.ParseYAML(nil)
	require.NoError(t, err)
	_, err = registry.Parser(r, StreamDialerKind)(context.Background(), node)
	require.Error(t, err)
}

func TestRegistrationDependenciesAreLateBound(t *testing.T) {
	r := registry.New()
	require.NoError(t, RegisterWebsocket(r, "socket"))
	require.NoError(t, RegisterDialEndpoint(r, "connect"))
	require.NoError(t, RegisterShadowsocks(r, "secret"))

	stream := NewDirectStreamDialerConfig(nil)
	packet := NewDirectPacketDialerConfig(nil)
	listener := NewDirectPacketListenerConfig(nil)
	require.NoError(t, RegisterDirect(r, "plain", stream, packet, listener))

	cfg := parseRegistered(t, r, StreamDialerKind, `
$type: secret
endpoint:
  $type: socket
  url: wss://cdn.example/path
  endpoint:
    $type: connect
    address: cdn.example:443
    dialer:
      $type: plain
cipher: chacha20-ietf-poly1305
secret: SECRET
`)
	require.IsType(t, &ShadowsocksStreamDialerConfig{}, cfg)
}

func TestRegisterDirectRejectsNilBeforeRegistration(t *testing.T) {
	r := registry.New()
	err := RegisterDirect(r, "plain", nil, NewDirectPacketDialerConfig(nil), NewDirectPacketListenerConfig(nil))
	require.ErrorContains(t, err, "must not be nil")

	node, parseErr := composer.ParseYAML([]byte("$type: plain"))
	require.NoError(t, parseErr)
	_, parseErr = registry.Parser(r, PacketDialerKind)(context.Background(), node)
	require.Error(t, parseErr, "validation should happen before any Kind is registered")
}
