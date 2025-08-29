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
	"errors"
	"net"

	"github.com/Jigsaw-Code/outline-apps/client/go/configyaml"
	"github.com/Jigsaw-Code/outline-sdk/transport"
)

// newTypeParser is a wrapper around [configyaml.NewTypeParser] that allows us to centralize the registration
// of subparsers that should apply to all supported types.
func newTypeParser[T any](fallbackHandler func(context.Context, configyaml.ConfigNode) (T, error)) *configyaml.TypeParser[T] {
	parser := configyaml.NewTypeParser(fallbackHandler)

	// Registrations that should apply to all supported type.
	parser.RegisterSubParser("first-supported", NewFirstSupportedSubParser(parser.Parse))

	return parser
}

// NewDefaultTransportProvider provider a [TransportPair].
func NewDefaultTransportProvider(tcpDialer transport.StreamDialer, udpDialer transport.PacketDialer) *configyaml.TypeParser[*TransportPair] {
	var streamEndpoints *configyaml.TypeParser[*Endpoint[transport.StreamConn]]
	var packetEndpoints *configyaml.TypeParser[*Endpoint[net.Conn]]

	streamDialers := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*Dialer[transport.StreamConn], error) {
		switch input.(type) {
		case nil:
			// An absent config implicitly means TCP.
			return &Dialer[transport.StreamConn]{ConnectionProviderInfo{ConnTypeDirect, ""}, tcpDialer.DialStream}, nil
		case string:
			// Parse URL-style config.
			return parseShadowsocksStreamDialer(ctx, input, streamEndpoints.Parse)
		default:
			return nil, errors.New("parser not specified")
		}
	})

	packetDialers := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*Dialer[net.Conn], error) {
		switch input.(type) {
		case nil:
			// An absent config implicitly means UDP.
			return &Dialer[net.Conn]{ConnectionProviderInfo{ConnTypeDirect, ""}, udpDialer.DialPacket}, nil
		case string:
			// Parse URL-style config.
			return parseShadowsocksPacketDialer(ctx, input, packetEndpoints.Parse)
		default:
			return nil, errors.New("parser not specified")
		}
	})

	packetListeners := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*PacketListener, error) {
		switch input.(type) {
		case nil:
			// An absent config implicitly means UDP.
			return &PacketListener{ConnectionProviderInfo{ConnTypeDirect, ""}, &transport.UDPListener{}}, nil
		default:
			return nil, errors.New("parser not specified")
		}
	})

	streamEndpoints = newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*Endpoint[transport.StreamConn], error) {
		// TODO: perhaps only support string here to force the struct to have an explicit parser.
		return parseDirectDialerEndpoint(ctx, input, streamDialers.Parse)
	})

	packetEndpoints = newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*Endpoint[net.Conn], error) {
		return parseDirectDialerEndpoint(ctx, input, packetDialers.Parse)
	})

	transports := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*TransportPair, error) {
		// If parser directive is missing, parse as Shadowsocks for backwards-compatibility.
		return parseShadowsocksTransport(ctx, input, streamEndpoints.Parse, packetEndpoints.Parse)
	})

	// Stream endpoints.
	streamEndpoints.RegisterSubParser("dial", NewDialEndpointSubParser(streamDialers.Parse))
	streamEndpoints.RegisterSubParser("websocket", NewWebsocketStreamEndpointSubParser(streamEndpoints.Parse))

	// Packet endpoints.
	packetEndpoints.RegisterSubParser("dial", NewDialEndpointSubParser(packetDialers.Parse))
	packetEndpoints.RegisterSubParser("websocket", NewWebsocketPacketEndpointSubParser(streamEndpoints.Parse))

	// Stream dialers.
	streamDialers.RegisterSubParser("iptable", NewIPTableStreamDialerSubParser(streamDialers.Parse))
	streamDialers.RegisterSubParser("shadowsocks", NewShadowsocksStreamDialerSubParser(streamEndpoints.Parse))

	// Packet dialers.
	packetDialers.RegisterSubParser("shadowsocks", NewShadowsocksPacketDialerSubParser(packetEndpoints.Parse))

	// Packet listeners.
	packetListeners.RegisterSubParser("shadowsocks", NewShadowsocksPacketListenerSubParser(packetEndpoints.Parse))

	// Transport pairs.
	transports.RegisterSubParser("tcpudp", NewTCPUDPTransportPairSubParser(streamDialers.Parse, packetListeners.Parse))

	return transports
}
