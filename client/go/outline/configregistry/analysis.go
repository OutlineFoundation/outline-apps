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
	"errors"
	"fmt"
	"runtime"
	"testing"

	"localhost/client/go/composer/netconfig"
)

// ConnectionAnalyzer derives Outline connection metadata from a parsed config
// graph and applies Outline's direct-endpoint address-resolution policy.
type ConnectionAnalyzer struct {
	// ResolveDirectAddressesFirst is applied only to dial endpoints whose child
	// dialer analyzes as direct.
	ResolveDirectAddressesFirst bool
}

// NewConnectionAnalyzer returns an analyzer with Outline's platform default.
func NewConnectionAnalyzer() ConnectionAnalyzer {
	resolveFirst := (runtime.GOOS == "linux" || runtime.GOOS == "windows") && !testing.Testing()
	return ConnectionAnalyzer{ResolveDirectAddressesFirst: resolveFirst}
}

// AnalyzeTransport analyzes both connection providers in cfg.
func (a ConnectionAnalyzer) AnalyzeTransport(value TransportPairConfig) (TransportPairInfo, error) {
	switch cfg := value.(type) {
	case *TCPUDPTransportConfig:
		if cfg == nil {
			return TransportPairInfo{}, errors.New("nil TCP/UDP transport config")
		}
		stream, err := a.streamDialer(cfg.TCP)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze TCP transport: %w", err)
		}
		packet, err := a.packetListener(cfg.UDP)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze UDP transport: %w", err)
		}
		return TransportPairInfo{Stream: stream, Packet: packet}, nil
	case *ShadowsocksTransportConfig:
		if cfg == nil {
			return TransportPairInfo{}, errors.New("nil Shadowsocks transport config")
		}
		stream, err := a.streamDialer(cfg.StreamDialer)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze Shadowsocks stream transport: %w", err)
		}
		packet, err := a.packetListener(cfg.PacketListener)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze Shadowsocks packet transport: %w", err)
		}
		return TransportPairInfo{Stream: stream, Packet: packet}, nil
	case *BasicAccessTransportConfig:
		if cfg == nil {
			return TransportPairInfo{}, errors.New("nil basic-access transport config")
		}
		direct := ConnectionProviderInfo{ConnType: ConnTypeDirect}
		return TransportPairInfo{Stream: direct, Packet: direct}, nil
	default:
		return TransportPairInfo{}, fmt.Errorf("no connection analysis for transport %T", value)
	}
}

func (a ConnectionAnalyzer) streamDialer(value netconfig.StreamDialerConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.DirectStreamDialerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil direct stream dialer config")
		}
		return ConnectionProviderInfo{ConnType: ConnTypeDirect}, nil
	case *netconfig.BlockConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil block stream dialer config")
		}
		return ConnectionProviderInfo{ConnType: ConnTypeBlocked}, nil
	case *netconfig.ShadowsocksStreamDialerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil Shadowsocks stream dialer config")
		}
		endpoint, err := a.streamEndpoint(cfg.Endpoint)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze Shadowsocks stream endpoint: %w", err)
		}
		return ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: endpoint.FirstHop}, nil
	case *IPTableStreamDialerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil IP table stream dialer config")
		}
		return a.ipTable(cfg)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for stream dialer %T", value)
	}
}

func (a ConnectionAnalyzer) packetDialer(value netconfig.PacketDialerConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.DirectPacketDialerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil direct packet dialer config")
		}
		return ConnectionProviderInfo{ConnType: ConnTypeDirect}, nil
	case *netconfig.BlockConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil block packet dialer config")
		}
		return ConnectionProviderInfo{ConnType: ConnTypeBlocked}, nil
	case *netconfig.ShadowsocksPacketDialerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil Shadowsocks packet dialer config")
		}
		return a.packetListener(cfg.Listener)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for packet dialer %T", value)
	}
}

func (a ConnectionAnalyzer) streamEndpoint(value netconfig.StreamEndpointConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.StreamDialEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil stream dial endpoint config")
		}
		info, err := a.streamDialer(cfg.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze dial endpoint: %w", err)
		}
		isDirect := info.ConnType == ConnTypeDirect
		cfg.ResolveAddressFirst = isDirect && a.ResolveDirectAddressesFirst
		if isDirect {
			info.FirstHop = cfg.Address
		}
		return info, nil
	case *netconfig.WebsocketEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil WebSocket stream endpoint config")
		}
		return a.streamEndpoint(cfg.Endpoint)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for stream endpoint %T", value)
	}
}

func (a ConnectionAnalyzer) packetEndpoint(value netconfig.PacketEndpointConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.PacketDialEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil packet dial endpoint config")
		}
		info, err := a.packetDialer(cfg.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze dial endpoint: %w", err)
		}
		isDirect := info.ConnType == ConnTypeDirect
		cfg.ResolveAddressFirst = isDirect && a.ResolveDirectAddressesFirst
		if isDirect {
			info.FirstHop = cfg.Address
		}
		return info, nil
	case *netconfig.WebsocketEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil WebSocket packet endpoint config")
		}
		return a.streamEndpoint(cfg.Endpoint)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for packet endpoint %T", value)
	}
}

func (a ConnectionAnalyzer) packetListener(value netconfig.PacketListenerConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.DirectPacketListenerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil direct packet listener config")
		}
		return ConnectionProviderInfo{ConnType: ConnTypeDirect}, nil
	case *netconfig.ShadowsocksPacketListenerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil Shadowsocks packet listener config")
		}
		endpoint, err := a.packetEndpoint(cfg.Endpoint)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze Shadowsocks packet endpoint: %w", err)
		}
		return ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: endpoint.FirstHop}, nil
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for packet listener %T", value)
	}
}

func (a ConnectionAnalyzer) ipTable(cfg *IPTableStreamDialerConfig) (ConnectionProviderInfo, error) {
	allTunneled, allDirect, allBlocked := true, true, true
	consider := func(info ConnectionProviderInfo) {
		if info.ConnType == ConnTypeBlocked {
			return
		}
		allBlocked = false
		if info.ConnType != ConnTypeTunneled {
			allTunneled = false
		}
		if info.ConnType != ConnTypeDirect {
			allDirect = false
		}
	}
	for i, entry := range cfg.Entries {
		info, err := a.streamDialer(entry.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze IP table entry %d: %w", i, err)
		}
		consider(info)
	}
	if cfg.Fallback != nil {
		info, err := a.streamDialer(cfg.Fallback)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze IP table fallback: %w", err)
		}
		consider(info)
	}
	switch {
	case allBlocked:
		return ConnectionProviderInfo{ConnType: ConnTypeBlocked}, nil
	case allTunneled:
		return ConnectionProviderInfo{ConnType: ConnTypeTunneled}, nil
	case allDirect:
		return ConnectionProviderInfo{ConnType: ConnTypeDirect}, nil
	default:
		return ConnectionProviderInfo{ConnType: ConnTypePartial}, nil
	}
}
