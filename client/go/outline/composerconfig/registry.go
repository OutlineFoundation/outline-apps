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

package composerconfig

import (
	"context"
	"net/http"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
)

// Options configures Outline's vocabulary.
type Options struct {
	// DirectStreamDialer and DirectPacketDialer make the device's own
	// connections, for example with sockets excluded from the VPN. Every
	// config that reaches the network builds on them.
	DirectStreamDialer transport.StreamDialer
	DirectPacketDialer transport.PacketDialer
	// WebsocketHeaders are sent with every WebSocket handshake.
	WebsocketHeaders http.Header
	// ResolveDirect, if set, resolves the address of an endpoint dialed
	// directly when the endpoint is built.
	ResolveDirect AddressResolver
}

// NewRegistry returns a registry holding Outline's vocabulary. Callers may
// register more components on it, or overlay and intercept it, before
// parsing.
func NewRegistry(opts Options) composer.MutableRegistry {
	type (
		streamDialer   = netconfig.StreamDialerConfig
		packetDialer   = netconfig.PacketDialerConfig
		packetListener = netconfig.PacketListenerConfig
		streamEndpoint = netconfig.StreamEndpointConfig
		packetEndpoint = netconfig.PacketEndpointConfig
	)
	r := composer.NewRegistry()
	registerDefaults(r)

	// Named registrations, sorted by $type.
	composer.Register(r, "basic-access", composer.As[TransportPairConfig](parseBasicAccess))

	composer.Register(r, "block", composer.As[streamDialer](netconfig.ParseBlock))
	composer.Register(r, "block", composer.As[packetDialer](netconfig.ParseBlock))

	if opts.ResolveDirect == nil {
		composer.Register(r, "dial", composer.As[streamEndpoint](netconfig.ParseStreamDialEndpoint))
		composer.Register(r, "dial", composer.As[packetEndpoint](netconfig.ParsePacketDialEndpoint))
	} else {
		composer.Register(r, "dial", newResolvingStreamDialEndpointParser(opts.ResolveDirect))
		composer.Register(r, "dial", newResolvingPacketDialEndpointParser(opts.ResolveDirect))
	}

	composer.Register(r, "direct", composer.As[streamDialer](netconfig.NewDirectStreamDialerParser(opts.DirectStreamDialer)))
	composer.Register(r, "direct", composer.As[packetDialer](netconfig.NewDirectPacketDialerParser(opts.DirectPacketDialer)))
	composer.Register(r, "direct", composer.As[packetListener](netconfig.NewDirectPacketListenerParser(&transport.UDPListener{})))

	composer.Register(r, "iptable", composer.As[streamDialer](parseIPTable))

	composer.Register(r, "shadowsocks", composer.As[streamDialer](netconfig.ParseShadowsocksStreamDialer))
	composer.Register(r, "shadowsocks", composer.As[packetDialer](netconfig.ParseShadowsocksPacketDialer))
	composer.Register(r, "shadowsocks", composer.As[packetListener](netconfig.ParseShadowsocksPacketListener))

	composer.Register(r, "tcpudp", composer.As[TransportPairConfig](parseTCPUDP))

	parseWebsocket := netconfig.NewWebsocketEndpointParser(netconfig.WithWebsocketHeaders(opts.WebsocketHeaders))
	composer.Register(r, "websocket", composer.As[streamEndpoint](parseWebsocket))
	composer.Register(r, "websocket", composer.As[packetEndpoint](parseWebsocket))

	// A transport without a $type is the legacy Shadowsocks form.
	composer.Register(r, composer.DefaultName, composer.As[TransportPairConfig](parseLegacyShadowsocksTransport))
	return r
}

// ParseTransport parses a transport and describes its connections. It does
// not build any network resource.
func ParseTransport(ctx context.Context, r composer.Registry, node composer.Node) (TransportPairConfig, TransportPairInfo, error) {
	cfg, err := composer.Parse[TransportPairConfig](ctx, r, node)
	if err != nil {
		return nil, TransportPairInfo{}, err
	}
	info, err := DescribeTransport(cfg)
	if err != nil {
		return nil, TransportPairInfo{}, err
	}
	return cfg, info, nil
}
