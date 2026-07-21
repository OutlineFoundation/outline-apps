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

package configregistry

import (
	"context"
	"errors"
	"fmt"
	"math/rand"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/transport/tlsfrag"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/composer/registry"
)

// TransportPairParts is a built transport before Outline's DNS policy is
// applied.
type TransportPairParts struct {
	StreamDialer   transport.StreamDialer
	PacketListener transport.PacketListener
}

// TransportPairConfig is a parsed Outline transport strategy.
type TransportPairConfig interface {
	NewTransportPair(ctx context.Context) (*TransportPairParts, error)
}

// TransportPairKind is Outline's extension point for whole transports.
var TransportPairKind = registry.NewKind[TransportPairConfig]("transport pair")

// TCPUDPTransportConfig pairs independent TCP and UDP strategies.
type TCPUDPTransportConfig struct {
	TCP netconfig.StreamDialerConfig
	UDP netconfig.PacketListenerConfig
}

func (c *TCPUDPTransportConfig) NewTransportPair(ctx context.Context) (*TransportPairParts, error) {
	sd, err := c.TCP.NewStreamDialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build StreamDialer: %w", err)
	}
	pl, err := c.UDP.NewPacketListener(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build PacketListener: %w", err)
	}
	return &TransportPairParts{StreamDialer: sd, PacketListener: pl}, nil
}

type tcpudpFields struct {
	TCP composer.Optional[composer.Node]
	UDP composer.Optional[composer.Node]
}

func registerTCPUDP(r registry.Registrar) error {
	parseStreamDialer := registry.Parser(r, netconfig.StreamDialerKind)
	parsePacketListener := registry.Parser(r, netconfig.PacketListenerKind)
	parse := func(ctx context.Context, node composer.Node) (*TCPUDPTransportConfig, error) {
		var fields tcpudpFields
		if err := node.Decode(&fields); err != nil {
			return nil, fmt.Errorf("invalid config format: %w", err)
		}
		tcpNode, _ := fields.TCP.Get()
		sd, err := parseStreamDialer(ctx, tcpNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse StreamDialer: %w", err)
		}
		udpNode, _ := fields.UDP.Get()
		pl, err := parsePacketListener(ctx, udpNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse PacketListener: %w", err)
		}
		return &TCPUDPTransportConfig{TCP: sd, UDP: pl}, nil
	}
	return registry.Register(r, TransportPairKind, "tcpudp", asTransportPair(parse))
}

// ShadowsocksTransportConfig is the legacy transport form: one Shadowsocks
// config used for both TCP and UDP.
type ShadowsocksTransportConfig struct {
	StreamDialer   *netconfig.ShadowsocksStreamDialerConfig
	PacketListener *netconfig.ShadowsocksPacketListenerConfig
}

func (c *ShadowsocksTransportConfig) NewTransportPair(ctx context.Context) (*TransportPairParts, error) {
	sd, err := c.StreamDialer.NewStreamDialer(ctx)
	if err != nil {
		return nil, err
	}
	pl, err := c.PacketListener.NewPacketListener(ctx)
	if err != nil {
		return nil, err
	}
	return &TransportPairParts{StreamDialer: sd, PacketListener: pl}, nil
}

func registerLegacyShadowsocks(r registry.Registrar) error {
	parseStream := netconfig.NewShadowsocksStreamDialerParser(registry.Parser(r, netconfig.StreamEndpointKind))
	parsePacket := netconfig.NewShadowsocksPacketListenerParser(registry.Parser(r, netconfig.PacketEndpointKind))
	parse := func(ctx context.Context, node composer.Node) (*ShadowsocksTransportConfig, error) {
		if node.IsAbsent() {
			return nil, errors.New("transport config missing")
		}
		stream, err := parseStream(ctx, node)
		if err != nil {
			return nil, err
		}
		packet, err := parsePacket(ctx, node)
		if err != nil {
			return nil, err
		}
		// The legacy transport prefix applies only to TCP.
		packet.SaltGenerator = nil
		return &ShadowsocksTransportConfig{StreamDialer: stream, PacketListener: packet}, nil
	}
	return registry.RegisterFallback(r, TransportPairKind, asTransportPair(parse))
}

const (
	minSplit = 6
	maxSplit = 64
)

// BasicAccessTransportConfig is direct access with TLS fragmentation.
type BasicAccessTransportConfig struct{}

func (c *BasicAccessTransportConfig) NewTransportPair(context.Context) (*TransportPairParts, error) {
	length := minSplit + rand.Intn(maxSplit+1-minSplit)
	fragSD, err := tlsfrag.NewFixedLenStreamDialer(&transport.TCPDialer{}, length)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}
	return &TransportPairParts{StreamDialer: fragSD, PacketListener: &transport.UDPListener{}}, nil
}

func registerBasicAccess(r registry.Registrar) error {
	parse := func(_ context.Context, node composer.Node) (*BasicAccessTransportConfig, error) {
		var fields struct{}
		if err := node.Decode(&fields); err != nil {
			return nil, fmt.Errorf("invalid config format: %w", err)
		}
		return &BasicAccessTransportConfig{}, nil
	}
	return registry.Register(r, TransportPairKind, "basic-access", asTransportPair(parse))
}

func asTransportPair[Cfg TransportPairConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[TransportPairConfig] {
	return func(ctx context.Context, node composer.Node) (TransportPairConfig, error) {
		return parse(ctx, node)
	}
}

func asStreamDialer[Cfg netconfig.StreamDialerConfig](parse composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.StreamDialerConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.StreamDialerConfig, error) {
		return parse(ctx, node)
	}
}
