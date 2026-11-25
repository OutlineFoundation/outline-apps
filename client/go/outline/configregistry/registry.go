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
	"errors"
	"fmt"
	"net"

	"localhost/client/go/configyaml"
	"golang.getoutline.org/sdk/transport"
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
//
// directSD, directPD and directPL are used for direct connections. On platforms where the
// app's own sockets would otherwise go through the VPN, they must be protected from it.
// If any of them is nil, configs that need that direct component fail with [errors.ErrUnsupported].
func NewDefaultTransportProvider(directSD transport.StreamDialer, directPD transport.PacketDialer, directPL transport.PacketListener) *configyaml.TypeParser[*TransportPair] {
	var streamEndpoints *configyaml.TypeParser[*Endpoint[transport.StreamConn]]
	var packetEndpoints *configyaml.TypeParser[*Endpoint[net.Conn]]

	var directWrappedSD *Dialer[transport.StreamConn]
	if directSD != nil {
		directWrappedSD = &Dialer[transport.StreamConn]{ConnectionProviderInfo{ConnTypeDirect, ""}, directSD.DialStream}
	}
	streamDialers := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*Dialer[transport.StreamConn], error) {
		switch input.(type) {
		case nil:
			// An absent config implicitly means direct access.
			return getDirectComponent(directWrappedSD, "stream dialer")
		case string:
			// Parse URL-style config.
			return parseShadowsocksStreamDialer(ctx, input, streamEndpoints.Parse)
		default:
			return nil, errors.New("parser not specified")
		}
	})

	var directWrappedPD *Dialer[net.Conn]
	if directPD != nil {
		directWrappedPD = &Dialer[net.Conn]{ConnectionProviderInfo{ConnTypeDirect, ""}, directPD.DialPacket}
	}
	packetDialers := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*Dialer[net.Conn], error) {
		switch input.(type) {
		case nil:
			// An absent config implicitly means direct access.
			return getDirectComponent(directWrappedPD, "packet dialer")
		case string:
			// Parse URL-style config.
			return parseShadowsocksPacketDialer(ctx, input, packetEndpoints.Parse)
		default:
			return nil, errors.New("parser not specified")
		}
	})

	var directWrappedPL *PacketListener
	if directPL != nil {
		directWrappedPL = &PacketListener{ConnectionProviderInfo{ConnTypeDirect, ""}, directPL}
	}
	packetListeners := newTypeParser(func(ctx context.Context, input configyaml.ConfigNode) (*PacketListener, error) {
		switch input.(type) {
		case nil:
			// An absent config implicitly means UDP.
			return getDirectComponent(directWrappedPL, "packet listener")
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
	streamDialers.RegisterSubParser("block", NewBlockDialerSubParser[transport.StreamConn]())
	streamDialers.RegisterSubParser("direct", func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
		return getDirectComponent(directWrappedSD, "stream dialer")
	})
	streamDialers.RegisterSubParser("iptable", NewIPTableStreamDialerSubParser(streamDialers.Parse))
	streamDialers.RegisterSubParser("shadowsocks", NewShadowsocksStreamDialerSubParser(streamEndpoints.Parse))

	// Packet dialers.
	packetDialers.RegisterSubParser("block", NewBlockDialerSubParser[net.Conn]())
	packetDialers.RegisterSubParser("direct", func(ctx context.Context, input map[string]any) (*Dialer[net.Conn], error) {
		return getDirectComponent(directWrappedPD, "packet dialer")
	})
	packetDialers.RegisterSubParser("shadowsocks", NewShadowsocksPacketDialerSubParser(packetEndpoints.Parse))

	// Packet listeners.
	packetListeners.RegisterSubParser("block", NewBlockPacketListenerSubParser())
	packetListeners.RegisterSubParser("direct", func(ctx context.Context, input map[string]any) (*PacketListener, error) {
		return getDirectComponent(directWrappedPL, "packet listener")
	})
	packetListeners.RegisterSubParser("shadowsocks", NewShadowsocksPacketListenerSubParser(packetEndpoints.Parse))

	// Transport pairs.
	transports.RegisterSubParser("tcpudp", NewTCPUDPTransportPairSubParser(streamDialers.Parse, packetListeners.Parse))
	transports.RegisterSubParser("basic-access", NewProxylessTransportPairSubParser(streamDialers.Parse))

	return transports
}

// getDirectComponent returns the direct component, or an [errors.ErrUnsupported] error if it was not provided.
func getDirectComponent[T any](component *T, name string) (*T, error) {
	if component == nil {
		return nil, fmt.Errorf("direct %s not available: %w", name, errors.ErrUnsupported)
	}
	return component, nil
}
