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
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func newShadowsocksRegistry(network *recordingDialer) composer.MutableRegistry {
	r := newWebsocketRegistry(network)
	composer.Register(r, "shadowsocks", composer.As[StreamDialerConfig](ParseShadowsocksStreamDialer))
	composer.Register(r, "shadowsocks", composer.As[PacketDialerConfig](ParseShadowsocksPacketDialer))
	composer.Register(r, "shadowsocks", composer.As[PacketListenerConfig](ParseShadowsocksPacketListener))
	return r
}

const ssURL = `"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@example.com:1234"` // chacha20-ietf-poly1305:SECRET

// Every config form names the same proxy, and every form's endpoint goes
// through the registry.
func TestShadowsocks_ConfigForms(t *testing.T) {
	r := newShadowsocksRegistry(&recordingDialer{})
	for name, text := range map[string]string{
		"SIP002 URL":       ssURL,
		"mapping":          "endpoint: example.com:1234\ncipher: chacha20-ietf-poly1305\nsecret: SECRET",
		"mapping, $type":   "$type: shadowsocks\nendpoint: example.com:1234\ncipher: chacha20-ietf-poly1305\nsecret: SECRET\nprefix: \"POST \"",
		"endpoint mapping": "endpoint: {$type: dial, address: 'example.com:1234'}\ncipher: chacha20-ietf-poly1305\nsecret: SECRET",
		"JSON form":        `{"server": "example.com", "server_port": 1234, "method": "chacha20-ietf-poly1305", "password": "SECRET"}`,
	} {
		config, err := ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t, text))
		require.NoError(t, err, name)
		require.Equal(t, "example.com:1234", config.Endpoint.(*StreamDialEndpointConfig).Address, name)
	}
}

func TestShadowsocks_Prefix(t *testing.T) {
	r := newShadowsocksRegistry(&recordingDialer{})
	const base = "endpoint: example.com:1234\ncipher: chacha20-ietf-poly1305\nsecret: SECRET"

	config, err := ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t, base))
	require.NoError(t, err)
	require.Nil(t, config.SaltGenerator)

	config, err = ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t, base+"\nprefix: \"POST \""))
	require.NoError(t, err)
	require.NotNil(t, config.SaltGenerator)

	config, err = ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t, `"ss://chacha20-ietf-poly1305:SECRET@example.com:443?prefix=POST%20"`))
	require.NoError(t, err)
	require.NotNil(t, config.SaltGenerator, "a URL carries its prefix as a query parameter")
}

// Access keys in use write a password made of digits without quotes, and a
// port with them. The parser current clients use accepts both.
func TestShadowsocks_AcceptsLooselyTypedSecretsAndPorts(t *testing.T) {
	r := newShadowsocksRegistry(&recordingDialer{})
	for name, text := range map[string]string{
		"numeric secret":   "endpoint: example.com:1234\ncipher: chacha20-ietf-poly1305\nsecret: 123456",
		"numeric password": `{"server": "example.com", "server_port": 1234, "method": "chacha20-ietf-poly1305", "password": 123456}`,
		"quoted port":      `{"server": "example.com", "server_port": "1234", "method": "chacha20-ietf-poly1305", "password": "SECRET"}`,
	} {
		config, err := ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t, text))
		require.NoError(t, err, name)
		require.Equal(t, "example.com:1234", config.Endpoint.(*StreamDialEndpointConfig).Address, name)
	}
	_, err := ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t,
		`{"server": "example.com", "server_port": "http", "method": "chacha20-ietf-poly1305", "password": "SECRET"}`))
	require.ErrorContains(t, err, "server_port")
}

func TestShadowsocks_Validation(t *testing.T) {
	r := newShadowsocksRegistry(&recordingDialer{})
	for name, bad := range map[string]string{
		"missing cipher":      "endpoint: example.com:1\nsecret: s",
		"missing secret":      "endpoint: example.com:1\ncipher: aes-128-gcm",
		"missing endpoint":    "cipher: aes-128-gcm\nsecret: s",
		"missing server_port": "server: example.com\nmethod: aes-128-gcm\npassword: s",
		"bad cipher":          "endpoint: example.com:1\ncipher: nope\nsecret: s",
		"bad prefix":          "endpoint: example.com:1\ncipher: aes-128-gcm\nsecret: s\nprefix: \"\\u0800\"",
		"bad endpoint":        "endpoint: example.com\ncipher: aes-128-gcm\nsecret: s",
		"not a URL":           `"example.com:1234"`,
	} {
		_, err := ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t, bad))
		require.Error(t, err, name)
		require.NotErrorIs(t, err, errors.ErrUnsupported, name)
	}
	_, err := ParseShadowsocksStreamDialer(context.Background(), r, mustNode(t,
		"endpoint: example.com:1\ncipher: aes-128-gcm\nsecret: s\naddress: example.com:1"))
	require.ErrorIs(t, err, errors.ErrUnsupported, "an unknown field")
}

// The proxy is reached through whatever endpoint the registry returns, here
// a WebSocket over a dial endpoint. Nothing dials until a connection is made.
func TestShadowsocks_DialsThroughItsEndpoint(t *testing.T) {
	network := &recordingDialer{}
	r := newShadowsocksRegistry(network)
	ctx := context.Background()

	config, err := composer.Parse[StreamDialerConfig](ctx, r, mustNode(t, `
$type: shadowsocks
endpoint:
  $type: websocket
  url: wss://cdn.example.com/tcp
cipher: chacha20-ietf-poly1305
secret: SECRET
`))
	require.NoError(t, err)
	dialer, err := config.NewStreamDialer(ctx)
	require.NoError(t, err)
	require.Empty(t, network.dialed, "parsing and building must not dial")

	_, err = dialer.DialStream(ctx, "destination.example:443")
	require.ErrorIs(t, err, errNotConnecting)
	require.Equal(t, []string{"cdn.example.com:443"}, network.dialed, "only the proxy is dialed from the device")
}

func TestShadowsocks_PacketListenerAndDialer(t *testing.T) {
	network := &recordingDialer{}
	r := newShadowsocksRegistry(network)
	ctx := context.Background()
	const text = "$type: shadowsocks\nendpoint: example.com:1234\ncipher: chacha20-ietf-poly1305\nsecret: SECRET\nprefix: \"POST \""

	listenerConfig, err := composer.Parse[PacketListenerConfig](ctx, r, mustNode(t, text))
	require.NoError(t, err)
	require.NotNil(t, listenerConfig.(*ShadowsocksPacketListenerConfig).SaltGenerator)
	listener, err := listenerConfig.NewPacketListener(ctx)
	require.NoError(t, err)
	require.Empty(t, network.dialed, "parsing and building must not dial")
	_, err = listener.ListenPacket(ctx)
	require.ErrorIs(t, err, errNotConnecting)

	dialerConfig, err := composer.Parse[PacketDialerConfig](ctx, r, mustNode(t, text))
	require.NoError(t, err)
	require.Equal(t, "example.com:1234", dialerConfig.(*ShadowsocksPacketDialerConfig).Listener.Endpoint.(*PacketDialEndpointConfig).Address)
	dialer, err := dialerConfig.NewPacketDialer(ctx)
	require.NoError(t, err)
	_, err = dialer.DialPacket(ctx, "destination.example:53")
	require.ErrorIs(t, err, errNotConnecting)

	require.Equal(t, []string{"example.com:1234", "example.com:1234"}, network.dialed)
}

// The following tests exercise the URL helpers directly, because the parsed
// config folds the cipher and secret into an opaque encryption key.

func TestShadowsocksURL_FullyBase64Encoded(t *testing.T) {
	encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#@example.com:1234?prefix=HTTP%2F1.1%20"))
	u, err := url.Parse("ss://" + encoded + "#outline-123")
	require.NoError(t, err)
	res, err := parseShadowsocksURL(*u)
	require.NoError(t, err)
	require.Equal(t, "example.com:1234", res.Endpoint)
	require.Equal(t, "chacha20-ietf-poly1305", res.Cipher)
	require.Equal(t, "SECRET/!@#", res.Secret)
	require.Equal(t, "HTTP/1.1 ", res.Prefix)
}

func TestShadowsocksURL_FullyBase64EncodedWithPasswordContainingHost(t *testing.T) {
	encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET@example.com:80@example.com:1234?prefix=HTTP%2F1.1%20"))
	u, err := url.Parse("ss://" + encoded + "#outline-123")
	require.NoError(t, err)
	res, err := parseShadowsocksURL(*u)
	require.NoError(t, err)
	require.Equal(t, "example.com:1234", res.Endpoint)
	require.Equal(t, "SECRET@example.com:80", res.Secret)
}

func TestShadowsocksURL_FullyBase64EncodedWithAmbiguousQueryParameterParsesGreedily(t *testing.T) {
	encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#@example.com:1234?prefix=@bad.example.com:443"))
	u, err := url.Parse("ss://" + encoded + "#outline-123")
	require.NoError(t, err)
	res, err := parseShadowsocksURL(*u)
	require.NoError(t, err)
	require.Equal(t, "bad.example.com:443", res.Endpoint)
	require.Equal(t, "SECRET/!@#@example.com:1234?prefix=", res.Secret)
}

func TestShadowsocksURL_UserInfoBase64Encoded(t *testing.T) {
	encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#"))
	u, err := url.Parse("ss://" + encoded + "@example.com:1234?prefix=HTTP%2F1.1%20" + "#outline-123")
	require.NoError(t, err)
	res, err := parseShadowsocksURL(*u)
	require.NoError(t, err)
	require.Equal(t, "example.com:1234", res.Endpoint)
	require.Equal(t, "chacha20-ietf-poly1305", res.Cipher)
	require.Equal(t, "SECRET/!@#", res.Secret)
	require.Equal(t, "HTTP/1.1 ", res.Prefix)
}

func TestShadowsocksURL_UserInfoBase64LegacyEncoded(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#"))
	u, err := url.Parse("ss://" + encoded + "@example.com:1234?prefix=HTTP%2F1.1%20" + "#outline-123")
	require.NoError(t, err)
	res, err := parseShadowsocksURL(*u)
	require.NoError(t, err)
	require.Equal(t, "example.com:1234", res.Endpoint)
	require.Equal(t, "chacha20-ietf-poly1305", res.Cipher)
	require.Equal(t, "SECRET/!@#", res.Secret)
	require.Equal(t, "HTTP/1.1 ", res.Prefix)
}

func TestShadowsocksURL_UserInfoPercentEncoding(t *testing.T) {
	configString := fmt.Sprintf("ss://%s:%s@example.com:1234",
		url.QueryEscape("chacha20-ietf-poly1305"),
		url.QueryEscape("SECRET/!@#"),
	)
	u, err := url.Parse(configString)
	require.NoError(t, err)
	res, err := parseShadowsocksURL(*u)
	require.NoError(t, err)
	require.Equal(t, "example.com:1234", res.Endpoint)
	require.Equal(t, "chacha20-ietf-poly1305", res.Cipher)
	require.Equal(t, "SECRET/!@#", res.Secret)
}

// A cipher name is only checked once the encryption key is created, so these
// go through parseShadowsocksNode.
func TestShadowsocksNode_InvalidCipherInfoFails(t *testing.T) {
	_, err := parseShadowsocksNode(mustNode(t, `"ss://chacha20-ietf-poly13051234567@example.com:1234"`))
	require.Error(t, err)
}

func TestShadowsocksNode_UnsupportedCipherFails(t *testing.T) {
	_, err := parseShadowsocksNode(mustNode(t, `"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwnTpLeTUyN2duU3FEVFB3R0JpQ1RxUnlT@example.com:1234"`))
	require.Error(t, err)
}
