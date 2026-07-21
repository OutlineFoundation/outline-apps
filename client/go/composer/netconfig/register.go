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
	"fmt"

	"localhost/client/go/composer"
	"localhost/client/go/composer/registry"
)

// RegisterShadowsocks registers every Shadowsocks networking component under
// name. It registers named entries only; applications choose any fallbacks.
func RegisterShadowsocks(r registry.Registrar, name registry.TypeName) error {
	streamParser := NewShadowsocksStreamDialerParser(registry.Parser(r, StreamEndpointKind))
	if err := registry.Register(r, StreamDialerKind, name, asStreamDialer(streamParser)); err != nil {
		return fmt.Errorf("register Shadowsocks stream dialer: %w", err)
	}
	packetListenerParser := NewShadowsocksPacketListenerParser(registry.Parser(r, PacketEndpointKind))
	if err := registry.Register(r, PacketListenerKind, name, asPacketListener(packetListenerParser)); err != nil {
		return fmt.Errorf("register Shadowsocks packet listener: %w", err)
	}
	packetDialerParser := NewShadowsocksPacketDialerParser(registry.Parser(r, PacketEndpointKind))
	if err := registry.Register(r, PacketDialerKind, name, asPacketDialer(packetDialerParser)); err != nil {
		return fmt.Errorf("register Shadowsocks packet dialer: %w", err)
	}
	return nil
}

// RegisterWebsocket registers WebSocket stream and packet endpoints under
// name. It registers named entries only; applications choose any fallbacks.
func RegisterWebsocket(r registry.Registrar, name registry.TypeName, opts ...WebsocketOption) error {
	parser := NewWebsocketEndpointParser(registry.Parser(r, StreamEndpointKind), opts...)
	if err := registry.Register(r, StreamEndpointKind, name, asStreamEndpoint(parser)); err != nil {
		return fmt.Errorf("register WebSocket stream endpoint: %w", err)
	}
	if err := registry.Register(r, PacketEndpointKind, name, asPacketEndpoint(parser)); err != nil {
		return fmt.Errorf("register WebSocket packet endpoint: %w", err)
	}
	return nil
}

// RegisterDialEndpoint registers stream and packet dial endpoints under name.
// It registers named entries only; applications choose any fallbacks.
func RegisterDialEndpoint(r registry.Registrar, name registry.TypeName) error {
	streamParser := NewStreamDialEndpointParser(registry.Parser(r, StreamDialerKind))
	if err := registry.Register(r, StreamEndpointKind, name, asStreamEndpoint(streamParser)); err != nil {
		return fmt.Errorf("register stream dial endpoint: %w", err)
	}
	packetParser := NewPacketDialEndpointParser(registry.Parser(r, PacketDialerKind))
	if err := registry.Register(r, PacketEndpointKind, name, asPacketEndpoint(packetParser)); err != nil {
		return fmt.Errorf("register packet dial endpoint: %w", err)
	}
	return nil
}

// RegisterBlock registers blocked stream and packet dialers under name. It
// registers named entries only; applications choose any fallbacks.
func RegisterBlock(r registry.Registrar, name registry.TypeName) error {
	if err := registry.Register(r, StreamDialerKind, name, asStreamDialer(ParseBlock)); err != nil {
		return fmt.Errorf("register blocked stream dialer: %w", err)
	}
	if err := registry.Register(r, PacketDialerKind, name, asPacketDialer(ParseBlock)); err != nil {
		return fmt.Errorf("register blocked packet dialer: %w", err)
	}
	return nil
}

// RegisterDirect registers the supplied direct-access configs under name. The
// parser returns the exact supplied pointers. It registers named entries only;
// applications choose any fallbacks.
func RegisterDirect(
	r registry.Registrar,
	name registry.TypeName,
	stream *DirectStreamDialerConfig,
	packet *DirectPacketDialerConfig,
	listener *DirectPacketListenerConfig,
) error {
	if stream == nil || packet == nil || listener == nil {
		return errors.New("register direct: configs must not be nil")
	}
	if err := registry.Register(r, StreamDialerKind, name, constantParser[StreamDialerConfig](stream)); err != nil {
		return fmt.Errorf("register direct stream dialer: %w", err)
	}
	if err := registry.Register(r, PacketDialerKind, name, constantParser[PacketDialerConfig](packet)); err != nil {
		return fmt.Errorf("register direct packet dialer: %w", err)
	}
	if err := registry.Register(r, PacketListenerKind, name, constantParser[PacketListenerConfig](listener)); err != nil {
		return fmt.Errorf("register direct packet listener: %w", err)
	}
	return nil
}

func constantParser[Cfg any](cfg Cfg) composer.ParseFunc[Cfg] {
	return func(context.Context, composer.Node) (Cfg, error) { return cfg, nil }
}

func asStreamDialer[Cfg StreamDialerConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[StreamDialerConfig] {
	return func(ctx context.Context, node composer.Node) (StreamDialerConfig, error) {
		return parse(ctx, node)
	}
}

func asPacketDialer[Cfg PacketDialerConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[PacketDialerConfig] {
	return func(ctx context.Context, node composer.Node) (PacketDialerConfig, error) {
		return parse(ctx, node)
	}
}

func asStreamEndpoint[Cfg StreamEndpointConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[StreamEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (StreamEndpointConfig, error) {
		return parse(ctx, node)
	}
}

func asPacketEndpoint[Cfg PacketEndpointConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[PacketEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (PacketEndpointConfig, error) {
		return parse(ctx, node)
	}
}

func asPacketListener[Cfg PacketListenerConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[PacketListenerConfig] {
	return func(ctx context.Context, node composer.Node) (PacketListenerConfig, error) {
		return parse(ctx, node)
	}
}
