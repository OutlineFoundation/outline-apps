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
	"encoding/json"
	"errors"
	"net"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

// NewRegistry returns the registry with the config types of the Outline Client. Parse a transport
// with composer.Parse[*TransportPair]. Register more types on the result with [composer.Register].
//
// directSD and directPD make the connections that leave the device.
func NewRegistry(directSD transport.StreamDialer, directPD transport.PacketDialer) composer.MutableRegistry {
	// The registry comes with first-supported for every type.
	r := composer.NewRegistry()

	var directWrappedSD *Dialer[transport.StreamConn]
	if directSD != nil {
		directWrappedSD = &Dialer[transport.StreamConn]{ConnectionProviderInfo{ConnTypeDirect, ""}, directSD.DialStream}
	}
	var directWrappedPD *Dialer[net.Conn]
	if directPD != nil {
		directWrappedPD = &Dialer[net.Conn]{ConnectionProviderInfo{ConnTypeDirect, ""}, directPD.DialPacket}
	}
	directWrappedPL := &PacketListener{ConnectionProviderInfo{ConnTypeDirect, ""}, &transport.UDPListener{}}

	// Stream dialers.
	composer.Register(r, composer.DefaultName, func(ctx context.Context, r composer.Registry, node composer.Node) (*Dialer[transport.StreamConn], error) {
		switch node.Kind() {
		case composer.KindAbsent:
			// An absent config implicitly means direct access.
			return directWrappedSD, nil
		case composer.KindScalar:
			// Parse URL-style config.
			return parseShadowsocksStreamDialer(ctx, r, node)
		default:
			return nil, errors.New("parser not specified")
		}
	})
	composer.Register(r, "block", parseBlockDialer[transport.StreamConn])
	composer.Register(r, "direct", func(context.Context, composer.Registry, composer.Node) (*Dialer[transport.StreamConn], error) {
		return directWrappedSD, nil
	})
	composer.Register(r, "iptable", parseIPTableStreamDialer)
	composer.Register(r, "shadowsocks", parseShadowsocksStreamDialer)

	// Packet dialers.
	composer.Register(r, composer.DefaultName, func(ctx context.Context, r composer.Registry, node composer.Node) (*Dialer[net.Conn], error) {
		switch node.Kind() {
		case composer.KindAbsent:
			// An absent config implicitly means direct access.
			return directWrappedPD, nil
		case composer.KindScalar:
			// Parse URL-style config.
			return parseShadowsocksPacketDialer(ctx, r, node)
		default:
			return nil, errors.New("parser not specified")
		}
	})
	composer.Register(r, "block", parseBlockDialer[net.Conn])
	composer.Register(r, "direct", func(context.Context, composer.Registry, composer.Node) (*Dialer[net.Conn], error) {
		return directWrappedPD, nil
	})
	composer.Register(r, "shadowsocks", parseShadowsocksPacketDialer)

	// Packet listeners.
	composer.Register(r, composer.DefaultName, func(ctx context.Context, r composer.Registry, node composer.Node) (*PacketListener, error) {
		if node.IsAbsent() {
			// An absent config implicitly means UDP.
			return directWrappedPL, nil
		}
		return nil, errors.New("parser not specified")
	})
	composer.Register(r, "direct", func(context.Context, composer.Registry, composer.Node) (*PacketListener, error) {
		return directWrappedPL, nil
	})
	composer.Register(r, "shadowsocks", parseShadowsocksPacketListener)

	// Stream endpoints.
	// TODO: perhaps only support string in the default to force the struct to have an explicit parser.
	composer.Register(r, composer.DefaultName, parseDialEndpoint[transport.StreamConn])
	composer.Register(r, "dial", parseDialEndpoint[transport.StreamConn])
	composer.Register(r, "websocket", parseWebsocketStreamEndpoint)

	// Packet endpoints.
	composer.Register(r, composer.DefaultName, parseDialEndpoint[net.Conn])
	composer.Register(r, "dial", parseDialEndpoint[net.Conn])
	composer.Register(r, "websocket", parseWebsocketPacketEndpoint)

	// Transport pairs.
	// If $type is missing, parse as Shadowsocks for backwards-compatibility.
	composer.Register(r, composer.DefaultName, parseShadowsocksTransport)
	composer.Register(r, "tcpudp", parseTCPUDPTransportPair)
	composer.Register(r, "basic-access", parseProxylessTransportPair)

	return r
}

// stringNode returns the config node for a string that a parser derived, such as a default
// endpoint address, so that it is parsed through the registry like one written in the config.
func stringNode(value string) (composer.Node, error) {
	// JSON is a subset of YAML.
	text, err := json.Marshal(value)
	if err != nil {
		return composer.Node{}, err
	}
	return composer.ParseYAML(text)
}
