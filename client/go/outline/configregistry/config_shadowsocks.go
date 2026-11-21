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

package configregistry

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"localhost/client/go/composer"
	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/transport/shadowsocks"
)

// ShadowsocksConfig is the format for the Shadowsocks config. It can specify Dialers or PacketListener.
type ShadowsocksConfig struct {
	Endpoint composer.Node
	Cipher   composer.Optional[string]
	Secret   composer.Optional[string]
	Prefix   composer.Optional[string]
}

// LegacyShadowsocksConfig is the legacy format for the Shadowsocks config.
type LegacyShadowsocksConfig struct {
	Server      string
	Server_Port composer.Optional[uint16]
	Method      composer.Optional[string]
	Password    composer.Optional[string]
	Prefix      composer.Optional[string]
}

func parseShadowsocksTransport(ctx context.Context, r composer.Registry, config composer.Node) (*TransportPair, error) {
	params, err := parseShadowsocksParams(config)
	if err != nil {
		return nil, err
	}

	se, err := composer.Parse[*Endpoint[transport.StreamConn]](ctx, r, params.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamEndpoint: %w", err)
	}
	sd, err := shadowsocks.NewStreamDialer(transport.FuncStreamEndpoint(se.Connect), params.Key)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}
	if params.SaltGenerator != nil {
		sd.SaltGenerator = params.SaltGenerator
	}

	pe, err := composer.Parse[*Endpoint[net.Conn]](ctx, r, params.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to create PacketEndpoint: %w", err)
	}
	pl, err := shadowsocks.NewPacketListener(transport.FuncPacketEndpoint(pe.Connect), params.Key)
	if err != nil {
		return nil, fmt.Errorf("failed to create PacketListener: %w", err)
	}

	// For the Shadowsocks transport, the prefix only applies to TCP. To use a prefix with UDP, one needs to
	// specify it in the PacketListener config explicitly. This is to ensure backwards-compatibility.
	return wrapTransportPairWithOutlineDNS(
		&Dialer[transport.StreamConn]{ConnectionProviderInfo{ConnTypeTunneled, se.FirstHop}, sd.DialStream},
		&PacketListener{ConnectionProviderInfo{ConnTypeTunneled, pe.FirstHop}, pl},
	)
}

func parseShadowsocksStreamDialer(ctx context.Context, r composer.Registry, config composer.Node) (*Dialer[transport.StreamConn], error) {
	params, err := parseShadowsocksParams(config)
	if err != nil {
		return nil, err
	}

	se, err := composer.Parse[*Endpoint[transport.StreamConn]](ctx, r, params.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamEndpoint: %w", err)
	}
	sd, err := shadowsocks.NewStreamDialer(transport.FuncStreamEndpoint(se.Connect), params.Key)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}
	if params.SaltGenerator != nil {
		sd.SaltGenerator = params.SaltGenerator
	}

	return &Dialer[transport.StreamConn]{ConnectionProviderInfo{ConnTypeTunneled, se.FirstHop}, sd.DialStream}, nil
}

func parseShadowsocksPacketDialer(ctx context.Context, r composer.Registry, config composer.Node) (*Dialer[net.Conn], error) {
	pl, err := parseShadowsocksPacketListener(ctx, r, config)
	if err != nil {
		return nil, err
	}
	pd := transport.PacketListenerDialer{Listener: pl}
	return &Dialer[net.Conn]{ConnectionProviderInfo{ConnTypeTunneled, pl.FirstHop}, pd.DialPacket}, nil
}

func parseShadowsocksPacketListener(ctx context.Context, r composer.Registry, config composer.Node) (*PacketListener, error) {
	params, err := parseShadowsocksParams(config)
	if err != nil {
		return nil, err
	}
	pe, err := composer.Parse[*Endpoint[net.Conn]](ctx, r, params.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("failed to create PacketEndpoint: %w", err)
	}
	pl, err := shadowsocks.NewPacketListener(transport.FuncPacketEndpoint(pe.Connect), params.Key)
	if err != nil {
		return nil, err
	}
	if params.SaltGenerator != nil {
		pl.SetSaltGenerator(params.SaltGenerator)
	}
	return &PacketListener{ConnectionProviderInfo{ConnTypeTunneled, pe.FirstHop}, pl}, nil
}

type shadowsocksParams struct {
	Endpoint      composer.Node
	Key           *shadowsocks.EncryptionKey
	SaltGenerator shadowsocks.SaltGenerator
}

// shadowsocksFields are the fields common to all the Shadowsocks formats.
type shadowsocksFields struct {
	// Endpoint is the server address, in the formats that don't take an endpoint config.
	Endpoint string
	// EndpointConfig is the endpoint config. If absent, the endpoint dials Endpoint.
	EndpointConfig composer.Node
	Cipher         string
	Secret         string
	Prefix         string
}

func parseShadowsocksConfig(node composer.Node) (*shadowsocksFields, error) {
	switch node.Kind() {
	case composer.KindScalar:
		var text string
		if err := node.Decode(&text); err != nil {
			return nil, err
		}
		urlConfig, err := url.Parse(text)
		if err != nil {
			return nil, fmt.Errorf("string config is not a valid URL: %w", err)
		}
		return parseShadowsocksURL(*urlConfig)
	case composer.KindMapping:
		var keys map[string]composer.Node
		if err := node.Decode(&keys); err != nil {
			return nil, err
		}
		// If the map has an "endpoint" field, we assume the new format.
		if _, ok := keys["endpoint"]; ok {
			config := ShadowsocksConfig{}
			if err := node.Decode(&config); err != nil {
				return nil, err
			}
			return &shadowsocksFields{
				EndpointConfig: config.Endpoint,
				Cipher:         config.Cipher.Or(""),
				Secret:         config.Secret.Or(""),
				Prefix:         config.Prefix.Or(""),
			}, nil
		} else if _, ok := keys["server"]; ok {
			// Else, we assume the legacy format if "server" is present.
			config := LegacyShadowsocksConfig{}
			if err := node.Decode(&config); err != nil {
				return nil, err
			}
			return &shadowsocksFields{
				Endpoint: net.JoinHostPort(config.Server, strconv.FormatUint(uint64(config.Server_Port.Or(0)), 10)),
				Cipher:   config.Method.Or(""),
				Secret:   config.Password.Or(""),
				Prefix:   config.Prefix.Or(""),
			}, nil
		} else {
			return nil, fmt.Errorf("shadowsocks config missing endpoint")
		}
	default:
		return nil, fmt.Errorf("invalid shadowsocks config type %v", node.Kind())
	}
}

func parseShadowsocksParams(node composer.Node) (*shadowsocksParams, error) {
	config, err := parseShadowsocksConfig(node)
	if err != nil {
		return nil, err
	}

	if len(config.Cipher) == 0 {
		return nil, errors.New("cipher must not be empty")
	}
	if len(config.Secret) == 0 {
		return nil, errors.New("secret must not be empty")
	}

	params := &shadowsocksParams{
		Endpoint: config.EndpointConfig,
	}
	if params.Endpoint.IsAbsent() {
		params.Endpoint, err = stringNode(config.Endpoint)
		if err != nil {
			return nil, err
		}
	}
	params.Key, err = shadowsocks.NewEncryptionKey(config.Cipher, config.Secret)
	if err != nil {
		return nil, fmt.Errorf("invalid cipher: %w", err)
	}
	if len(config.Prefix) > 0 {
		prefixBytes, err := parseStringPrefix(config.Prefix)
		if err != nil {
			return nil, fmt.Errorf("invalid prefix: %w", err)
		}
		params.SaltGenerator = shadowsocks.NewPrefixSaltGenerator(prefixBytes)
	}
	return params, nil
}

func parseStringPrefix(utf8Str string) ([]byte, error) {
	runes := []rune(utf8Str)
	rawBytes := make([]byte, len(runes))
	for i, r := range runes {
		if (r & 0xFF) != r {
			return nil, fmt.Errorf("character out of range: %d", r)
		}
		rawBytes[i] = byte(r)
	}
	return rawBytes, nil
}

func parseShadowsocksURL(url url.URL) (*shadowsocksFields, error) {
	// attempt to decode as SIP002 URI format and
	// fall back to legacy base64 format if decoding fails
	config, err := parseShadowsocksSIP002URL(url)
	if err == nil {
		return config, nil
	}
	return parseShadowsocksLegacyBase64URL(url)
}

// cutLust slices s around the last instance of sep, returning the text before
// and after sep. The found result reports whether sep appears in s. If sep does
// not appear in s, cut returns s, "", false.
func cutLast(s, sep string) (before, after string, found bool) {
	last := strings.LastIndex(s, sep)
	if last == -1 {
		return s, "", false
	}
	return s[:last], s[last+len(sep):], true
}

// parseShadowsocksLegacyBase64URL parses URL based on legacy base64 format:
// https://shadowsocks.org/doc/configs.html#uri-and-qr-code
func parseShadowsocksLegacyBase64URL(url url.URL) (*shadowsocksFields, error) {
	if url.Host == "" {
		return nil, errors.New("host not specified")
	}
	decoded, err := base64.URLEncoding.WithPadding(base64.NoPadding).DecodeString(url.Host)
	if err != nil {
		// If decoding fails, return the original url with error
		return nil, fmt.Errorf("failed to decode host string [%v]: %w", url.String(), err)
	}

	// The decoded URI doesn't follow RFC3986, so we need our own parsing. The password is expected to be plain text.
	userInfo, host, found := cutLast(string(decoded), "@")
	if !found {
		return nil, errors.New("invalid user info")
	}
	cipherName, secret, found := strings.Cut(userInfo, ":")
	if !found {
		return nil, errors.New("invalid cipher info: no ':' separator")
	}

	var fragment string
	if url.Fragment != "" {
		fragment = "#" + url.Fragment
	} else {
		fragment = ""
	}
	newURL, err := url.Parse(strings.ToLower(url.Scheme) + "://" + host + fragment)
	if err != nil {
		// if parsing fails, return the original url with error
		return nil, fmt.Errorf("failed to parse config part: %w", err)
	}

	return &shadowsocksFields{
		Endpoint: newURL.Host,
		Cipher:   cipherName,
		Secret:   secret,
		Prefix:   newURL.Query().Get("prefix"),
	}, nil
}

// parseShadowsocksSIP002URL parses URL based on SIP002 format:
// https://shadowsocks.org/doc/sip002.html
func parseShadowsocksSIP002URL(url url.URL) (*shadowsocksFields, error) {
	if url.Host == "" {
		return nil, errors.New("host not specified")
	}
	userInfo := url.User.String()
	// Cipher info can be optionally encoded with Base64URL.
	encoding := base64.URLEncoding.WithPadding(base64.NoPadding)
	decodedUserInfo, err := encoding.DecodeString(userInfo)
	if err != nil {
		// Try base64 decoding in legacy mode
		decodedUserInfo, err = base64.StdEncoding.DecodeString(userInfo)
	}
	var (
		cipherName string
		secret     string
		found      bool
	)
	if err == nil {
		cipherName, secret, found = strings.Cut(string(decodedUserInfo), ":")
		if !found {
			return nil, errors.New("invalid cipher info: no ':' separator")
		}
	} else {
		// Base64 decoding failed, assume percent encoding.
		cipherName = url.User.Username()
		secret, found = url.User.Password()
		if !found {
			return nil, errors.New("invalid cipher info: no secret")
		}
	}
	return &shadowsocksFields{
		Endpoint: url.Host,
		Cipher:   cipherName,
		Secret:   secret,
		Prefix:   url.Query().Get("prefix"),
	}, nil
}
