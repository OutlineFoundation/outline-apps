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
)

func newWebsocketRegistry(network *recordingDialer, opts ...WebsocketOption) composer.MutableRegistry {
	r := newTestRegistry(network)
	parse := NewWebsocketEndpointParser(opts...)
	composer.Register(r, "websocket", composer.As[StreamEndpointConfig](parse))
	composer.Register(r, "websocket", composer.As[PacketEndpointConfig](parse))
	return r
}

func parseWebsocket(t *testing.T, r composer.Registry, text string) (*WebsocketEndpointConfig, error) {
	t.Helper()
	parsed, err := parseStreamEndpoint(t, r, text)
	if err != nil {
		return nil, err
	}
	return parsed.(*WebsocketEndpointConfig), nil
}

func TestWebsocket_EndpointDefaultsToTheURLHost(t *testing.T) {
	r := newWebsocketRegistry(&recordingDialer{})
	for _, tc := range []struct{ url, wantURL, wantAddress string }{
		{"wss://cdn.example.com/tcp", "wss://cdn.example.com/tcp", "cdn.example.com:443"},
		{"https://cdn.example.com/tcp", "wss://cdn.example.com/tcp", "cdn.example.com:443"},
		{"ws://cdn.example.com/tcp", "ws://cdn.example.com/tcp", "cdn.example.com:80"},
		{"http://cdn.example.com/tcp", "ws://cdn.example.com/tcp", "cdn.example.com:80"},
		{"wss://cdn.example.com:8443/tcp", "wss://cdn.example.com:8443/tcp", "cdn.example.com:8443"},
		{"wss://[2001:db8::1]/tcp", "wss://[2001:db8::1]/tcp", "[2001:db8::1]:443"},
	} {
		config, err := parseWebsocket(t, r, "$type: websocket\nurl: \""+tc.url+"\"")
		require.NoError(t, err, tc.url)
		require.Equal(t, tc.wantURL, config.URL, tc.url)
		require.Equal(t, tc.wantAddress, config.Endpoint.(*StreamDialEndpointConfig).Address, tc.url)
	}
}

func TestWebsocket_ExplicitEndpoint(t *testing.T) {
	r := newWebsocketRegistry(&recordingDialer{})
	config, err := parseWebsocket(t, r, "$type: websocket\nurl: wss://cdn.example.com/tcp\nendpoint: backend.example.com:8443")
	require.NoError(t, err)
	require.Equal(t, "backend.example.com:8443", config.Endpoint.(*StreamDialEndpointConfig).Address)

	config, err = parseWebsocket(t, r, `
$type: websocket
url: wss://outer.example.com/tcp
endpoint:
  $type: websocket
  url: wss://inner.example.com/tcp
`)
	require.NoError(t, err)
	inner := config.Endpoint.(*WebsocketEndpointConfig)
	require.Equal(t, "inner.example.com:443", inner.Endpoint.(*StreamDialEndpointConfig).Address, "endpoints nest")
}

func TestWebsocket_RejectsBadConfigs(t *testing.T) {
	r := newWebsocketRegistry(&recordingDialer{})
	for _, text := range []string{
		"$type: websocket",
		"$type: websocket\nurl: \"://bad\"",
		"$type: websocket\nurl: ftp://cdn.example.com/tcp",
		"$type: websocket\nurl: \"wss:///tcp\"",
		"$type: websocket\nurl: wss://cdn.example.com/tcp\nendpoint: no-port.example.com",
	} {
		_, err := parseWebsocket(t, r, text)
		require.Error(t, err, text)
		require.NotErrorIs(t, err, errors.ErrUnsupported, text)
	}
	_, err := parseWebsocket(t, r, "$type: websocket\nurl: wss://cdn.example.com/tcp\nendpoint: {$type: teleport}")
	require.ErrorIs(t, err, errors.ErrUnsupported, "an unknown endpoint type")
}

func TestWebsocket_HeadersAreCopiedIntoEachConfig(t *testing.T) {
	headers := http.Header{"User-Agent": []string{"TestAgent"}}
	r := newWebsocketRegistry(&recordingDialer{}, WithWebsocketHeaders(headers))
	const text = "$type: websocket\nurl: wss://cdn.example.com/tcp"

	first, err := parseWebsocket(t, r, text)
	require.NoError(t, err)
	require.Equal(t, "TestAgent", first.Headers.Get("User-Agent"))

	first.Headers.Set("User-Agent", "Changed")
	second, err := parseWebsocket(t, r, text)
	require.NoError(t, err)
	require.Equal(t, "TestAgent", second.Headers.Get("User-Agent"))
	require.Equal(t, "TestAgent", headers.Get("User-Agent"))

	bare, err := parseWebsocket(t, newWebsocketRegistry(&recordingDialer{}), text)
	require.NoError(t, err)
	require.Empty(t, bare.Headers)
}

// Parsing and building touch nothing. Connecting reaches the network through
// the inner endpoint, for the stream and the packet form alike.
func TestWebsocket_ConnectsThroughTheInnerEndpoint(t *testing.T) {
	network := &recordingDialer{}
	r := newWebsocketRegistry(network)
	ctx := context.Background()
	const text = "$type: websocket\nurl: wss://cdn.example.com/path\nendpoint: backend.example.com:8443"

	streamConfig, err := composer.Parse[StreamEndpointConfig](ctx, r, mustNode(t, text))
	require.NoError(t, err)
	streamEndpoint, err := streamConfig.NewStreamEndpoint(ctx)
	require.NoError(t, err)
	require.Empty(t, network.dialed, "parsing and building must not dial")
	_, err = streamEndpoint.ConnectStream(ctx)
	require.ErrorIs(t, err, errNotConnecting)

	packetConfig, err := composer.Parse[PacketEndpointConfig](ctx, r, mustNode(t, text))
	require.NoError(t, err)
	require.IsType(t, &WebsocketEndpointConfig{}, packetConfig)
	packetEndpoint, err := packetConfig.NewPacketEndpoint(ctx)
	require.NoError(t, err)
	_, err = packetEndpoint.ConnectPacket(ctx)
	require.ErrorIs(t, err, errNotConnecting)

	require.Equal(t, []string{"backend.example.com:8443", "backend.example.com:8443"}, network.dialed)
}
