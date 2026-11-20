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

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/outline/configregistry"
)

// AddressResolver returns the address to dial in place of address. It
// returns address itself when it cannot do better.
type AddressResolver func(ctx context.Context, address string) string

// Where the client cannot protect the system resolver's connections from the
// VPN (Linux and Windows), it resolves the address of a direct endpoint when
// the endpoint is built, before the VPN is up. The reported first hop stays
// the address as written. These types add that step to the dial endpoints;
// the parsed configs they embed are not modified.

type resolvingStreamDialEndpoint struct {
	*netconfig.StreamDialEndpointConfig
	resolve AddressResolver
}

func (c *resolvingStreamDialEndpoint) NewStreamEndpoint(ctx context.Context) (transport.StreamEndpoint, error) {
	cfg := *c.StreamDialEndpointConfig
	if isDirect(cfg.Dialer) {
		cfg.Address = c.resolve(ctx, cfg.Address)
	}
	return cfg.NewStreamEndpoint(ctx)
}

type resolvingPacketDialEndpoint struct {
	*netconfig.PacketDialEndpointConfig
	resolve AddressResolver
}

func (c *resolvingPacketDialEndpoint) NewPacketEndpoint(ctx context.Context) (transport.PacketEndpoint, error) {
	cfg := *c.PacketDialEndpointConfig
	if isDirect(cfg.Dialer) {
		cfg.Address = c.resolve(ctx, cfg.Address)
	}
	return cfg.NewPacketEndpoint(ctx)
}

func isDirect(dialer any) bool {
	info, err := Describe(dialer)
	return err == nil && info.ConnType == configregistry.ConnTypeDirect
}

func newResolvingStreamDialEndpointParser(resolve AddressResolver) composer.Parser[netconfig.StreamEndpointConfig] {
	return func(ctx context.Context, r composer.Registry, node composer.Node) (netconfig.StreamEndpointConfig, error) {
		cfg, err := netconfig.ParseStreamDialEndpoint(ctx, r, node)
		if err != nil {
			return nil, err
		}
		return &resolvingStreamDialEndpoint{cfg, resolve}, nil
	}
}

func newResolvingPacketDialEndpointParser(resolve AddressResolver) composer.Parser[netconfig.PacketEndpointConfig] {
	return func(ctx context.Context, r composer.Registry, node composer.Node) (netconfig.PacketEndpointConfig, error) {
		cfg, err := netconfig.ParsePacketDialEndpoint(ctx, r, node)
		if err != nil {
			return nil, err
		}
		return &resolvingPacketDialEndpoint{cfg, resolve}, nil
	}
}
