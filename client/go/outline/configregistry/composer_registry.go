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
	"net/http"
	"runtime"
	"testing"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/netconfig"
	"localhost/client/go/outline/connmeta"
	"localhost/client/go/outline/useragent"
)

// setInfo records metadata for cfg in the context's connmeta table.
// A missing table is a wiring bug: parsing must be started via
// connmeta.WithTable.
func setInfo(ctx context.Context, cfg any, info any) error {
	t := connmeta.FromContext(ctx)
	if t == nil {
		return errors.New("internal error: no connmeta table in context")
	}
	t.Set(cfg, info)
	return nil
}

// requireInfo reads a child config's ConnectionProviderInfo; children
// are always parsed (and recorded) before their parent's info function
// runs.
func requireInfo(ctx context.Context, cfg any) (ConnectionProviderInfo, error) {
	info, ok := connmeta.Get[ConnectionProviderInfo](connmeta.FromContext(ctx), cfg)
	if !ok {
		return ConnectionProviderInfo{}, fmt.Errorf("internal error: no connection info for %T", cfg)
	}
	return info, nil
}

// withInfo decorates a parser so that every parsed config gets its
// ConnectionProviderInfo computed and recorded.
func withInfo[Cfg any](parse composer.ParseFunc[Cfg], info func(ctx context.Context, cfg Cfg) (ConnectionProviderInfo, error)) composer.ParseFunc[Cfg] {
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

// registryTables bundles the category parsers so iptable/transport
// tasks can register into them.
type registryTables struct {
	streamDialers   *composer.TypeParser[netconfig.StreamDialerConfig]
	packetDialers   *composer.TypeParser[netconfig.PacketDialerConfig]
	streamEndpoints *composer.TypeParser[netconfig.StreamEndpointConfig]
	packetEndpoints *composer.TypeParser[netconfig.PacketEndpointConfig]
	packetListeners *composer.TypeParser[netconfig.PacketListenerConfig]
}

// resolveFirstOnThisPlatform reports whether direct dial endpoints
// should resolve their address at build time. On Linux and Windows we
// cannot protect the system DNS resolution (FW_MARK / interface
// binding), so we resolve upfront. Skipped in tests.
func resolveFirstOnThisPlatform() bool {
	return (runtime.GOOS == "linux" || runtime.GOOS == "windows") && !testing.Testing()
}

func newRegistryTables(directSD transport.StreamDialer, directPD transport.PacketDialer) *registryTables {
	t := &registryTables{}

	directSDCfg := netconfig.NewDirectStreamDialerConfig(directSD)
	directPDCfg := netconfig.NewDirectPacketDialerConfig(directPD)
	directPLCfg := netconfig.NewDirectPacketListenerConfig(&transport.UDPListener{})
	directInfo := ConnectionProviderInfo{ConnTypeDirect, ""}

	// Info functions shared between registration and fallbacks.
	ssStreamInfo := func(ctx context.Context, cfg *netconfig.ShadowsocksStreamDialerConfig) (ConnectionProviderInfo, error) {
		epInfo, err := requireInfo(ctx, cfg.Endpoint)
		if err != nil {
			return ConnectionProviderInfo{}, err
		}
		return ConnectionProviderInfo{ConnTypeTunneled, epInfo.FirstHop}, nil
	}
	ssListenerInfo := func(ctx context.Context, cfg *netconfig.ShadowsocksPacketListenerConfig) (ConnectionProviderInfo, error) {
		epInfo, err := requireInfo(ctx, cfg.Endpoint)
		if err != nil {
			return ConnectionProviderInfo{}, err
		}
		return ConnectionProviderInfo{ConnTypeTunneled, epInfo.FirstHop}, nil
	}

	// Stream dialers.
	t.streamDialers = composer.NewTypeParser(func(ctx context.Context, node composer.Node) (netconfig.StreamDialerConfig, error) {
		switch node.Kind() {
		case composer.KindAbsent:
			if err := setInfo(ctx, directSDCfg, directInfo); err != nil {
				return nil, err
			}
			return directSDCfg, nil
		case composer.KindScalar:
			parse := withInfo(netconfig.NewShadowsocksStreamDialerParser(t.streamEndpoints.Parse), ssStreamInfo)
			return asStreamDialer(parse)(ctx, node)
		default:
			return nil, errors.New("parser not specified")
		}
	})

	// Packet dialers.
	t.packetDialers = composer.NewTypeParser(func(ctx context.Context, node composer.Node) (netconfig.PacketDialerConfig, error) {
		switch node.Kind() {
		case composer.KindAbsent:
			if err := setInfo(ctx, directPDCfg, directInfo); err != nil {
				return nil, err
			}
			return directPDCfg, nil
		case composer.KindScalar:
			parse := withInfo(netconfig.NewShadowsocksPacketDialerParser(t.packetEndpoints.Parse),
				func(ctx context.Context, cfg *netconfig.ShadowsocksPacketDialerConfig) (ConnectionProviderInfo, error) {
					return ssListenerInfo(ctx, cfg.Listener)
				})
			return asPacketDialer(parse)(ctx, node)
		default:
			return nil, errors.New("parser not specified")
		}
	})

	// Packet listeners.
	t.packetListeners = composer.NewTypeParser(func(ctx context.Context, node composer.Node) (netconfig.PacketListenerConfig, error) {
		if node.IsAbsent() {
			if err := setInfo(ctx, directPLCfg, directInfo); err != nil {
				return nil, err
			}
			return directPLCfg, nil
		}
		return nil, errors.New("parser not specified")
	})

	// Endpoints: fallback and "dial" both use the dial-endpoint parser.
	streamDialEndpoint := withInfo(netconfig.NewStreamDialEndpointParser(t.streamDialers.Parse),
		func(ctx context.Context, cfg *netconfig.StreamDialEndpointConfig) (ConnectionProviderInfo, error) {
			dialerInfo, err := requireInfo(ctx, cfg.Dialer)
			if err != nil {
				return ConnectionProviderInfo{}, err
			}
			info := dialerInfo
			if dialerInfo.ConnType == ConnTypeDirect {
				info.FirstHop = cfg.Address
				cfg.ResolveAddressFirst = resolveFirstOnThisPlatform()
			}
			return info, nil
		})
	t.streamEndpoints = composer.NewTypeParser(func(ctx context.Context, node composer.Node) (netconfig.StreamEndpointConfig, error) {
		return asStreamEndpoint(streamDialEndpoint)(ctx, node)
	})

	packetDialEndpoint := withInfo(netconfig.NewPacketDialEndpointParser(t.packetDialers.Parse),
		func(ctx context.Context, cfg *netconfig.PacketDialEndpointConfig) (ConnectionProviderInfo, error) {
			dialerInfo, err := requireInfo(ctx, cfg.Dialer)
			if err != nil {
				return ConnectionProviderInfo{}, err
			}
			info := dialerInfo
			if dialerInfo.ConnType == ConnTypeDirect {
				info.FirstHop = cfg.Address
				cfg.ResolveAddressFirst = resolveFirstOnThisPlatform()
			}
			return info, nil
		})
	t.packetEndpoints = composer.NewTypeParser(func(ctx context.Context, node composer.Node) (netconfig.PacketEndpointConfig, error) {
		return asPacketEndpoint(packetDialEndpoint)(ctx, node)
	})

	// Websocket endpoints, with the Outline User-Agent as app policy.
	wsHeaders := http.Header{"User-Agent": []string{useragent.GetOutlineUserAgent()}}
	wsParser := withInfo(
		netconfig.NewWebsocketEndpointParser(t.streamEndpoints.Parse, netconfig.WithWebsocketHeaders(wsHeaders)),
		func(ctx context.Context, cfg *netconfig.WebsocketEndpointConfig) (ConnectionProviderInfo, error) {
			return requireInfo(ctx, cfg.Endpoint)
		})

	// Registrations.
	t.streamEndpoints.RegisterSubParser("dial", asStreamEndpoint(streamDialEndpoint))
	t.streamEndpoints.RegisterSubParser("websocket", asStreamEndpoint(wsParser))
	t.packetEndpoints.RegisterSubParser("dial", asPacketEndpoint(packetDialEndpoint))
	t.packetEndpoints.RegisterSubParser("websocket", asPacketEndpoint(wsParser))

	blockParse := withInfo(
		func(ctx context.Context, node composer.Node) (*netconfig.BlockConfig, error) {
			return netconfig.ParseBlock(ctx, node)
		},
		func(ctx context.Context, cfg *netconfig.BlockConfig) (ConnectionProviderInfo, error) {
			return ConnectionProviderInfo{ConnType: ConnTypeBlocked}, nil
		})
	t.streamDialers.RegisterSubParser("block", asStreamDialer(blockParse))
	t.packetDialers.RegisterSubParser("block", asPacketDialer(blockParse))

	t.streamDialers.RegisterSubParser("direct", func(ctx context.Context, node composer.Node) (netconfig.StreamDialerConfig, error) {
		if err := setInfo(ctx, directSDCfg, directInfo); err != nil {
			return nil, err
		}
		return directSDCfg, nil
	})
	t.packetDialers.RegisterSubParser("direct", func(ctx context.Context, node composer.Node) (netconfig.PacketDialerConfig, error) {
		if err := setInfo(ctx, directPDCfg, directInfo); err != nil {
			return nil, err
		}
		return directPDCfg, nil
	})
	t.packetListeners.RegisterSubParser("direct", func(ctx context.Context, node composer.Node) (netconfig.PacketListenerConfig, error) {
		if err := setInfo(ctx, directPLCfg, directInfo); err != nil {
			return nil, err
		}
		return directPLCfg, nil
	})

	t.streamDialers.RegisterSubParser("shadowsocks",
		asStreamDialer(withInfo(netconfig.NewShadowsocksStreamDialerParser(t.streamEndpoints.Parse), ssStreamInfo)))
	t.packetDialers.RegisterSubParser("shadowsocks",
		asPacketDialer(withInfo(netconfig.NewShadowsocksPacketDialerParser(t.packetEndpoints.Parse),
			func(ctx context.Context, cfg *netconfig.ShadowsocksPacketDialerConfig) (ConnectionProviderInfo, error) {
				return ssListenerInfo(ctx, cfg.Listener)
			})))
	t.packetListeners.RegisterSubParser("shadowsocks",
		asPacketListener(withInfo(netconfig.NewShadowsocksPacketListenerParser(t.packetEndpoints.Parse), ssListenerInfo)))

	return t
}

// Interface-conversion adapters (Go cannot convert ParseFunc[*X] to
// ParseFunc[Iface] implicitly).
func asStreamDialer[Cfg netconfig.StreamDialerConfig](p composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.StreamDialerConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.StreamDialerConfig, error) {
		cfg, err := p(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}
}

func asPacketDialer[Cfg netconfig.PacketDialerConfig](p composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.PacketDialerConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.PacketDialerConfig, error) {
		cfg, err := p(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}
}

func asStreamEndpoint[Cfg netconfig.StreamEndpointConfig](p composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.StreamEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.StreamEndpointConfig, error) {
		cfg, err := p(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}
}

func asPacketEndpoint[Cfg netconfig.PacketEndpointConfig](p composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.PacketEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.PacketEndpointConfig, error) {
		cfg, err := p(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}
}

func asPacketListener[Cfg netconfig.PacketListenerConfig](p composer.ParseFunc[Cfg]) composer.ParseFunc[netconfig.PacketListenerConfig] {
	return func(ctx context.Context, node composer.Node) (netconfig.PacketListenerConfig, error) {
		cfg, err := p(ctx, node)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}
}
