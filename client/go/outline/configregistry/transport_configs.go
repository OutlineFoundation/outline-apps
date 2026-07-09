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
	"localhost/client/go/netconfig"
)

// TransportPairInfo is the app metadata for a whole transport config.
type TransportPairInfo struct {
	Stream, Packet ConnectionProviderInfo
}

// TransportPairParts is the built output of a transport config, before
// app policies (Outline DNS interception) are applied.
type TransportPairParts struct {
	StreamDialer   transport.StreamDialer
	PacketListener transport.PacketListener
}

// TransportPairConfig is a parsed transport strategy.
type TransportPairConfig interface {
	NewTransportPair(ctx context.Context) (*TransportPairParts, error)
}

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

const (
	minSplit = 6
	maxSplit = 64
)

// randomSplitLength returns a random number in [minSplit, maxSplit].
// splitLength includes 5 bytes of TLS header.
func randomSplitLength() int {
	return minSplit + rand.Intn(maxSplit+1-minSplit)
}

// BasicAccessTransportConfig is direct access with TLS fragmentation.
type BasicAccessTransportConfig struct{}

func (c *BasicAccessTransportConfig) NewTransportPair(ctx context.Context) (*TransportPairParts, error) {
	fragSD, err := tlsfrag.NewFixedLenStreamDialer(&transport.TCPDialer{}, randomSplitLength())
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}
	return &TransportPairParts{StreamDialer: fragSD, PacketListener: &transport.UDPListener{}}, nil
}

// ShadowsocksTransportConfig is the legacy transport form: one
// shadowsocks config used for both TCP and UDP.
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

// withTransportInfo is withInfo for TransportPairInfo-valued metadata.
func withTransportInfo[Cfg any](parse composer.ParseFunc[Cfg], info func(ctx context.Context, cfg Cfg) (TransportPairInfo, error)) composer.ParseFunc[Cfg] {
	return func(ctx context.Context, node composer.Node) (Cfg, error) {
		var zero Cfg
		cfg, err := parse(ctx, node)
		if err != nil {
			return zero, err
		}
		i, err := info(ctx, cfg)
		if err != nil {
			return zero, err
		}
		if err := setInfo(ctx, cfg, i); err != nil {
			return zero, err
		}
		return cfg, nil
	}
}

type tcpudpFields struct {
	TCP composer.Optional[composer.Node]
	UDP composer.Optional[composer.Node]
}

// NewComposerTransportParser builds the full transport parser with
// Outline metadata attached to every node.
func NewComposerTransportParser(directSD transport.StreamDialer, directPD transport.PacketDialer) *composer.TypeParser[TransportPairConfig] {
	tables := newRegistryTables(directSD, directPD)

	parseShadowsocksTransport := func(ctx context.Context, node composer.Node) (*ShadowsocksTransportConfig, error) {
		sdParse := netconfig.NewShadowsocksStreamDialerParser(tables.streamEndpoints.Parse)
		plParse := netconfig.NewShadowsocksPacketListenerParser(tables.packetEndpoints.Parse)
		sd, err := sdParse(ctx, node)
		if err != nil {
			return nil, err
		}
		pl, err := plParse(ctx, node)
		if err != nil {
			return nil, err
		}
		// For the Shadowsocks transport form, the prefix only applies to TCP. To use a
		// prefix with UDP, one needs to specify it in the PacketListener config
		// explicitly (via a `$type: shadowsocks` packet-listener config). This is to
		// ensure backwards-compatibility with the legacy Shadowsocks transport config.
		pl.SaltGenerator = nil
		return &ShadowsocksTransportConfig{StreamDialer: sd, PacketListener: pl}, nil
	}
	ssTransportInfo := func(ctx context.Context, cfg *ShadowsocksTransportConfig) (TransportPairInfo, error) {
		sdEP, err := requireInfo(ctx, cfg.StreamDialer.Endpoint)
		if err != nil {
			return TransportPairInfo{}, err
		}
		plEP, err := requireInfo(ctx, cfg.PacketListener.Endpoint)
		if err != nil {
			return TransportPairInfo{}, err
		}
		return TransportPairInfo{
			Stream: ConnectionProviderInfo{ConnTypeTunneled, sdEP.FirstHop},
			Packet: ConnectionProviderInfo{ConnTypeTunneled, plEP.FirstHop},
		}, nil
	}

	transports := composer.NewTypeParser(func(ctx context.Context, node composer.Node) (TransportPairConfig, error) {
		if node.IsAbsent() {
			return nil, errors.New("transport config missing")
		}
		// Legacy compatibility: no $type means shadowsocks (URL or mapping).
		cfg, err := withTransportInfo(parseShadowsocksTransport, ssTransportInfo)(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	})

	tcpudpParse := func(ctx context.Context, node composer.Node) (*TCPUDPTransportConfig, error) {
		var f tcpudpFields
		if err := node.Decode(&f); err != nil {
			return nil, fmt.Errorf("invalid config format: %w", err)
		}
		tcpNode, _ := f.TCP.Get()
		sd, err := tables.streamDialers.Parse(ctx, tcpNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse StreamDialer: %w", err)
		}
		udpNode, _ := f.UDP.Get()
		pl, err := tables.packetListeners.Parse(ctx, udpNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse PacketListener: %w", err)
		}
		return &TCPUDPTransportConfig{TCP: sd, UDP: pl}, nil
	}
	transports.RegisterSubParser("tcpudp", asTransport(withTransportInfo(tcpudpParse,
		func(ctx context.Context, cfg *TCPUDPTransportConfig) (TransportPairInfo, error) {
			sdInfo, err := requireInfo(ctx, cfg.TCP)
			if err != nil {
				return TransportPairInfo{}, err
			}
			plInfo, err := requireInfo(ctx, cfg.UDP)
			if err != nil {
				return TransportPairInfo{}, err
			}
			return TransportPairInfo{Stream: sdInfo, Packet: plInfo}, nil
		})))

	basicAccessParse := func(ctx context.Context, node composer.Node) (*BasicAccessTransportConfig, error) {
		var f struct{}
		if err := node.Decode(&f); err != nil {
			return nil, fmt.Errorf("invalid config format: %w", err)
		}
		return &BasicAccessTransportConfig{}, nil
	}
	transports.RegisterSubParser("basic-access", asTransport(withTransportInfo(basicAccessParse,
		func(ctx context.Context, cfg *BasicAccessTransportConfig) (TransportPairInfo, error) {
			direct := ConnectionProviderInfo{ConnTypeDirect, ""}
			return TransportPairInfo{Stream: direct, Packet: direct}, nil
		})))

	return transports
}

func asTransport[Cfg TransportPairConfig](p composer.ParseFunc[Cfg]) composer.ParseFunc[TransportPairConfig] {
	return func(ctx context.Context, node composer.Node) (TransportPairConfig, error) {
		cfg, err := p(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}
}
