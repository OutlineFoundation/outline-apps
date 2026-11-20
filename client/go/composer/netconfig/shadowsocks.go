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
	"net"
	"net/url"
	"strconv"
	"strings"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/transport/shadowsocks"
	"localhost/client/go/composer"
)

// ssURLResult is the Shadowsocks config carried by an ss:// URL. The endpoint
// of a URL is always an address.
type ssURLResult struct {
	Endpoint string
	Cipher   string
	Secret   string
	Prefix   string
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

func parseShadowsocksURL(url url.URL) (*ssURLResult, error) {
	// attempt to decode as SIP002 URI format and
	// fall back to legacy base64 format if decoding fails
	config, err := parseShadowsocksSIP002URL(url)
	if err == nil {
		return config, nil
	}
	return parseShadowsocksLegacyBase64URL(url)
}

// cutLast slices s around the last instance of sep, returning the text before
// and after sep. The found result reports whether sep appears in s. If sep does
// not appear in s, cutLast returns s, "", false.
func cutLast(s, sep string) (before, after string, found bool) {
	last := strings.LastIndex(s, sep)
	if last == -1 {
		return s, "", false
	}
	return s[:last], s[last+len(sep):], true
}

// parseShadowsocksLegacyBase64URL parses URL based on legacy base64 format:
// https://shadowsocks.org/doc/configs.html#uri-and-qr-code
func parseShadowsocksLegacyBase64URL(url url.URL) (*ssURLResult, error) {
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

	return &ssURLResult{
		Endpoint: newURL.Host,
		Cipher:   cipherName,
		Secret:   secret,
		Prefix:   newURL.Query().Get("prefix"),
	}, nil
}

// parseShadowsocksSIP002URL parses URL based on SIP002 format:
// https://shadowsocks.org/doc/sip002.html
func parseShadowsocksSIP002URL(url url.URL) (*ssURLResult, error) {
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
	return &ssURLResult{
		Endpoint: url.Host,
		Cipher:   cipherName,
		Secret:   secret,
		Prefix:   url.Query().Get("prefix"),
	}, nil
}

// ssParams is the validated result of parsing any shadowsocks config form.
type ssParams struct {
	endpointNode    composer.Node // set for mapping form with an endpoint node
	endpointAddress string        // set for URL and legacy forms
	key             *shadowsocks.EncryptionKey
	saltGenerator   shadowsocks.SaltGenerator // nil when no prefix
}

// endpoint returns the endpoint as a Node, synthesizing one for
// address-only forms so it flows through the endpoint parser chain.
func (p *ssParams) endpoint() (composer.Node, error) {
	if p.endpointAddress != "" {
		return scalarNode(p.endpointAddress)
	}
	return p.endpointNode, nil
}

// ssFields decodes all shadowsocks mapping forms; presence of Endpoint
// vs Server selects the modern vs legacy schema.
//
// Secret, Password, and ServerPort are read with [composer.Node.Text]: access
// keys in use write passwords made of digits without quotes, and ports with
// them.
type ssFields struct {
	Endpoint composer.Optional[composer.Node]
	Cipher   composer.Optional[string]
	Secret   composer.Optional[composer.Node]
	Prefix   composer.Optional[string]

	Server     composer.Optional[string]
	ServerPort composer.Optional[composer.Node]
	Method     composer.Optional[string]
	Password   composer.Optional[composer.Node]
}

// optionalText returns the text of an optional scalar field, or "" if unset.
func optionalText(field composer.Optional[composer.Node]) (string, error) {
	node, ok := field.Get()
	if !ok {
		return "", nil
	}
	return node.Text()
}

func parseShadowsocksNode(node composer.Node) (*ssParams, error) {
	var cipher, secret, prefix, endpointAddress string
	var endpointNode composer.Node

	if node.Kind() == composer.KindScalar {
		var urlText string
		if err := node.Decode(&urlText); err != nil {
			return nil, err
		}
		u, err := url.Parse(urlText)
		if err != nil {
			return nil, fmt.Errorf("string config is not a valid URL: %w", err)
		}
		res, err := parseShadowsocksURL(*u)
		if err != nil {
			return nil, err
		}
		endpointAddress, cipher, secret, prefix = res.Endpoint, res.Cipher, res.Secret, res.Prefix
	} else {
		var f ssFields
		if err := node.Decode(&f); err != nil {
			return nil, err
		}
		var err error
		if ep, ok := f.Endpoint.Get(); ok {
			endpointNode = ep
			cipher = f.Cipher.Or("")
			if secret, err = optionalText(f.Secret); err != nil {
				return nil, err
			}
		} else if server, ok := f.Server.Get(); ok {
			portText, err := optionalText(f.ServerPort)
			if err != nil {
				return nil, err
			}
			if portText == "" {
				return nil, errors.New("legacy shadowsocks config missing server_port")
			}
			port, err := strconv.ParseUint(portText, 10, 16)
			if err != nil {
				return nil, fmt.Errorf("invalid server_port: %w", err)
			}
			endpointAddress = net.JoinHostPort(server, strconv.FormatUint(port, 10))
			cipher = f.Method.Or("")
			if secret, err = optionalText(f.Password); err != nil {
				return nil, err
			}
		} else {
			return nil, errors.New("shadowsocks config missing endpoint")
		}
		prefix = f.Prefix.Or("")
	}

	if cipher == "" {
		return nil, errors.New("cipher must not be empty")
	}
	if secret == "" {
		return nil, errors.New("secret must not be empty")
	}
	params := &ssParams{endpointNode: endpointNode, endpointAddress: endpointAddress}
	var err error
	params.key, err = shadowsocks.NewEncryptionKey(cipher, secret)
	if err != nil {
		return nil, fmt.Errorf("invalid cipher: %w", err)
	}
	if prefix != "" {
		prefixBytes, err := parseStringPrefix(prefix)
		if err != nil {
			return nil, fmt.Errorf("invalid prefix: %w", err)
		}
		params.saltGenerator = shadowsocks.NewPrefixSaltGenerator(prefixBytes)
	}
	return params, nil
}

// ShadowsocksStreamDialerConfig dials streams through a Shadowsocks proxy.
type ShadowsocksStreamDialerConfig struct {
	// Endpoint connects to the proxy.
	Endpoint StreamEndpointConfig
	key      *shadowsocks.EncryptionKey
	// SaltGenerator, if set, replaces the random salt generator. The prefix
	// field of a config sets it.
	SaltGenerator shadowsocks.SaltGenerator
}

// NewStreamDialer implements [StreamDialerConfig].
func (c *ShadowsocksStreamDialerConfig) NewStreamDialer(ctx context.Context) (transport.StreamDialer, error) {
	se, err := c.Endpoint.NewStreamEndpoint(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build StreamEndpoint: %w", err)
	}
	sd, err := shadowsocks.NewStreamDialer(se, c.key)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}
	if c.SaltGenerator != nil {
		sd.SaltGenerator = c.SaltGenerator
	}
	return sd, nil
}

// ShadowsocksPacketListenerConfig sends and receives packets through a
// Shadowsocks proxy.
type ShadowsocksPacketListenerConfig struct {
	// Endpoint connects to the proxy.
	Endpoint PacketEndpointConfig
	key      *shadowsocks.EncryptionKey
	// SaltGenerator, if set, replaces the random salt generator. The prefix
	// field of a config sets it.
	SaltGenerator shadowsocks.SaltGenerator
}

// NewPacketListener implements [PacketListenerConfig].
func (c *ShadowsocksPacketListenerConfig) NewPacketListener(ctx context.Context) (transport.PacketListener, error) {
	pe, err := c.Endpoint.NewPacketEndpoint(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build PacketEndpoint: %w", err)
	}
	pl, err := shadowsocks.NewPacketListener(pe, c.key)
	if err != nil {
		return nil, err
	}
	if c.SaltGenerator != nil {
		pl.SetSaltGenerator(c.SaltGenerator)
	}
	return pl, nil
}

// ShadowsocksPacketDialerConfig dials packet connections through a
// Shadowsocks proxy, each over its own association from Listener.
type ShadowsocksPacketDialerConfig struct {
	Listener *ShadowsocksPacketListenerConfig
}

// NewPacketDialer implements [PacketDialerConfig].
func (c *ShadowsocksPacketDialerConfig) NewPacketDialer(ctx context.Context) (transport.PacketDialer, error) {
	pl, err := c.Listener.NewPacketListener(ctx)
	if err != nil {
		return nil, err
	}
	return transport.PacketListenerDialer{Listener: pl}, nil
}

// ParseShadowsocksStreamDialer parses a Shadowsocks stream dialer.
//
// The config is one of:
//   - an ss:// URL, in SIP002 or the older fully encoded form
//   - a mapping with endpoint, cipher, secret, and an optional prefix
//   - a mapping in the Shadowsocks JSON form, with server, server_port,
//     method, and password
//
// The endpoint is parsed with registry. For the forms that give an address,
// the address is handed to the registry as a string, so the application's
// rules for endpoints apply to every form.
func ParseShadowsocksStreamDialer(ctx context.Context, registry composer.Registry, node composer.Node) (*ShadowsocksStreamDialerConfig, error) {
	params, err := parseShadowsocksNode(node)
	if err != nil {
		return nil, err
	}
	epNode, err := params.endpoint()
	if err != nil {
		return nil, err
	}
	se, err := composer.Parse[StreamEndpointConfig](ctx, registry, epNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse StreamEndpoint: %w", err)
	}
	return &ShadowsocksStreamDialerConfig{Endpoint: se, key: params.key, SaltGenerator: params.saltGenerator}, nil
}

// ParseShadowsocksPacketListener parses a Shadowsocks packet listener. It
// takes the same config forms as [ParseShadowsocksStreamDialer].
func ParseShadowsocksPacketListener(ctx context.Context, registry composer.Registry, node composer.Node) (*ShadowsocksPacketListenerConfig, error) {
	params, err := parseShadowsocksNode(node)
	if err != nil {
		return nil, err
	}
	epNode, err := params.endpoint()
	if err != nil {
		return nil, err
	}
	pe, err := composer.Parse[PacketEndpointConfig](ctx, registry, epNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse PacketEndpoint: %w", err)
	}
	return &ShadowsocksPacketListenerConfig{Endpoint: pe, key: params.key, SaltGenerator: params.saltGenerator}, nil
}

// ParseShadowsocksPacketDialer parses a Shadowsocks packet dialer. It takes
// the same config as [ParseShadowsocksPacketListener].
func ParseShadowsocksPacketDialer(ctx context.Context, registry composer.Registry, node composer.Node) (*ShadowsocksPacketDialerConfig, error) {
	pl, err := ParseShadowsocksPacketListener(ctx, registry, node)
	if err != nil {
		return nil, err
	}
	return &ShadowsocksPacketDialerConfig{Listener: pl}, nil
}
