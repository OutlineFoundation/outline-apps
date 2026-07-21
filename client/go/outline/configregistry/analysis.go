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
	"net"
	"runtime"
	"testing"

	"localhost/client/go/composer/netconfig"
)

// ConnectionAnalyzer derives Outline connection metadata from a parsed config
// graph and applies Outline's direct-endpoint address-resolution policy.
type ConnectionAnalyzer struct {
	// ResolveDirectAddress, when non-nil, resolves a direct dial endpoint's
	// host:port to its ip:port form. It is called only for dial endpoints whose
	// child dialer analyzes as direct. A nil func, or an error from it, leaves
	// the endpoint dialing its configured address.
	//
	// See [NewConnectionAnalyzer] for why the platforms that need this need it.
	ResolveDirectAddress func(ctx context.Context, address string) (string, error)

	// resolved memoizes lookups for one AnalyzeTransport call. A transport's
	// stream and packet halves are separate config objects that usually name the
	// same server, and resolving each independently could yield different IPs
	// for the same host, which would make their first hops disagree. The map is
	// installed by AnalyzeTransport and shared by the value copies its methods
	// receive; it is nil when a method is called directly, which just disables
	// memoization.
	resolved map[string]string
}

// resolveDirect returns the resolved form of address, or "" if this analyzer
// does not resolve or resolution failed. Failures are deliberately not fatal:
// the endpoint keeps its hostname so parsing succeeds and the connection can
// recover once DNS works again.
func (a ConnectionAnalyzer) resolveDirect(ctx context.Context, address string) string {
	if a.ResolveDirectAddress == nil {
		return ""
	}
	if cached, ok := a.resolved[address]; ok {
		return cached
	}
	resolved, err := a.ResolveDirectAddress(ctx, address)
	if err != nil {
		return ""
	}
	if a.resolved != nil {
		a.resolved[address] = resolved
	}
	return resolved
}

// NewConnectionAnalyzer returns an analyzer with Outline's platform default.
//
// Direct first hops are resolved up front on Linux and Windows, for two
// different platform reasons:
//
//   - Windows: the routing daemon installs a bypass route for the first hop
//     (client/electron/index.ts passes it to RoutingDaemon as proxyIp, which
//     becomes a "<host>/32" routing table entry) so proxy traffic skips the
//     tunnel. The address we dial therefore has to be the one that route
//     covers.
//   - Linux: the VPN protects sockets with a FW_MARK, but the system
//     resolver's socket is not marked. Resolving at dial time would send the
//     DNS query into the tunnel, so we resolve while normal routing still
//     applies.
//
// The resolved address replaces the endpoint's configured address, so it is
// what [ConnectionProviderInfo.FirstHop] reports. That is what makes the
// Windows invariant hold: the platform installs its bypass route for the very
// address we dial, instead of resolving the hostname a second time and possibly
// getting a different one. Resolving once here rather than per dial also keeps
// the address stable across reconnects.
//
// Disabled under test so the suite does not depend on DNS. Tests that need to
// exercise resolution should set ResolveDirectAddress to a stub instead.
func NewConnectionAnalyzer() ConnectionAnalyzer {
	if (runtime.GOOS != "linux" && runtime.GOOS != "windows") || testing.Testing() {
		return ConnectionAnalyzer{}
	}
	return ConnectionAnalyzer{ResolveDirectAddress: resolveAddress}
}

// resolveAddress resolves a host:port to its ip:port form. It resolves the host
// without regard to transport, so a config's stream and packet halves cannot
// disagree about the server's address.
func resolveAddress(ctx context.Context, address string) (string, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return "", err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return "", err
	}
	if len(ips) == 0 {
		return "", fmt.Errorf("no addresses for %q", host)
	}
	return net.JoinHostPort(ips[0].Unmap().String(), port), nil
}

// AnalyzeTransport analyzes both connection providers in cfg. It may rewrite
// direct dial endpoints' addresses to their resolved form, so it performs DNS
// and honors ctx's deadline and cancellation.
func (a ConnectionAnalyzer) AnalyzeTransport(ctx context.Context, value TransportPairConfig) (TransportPairInfo, error) {
	// Fresh per call; the map is shared by the value copies the methods below
	// receive, so one host resolves once for both halves of the transport.
	a.resolved = make(map[string]string)
	switch cfg := value.(type) {
	case *TCPUDPTransportConfig:
		if cfg == nil {
			return TransportPairInfo{}, errors.New("nil TCP/UDP transport config")
		}
		stream, err := a.streamDialer(ctx, cfg.TCP)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze TCP transport: %w", err)
		}
		packet, err := a.packetListener(ctx, cfg.UDP)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze UDP transport: %w", err)
		}
		return TransportPairInfo{Stream: stream, Packet: packet}, nil
	case *ShadowsocksTransportConfig:
		if cfg == nil {
			return TransportPairInfo{}, errors.New("nil Shadowsocks transport config")
		}
		stream, err := a.streamDialer(ctx, cfg.StreamDialer)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("analyze Shadowsocks stream transport: %w", err)
		}
		packet, err := a.packetListener(ctx, cfg.PacketListener)
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

func (a ConnectionAnalyzer) streamDialer(ctx context.Context, value netconfig.StreamDialerConfig) (ConnectionProviderInfo, error) {
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
		endpoint, err := a.streamEndpoint(ctx, cfg.Endpoint)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze Shadowsocks stream endpoint: %w", err)
		}
		return ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: endpoint.FirstHop}, nil
	case *IPTableStreamDialerConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil IP table stream dialer config")
		}
		return a.ipTable(ctx, cfg)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for stream dialer %T", value)
	}
}

func (a ConnectionAnalyzer) packetDialer(ctx context.Context, value netconfig.PacketDialerConfig) (ConnectionProviderInfo, error) {
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
		return a.packetListener(ctx, cfg.Listener)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for packet dialer %T", value)
	}
}

func (a ConnectionAnalyzer) streamEndpoint(ctx context.Context, value netconfig.StreamEndpointConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.StreamDialEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil stream dial endpoint config")
		}
		info, err := a.streamDialer(ctx, cfg.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze dial endpoint: %w", err)
		}
		if info.ConnType == ConnTypeDirect {
			// Rewrite to the resolved form so FirstHop reports the address we
			// will actually dial. Re-resolving an IP is a no-op, so repeated
			// analysis stays idempotent.
			if resolved := a.resolveDirect(ctx, cfg.Address); resolved != "" {
				cfg.Address = resolved
			}
			info.FirstHop = cfg.Address
		}
		return info, nil
	case *netconfig.WebsocketEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil WebSocket stream endpoint config")
		}
		return a.streamEndpoint(ctx, cfg.Endpoint)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for stream endpoint %T", value)
	}
}

func (a ConnectionAnalyzer) packetEndpoint(ctx context.Context, value netconfig.PacketEndpointConfig) (ConnectionProviderInfo, error) {
	switch cfg := value.(type) {
	case *netconfig.PacketDialEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil packet dial endpoint config")
		}
		info, err := a.packetDialer(ctx, cfg.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze dial endpoint: %w", err)
		}
		if info.ConnType == ConnTypeDirect {
			// Rewrite to the resolved form so FirstHop reports the address we
			// will actually dial. Re-resolving an IP is a no-op, so repeated
			// analysis stays idempotent.
			if resolved := a.resolveDirect(ctx, cfg.Address); resolved != "" {
				cfg.Address = resolved
			}
			info.FirstHop = cfg.Address
		}
		return info, nil
	case *netconfig.WebsocketEndpointConfig:
		if cfg == nil {
			return ConnectionProviderInfo{}, errors.New("nil WebSocket packet endpoint config")
		}
		return a.streamEndpoint(ctx, cfg.Endpoint)
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for packet endpoint %T", value)
	}
}

func (a ConnectionAnalyzer) packetListener(ctx context.Context, value netconfig.PacketListenerConfig) (ConnectionProviderInfo, error) {
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
		endpoint, err := a.packetEndpoint(ctx, cfg.Endpoint)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze Shadowsocks packet endpoint: %w", err)
		}
		return ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: endpoint.FirstHop}, nil
	default:
		return ConnectionProviderInfo{}, fmt.Errorf("no connection analysis for packet listener %T", value)
	}
}

func (a ConnectionAnalyzer) ipTable(ctx context.Context, cfg *IPTableStreamDialerConfig) (ConnectionProviderInfo, error) {
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
		info, err := a.streamDialer(ctx, entry.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, fmt.Errorf("analyze IP table entry %d: %w", i, err)
		}
		consider(info)
	}
	if cfg.Fallback != nil {
		info, err := a.streamDialer(ctx, cfg.Fallback)
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
