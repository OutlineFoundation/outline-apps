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

// Package configregistry owns Outline's Composer registration, compatibility
// behavior, connection analysis, and transport policy.
package configregistry

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/composer/registry"
	"localhost/client/go/outline/useragent"
)

// Register installs Outline's config vocabulary and compatibility fallbacks.
func Register(r registry.Registrar, directSD transport.StreamDialer, directPD transport.PacketDialer) error {
	directStream := netconfig.NewDirectStreamDialerConfig(directSD)
	directPacket := netconfig.NewDirectPacketDialerConfig(directPD)
	directListener := netconfig.NewDirectPacketListenerConfig(&transport.UDPListener{})

	// Named registrations, sorted by their $type value.
	if err := registerBasicAccess(r); err != nil {
		return fmt.Errorf("register basic-access: %w", err)
	}
	if err := netconfig.RegisterBlock(r, "block"); err != nil {
		return fmt.Errorf("register block: %w", err)
	}
	if err := netconfig.RegisterDialEndpoint(r, "dial"); err != nil {
		return fmt.Errorf("register dial endpoint: %w", err)
	}
	if err := netconfig.RegisterDirect(r, "direct", directStream, directPacket, directListener); err != nil {
		return fmt.Errorf("register direct: %w", err)
	}
	if err := registerIPTable(r); err != nil {
		return fmt.Errorf("register iptable: %w", err)
	}
	if err := netconfig.RegisterShadowsocks(r, "shadowsocks"); err != nil {
		return fmt.Errorf("register shadowsocks: %w", err)
	}
	if err := registerTCPUDP(r); err != nil {
		return fmt.Errorf("register tcpudp: %w", err)
	}
	headers := http.Header{"User-Agent": []string{useragent.GetOutlineUserAgent()}}
	if err := netconfig.RegisterWebsocket(r, "websocket", netconfig.WithWebsocketHeaders(headers)); err != nil {
		return fmt.Errorf("register websocket: %w", err)
	}

	// Unnamed compatibility fallbacks.
	if err := registerCompatibility(r, directStream, directPacket, directListener); err != nil {
		return fmt.Errorf("register compatibility fallbacks: %w", err)
	}
	if err := registerLegacyShadowsocks(r); err != nil {
		return fmt.Errorf("register legacy shadowsocks: %w", err)
	}
	return nil
}

// registerCompatibility installs Outline's $type-less compatibility forms:
// endpoint values default to dial endpoints, absent dialers/listeners mean
// direct access, and scalar dialers use the legacy Shadowsocks URL form. These
// fallbacks combine application wire compatibility with app-owned defaults, so
// they intentionally do not live in netconfig's reusable registration helpers.
func registerCompatibility(
	r registry.Registrar,
	directStream *netconfig.DirectStreamDialerConfig,
	directPacket *netconfig.DirectPacketDialerConfig,
	directListener *netconfig.DirectPacketListenerConfig,
) error {
	parseStreamEndpoint := netconfig.NewStreamDialEndpointParser(registry.Parser(r, netconfig.StreamDialerKind))
	if err := registry.RegisterFallback(r, netconfig.StreamEndpointKind, asStreamEndpoint(parseStreamEndpoint)); err != nil {
		return fmt.Errorf("stream endpoint fallback: %w", err)
	}
	parsePacketEndpoint := netconfig.NewPacketDialEndpointParser(registry.Parser(r, netconfig.PacketDialerKind))
	if err := registry.RegisterFallback(r, netconfig.PacketEndpointKind, asPacketEndpoint(parsePacketEndpoint)); err != nil {
		return fmt.Errorf("packet endpoint fallback: %w", err)
	}

	parseShadowsocksStream := netconfig.NewShadowsocksStreamDialerParser(registry.Parser(r, netconfig.StreamEndpointKind))
	if err := registry.RegisterFallback(r, netconfig.StreamDialerKind,
		func(ctx context.Context, node composer.Node) (netconfig.StreamDialerConfig, error) {
			switch node.Kind() {
			case composer.KindAbsent:
				return directStream, nil
			case composer.KindScalar:
				return parseShadowsocksStream(ctx, node)
			default:
				return nil, errors.New("parser not specified")
			}
		}); err != nil {
		return fmt.Errorf("stream dialer fallback: %w", err)
	}

	parseShadowsocksPacket := netconfig.NewShadowsocksPacketDialerParser(registry.Parser(r, netconfig.PacketEndpointKind))
	if err := registry.RegisterFallback(r, netconfig.PacketDialerKind,
		func(ctx context.Context, node composer.Node) (netconfig.PacketDialerConfig, error) {
			switch node.Kind() {
			case composer.KindAbsent:
				return directPacket, nil
			case composer.KindScalar:
				return parseShadowsocksPacket(ctx, node)
			default:
				return nil, errors.New("parser not specified")
			}
		}); err != nil {
		return fmt.Errorf("packet dialer fallback: %w", err)
	}

	if err := registry.RegisterFallback(r, netconfig.PacketListenerKind,
		func(_ context.Context, node composer.Node) (netconfig.PacketListenerConfig, error) {
			if !node.IsAbsent() {
				return nil, errors.New("parser not specified")
			}
			return directListener, nil
		}); err != nil {
		return fmt.Errorf("packet listener fallback: %w", err)
	}
	return nil
}

func asStreamEndpoint[Cfg netconfig.StreamEndpointConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.StreamEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.StreamEndpointConfig, error) {
		return parse(ctx, node)
	}
}

func asPacketEndpoint[Cfg netconfig.PacketEndpointConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.PacketEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.PacketEndpointConfig, error) {
		return parse(ctx, node)
	}
}
