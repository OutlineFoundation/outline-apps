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
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"testing"

	"localhost/client/go/configyaml"
	"golang.getoutline.org/sdk/transport"
	"github.com/stretchr/testify/require"
)

func parseFromYAMLText(configText string) (*ShadowsocksConfig, error) {
	node, err := configyaml.ParseConfigYAML(configText)
	if err != nil {
		return nil, err
	}
	return parseShadowsocksConfig(node)
}

func TestParseShadowsocksConfig_URL(t *testing.T) {
	t.Run("Fully Base64 Encoded", func(t *testing.T) {
		encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#@example.com:1234?prefix=HTTP%2F1.1%20"))
		config, err := parseFromYAMLText("ss://" + string(encoded) + "#outline-123")
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "chacha20-ietf-poly1305", config.Cipher)
		require.Equal(t, "SECRET/!@#", config.Secret)
		require.Equal(t, "HTTP/1.1 ", config.Prefix)
	})

	t.Run("Fully Base64 Encoded With Password Containing Host", func(t *testing.T) {
		encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET@example.com:80@example.com:1234?prefix=HTTP%2F1.1%20"))
		config, err := parseFromYAMLText("ss://" + string(encoded) + "#outline-123")
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "SECRET@example.com:80", config.Secret)
	})

	t.Run("Fully Base64 Encoded With Ambiguous Query Parameter Parses Greedily", func(t *testing.T) {
		encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#@example.com:1234?prefix=@bad.example.com:443"))
		config, err := parseFromYAMLText("ss://" + string(encoded) + "#outline-123")
		require.NoError(t, err)
		require.Equal(t, "bad.example.com:443", config.Endpoint)
		require.Equal(t, "SECRET/!@#@example.com:1234?prefix=", config.Secret)
	})

	t.Run("User Info Base64 Encoded", func(t *testing.T) {
		encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#"))
		config, err := parseFromYAMLText("ss://" + string(encoded) + "@example.com:1234?prefix=HTTP%2F1.1%20" + "#outline-123")
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "chacha20-ietf-poly1305", config.Cipher)
		require.Equal(t, "SECRET/!@#", config.Secret)
		require.Equal(t, "HTTP/1.1 ", config.Prefix)
	})

	t.Run("User Info Base64 Legacy Encoded", func(t *testing.T) {
		encoded := base64.StdEncoding.EncodeToString([]byte("chacha20-ietf-poly1305:SECRET/!@#"))
		config, err := parseFromYAMLText("ss://" + string(encoded) + "@example.com:1234?prefix=HTTP%2F1.1%20" + "#outline-123")
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "chacha20-ietf-poly1305", config.Cipher)
		require.Equal(t, "SECRET/!@#", config.Secret)
		require.Equal(t, "HTTP/1.1 ", config.Prefix)
	})

	t.Run("User Info Percent Encoding", func(t *testing.T) {
		configString := fmt.Sprintf("ss://%s:%s@example.com:1234",
			url.QueryEscape("chacha20-ietf-poly1305"),
			url.QueryEscape("SECRET/!@#"),
		)
		config, err := parseFromYAMLText(configString)
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "chacha20-ietf-poly1305", config.Cipher)
		require.Equal(t, "SECRET/!@#", config.Secret)
	})

	t.Run("Invalid Cipher Fails", func(t *testing.T) {
		configString := "ss://chacha20-ietf-poly13051234567@example.com:1234"
		_, err := parseShadowsocksParams(configString)
		require.Error(t, err)
	})

	t.Run("Unsupported Cipher Fails", func(t *testing.T) {
		configString := "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwnTpLeTUyN2duU3FEVFB3R0JpQ1RxUnlT@example.com:1234"
		_, err := parseShadowsocksParams(configString)
		require.Error(t, err)
	})
}

func TestParseShadowsocksConfig_LegacyJSON(t *testing.T) {
	t.Run("Regular", func(t *testing.T) {
		config, err := parseFromYAMLText(`{"server":"example.com","server_port":1234,"method":"chacha20-ietf-poly1305","password":"SECRET/!@#"}`)
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "chacha20-ietf-poly1305", config.Cipher)
		require.Equal(t, "SECRET/!@#", config.Secret)
	})

	t.Run("With Prefix", func(t *testing.T) {
		config, err := parseFromYAMLText(`{"server":"example.com","server_port":1234,"method":"chacha20-ietf-poly1305","password":"SECRET/!@#","prefix": "HTTP/1.1"}`)
		require.NoError(t, err)
		require.Equal(t, "example.com:1234", config.Endpoint)
		require.Equal(t, "chacha20-ietf-poly1305", config.Cipher)
		require.Equal(t, "SECRET/!@#", config.Secret)
		require.Equal(t, "HTTP/1.1", config.Prefix)
	})

	t.Run("With Unprintable Prefix", func(t *testing.T) {
		config, err := parseFromYAMLText(`{"server":"example.com","server_port":1234,"method":"chacha20-ietf-poly1305","password":"SECRET/!@#","prefix": "\u0000\u0080\u00ff"}`)
		require.NoError(t, err)
		require.Equal(t, "\u0000\u0080\u00ff", config.Prefix)
	})

	t.Run("With Multi-byte UTF-8 Prefix", func(t *testing.T) {
		config, err := parseFromYAMLText(`{"server":"example.com","server_port":1234,"method":"chacha20-ietf-poly1305","password":"SECRET/!@#","prefix": "\u0080\u0081\u00fd\u00ff"}`)
		require.NoError(t, err)
		require.Equal(t, "\u0080\u0081\u00fd\u00ff", config.Prefix)
	})

	t.Run("ExraFieldFails", func(t *testing.T) {
		_, err := parseFromYAMLText(`{"extra": "invalid", "server":"example.com","server_port":1234,"method":"chacha20-ietf-poly1305","password":"SECRET", "prefix": "HTTP/1.1"}`)
		require.Error(t, err)
	})
}

func TestParseShadowsocksConfig_YAML(t *testing.T) {
	streamEndpoints := configyaml.NewTypeParser(func(ctx context.Context, config configyaml.ConfigNode) (*Endpoint[transport.StreamConn], error) {
		require.Equal(t, "example.com:1234", config)
		return &Endpoint[transport.StreamConn]{}, nil
	})
	packetEndpoints := configyaml.NewTypeParser(func(ctx context.Context, config configyaml.ConfigNode) (*Endpoint[net.Conn], error) {
		require.Equal(t, "example.com:1234", config)
		return &Endpoint[net.Conn]{}, nil
	})

	t.Run("Success", func(t *testing.T) {
		config := map[string]any{
			"endpoint": "example.com:1234",
			"cipher":   "chacha20-ietf-poly1305",
			"secret":   "SECRET/!@#",
			"prefix":   "outline-123",
		}
		transport, err := parseShadowsocksTransport(context.Background(), config, streamEndpoints.Parse, packetEndpoints.Parse)
		require.NoError(t, err)
		require.NotNil(t, transport)
	})

	t.Run("Fail on unsupported cipher", func(t *testing.T) {
		config := map[string]any{
			"endpoint": "example.com:1234",
			"cipher":   "NOT SUPPORTED",
			"secret":   "SECRET/!@#",
			"prefix":   "outline-123",
		}
		_, err := parseShadowsocksTransport(context.Background(), config, streamEndpoints.Parse, packetEndpoints.Parse)
		require.Error(t, err)
	})

	t.Run("Fail on extraneous field", func(t *testing.T) {
		config := map[string]any{
			"endpoint": "example.com:1234",
			"cipher":   "chacha20-ietf-poly1305",
			"secret":   "SECRET/!@#",
			"prefix":   "outline-123",
			"extra":    "NOT SUPPORTED",
		}
		_, err := parseShadowsocksTransport(context.Background(), config, streamEndpoints.Parse, packetEndpoints.Parse)
		require.Error(t, err)
	})

	t.Run("Prefix", func(t *testing.T) {
		yamlNode, err := configyaml.ParseConfigYAML(`{
  "server": "123.x.x.x",
  "server_port": 443,
  "password": "xxxxx",
  "method": "chacha20-ietf-poly1305",
  "prefix": "SSH-2.0\r\n"
}
`)
		require.NoError(t, err)
		require.NotNil(t, yamlNode)
		config, err := parseShadowsocksConfig(yamlNode)
		require.NoError(t, err)
		require.Equal(t, "123.x.x.x:443", config.Endpoint)
		require.Equal(t, "SSH-2.0\r\n", config.Prefix)
	})
}
