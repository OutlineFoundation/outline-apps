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

// Connection metadata is computed after parsing, by walking the parsed
// configs. The registry and the config types carry no metadata, so the
// reusable netconfig configs are registered as they are. The rules are the
// ones configregistry applies to built dialers.
//
// A config type that Describe does not know is an error, never direct: the
// client must not report a connection it cannot classify. A new component
// adds a case here.

import (
	"errors"
	"fmt"

	"localhost/client/go/composer/netconfig"
	"localhost/client/go/outline/configregistry"
)

// ConnInfo describes the connections a dialer, endpoint, or listener makes.
type ConnInfo = configregistry.ConnectionProviderInfo

// TransportPairInfo describes both halves of a transport.
type TransportPairInfo struct {
	Stream ConnInfo
	Packet ConnInfo
}

// ErrNoConnInfo reports a config that Describe cannot classify.
var ErrNoConnInfo = errors.New("config has no connection info")

var (
	directInfo  = ConnInfo{ConnType: configregistry.ConnTypeDirect}
	blockedInfo = ConnInfo{ConnType: configregistry.ConnTypeBlocked}
)

// Describe returns the connection info of a parsed dialer, endpoint, or
// listener config.
func Describe(cfg any) (ConnInfo, error) {
	switch c := cfg.(type) {
	case *netconfig.DirectStreamDialerConfig, *netconfig.DirectPacketDialerConfig, *netconfig.DirectPacketListenerConfig:
		return directInfo, nil
	case *netconfig.BlockConfig:
		return blockedInfo, nil
	case *netconfig.StreamDialEndpointConfig:
		return describeDialed(c.Dialer, c.Address)
	case *netconfig.PacketDialEndpointConfig:
		return describeDialed(c.Dialer, c.Address)
	case *netconfig.WebsocketEndpointConfig:
		return Describe(c.Endpoint)
	case *netconfig.ShadowsocksStreamDialerConfig:
		return describeTunneled(c.Endpoint)
	case *netconfig.ShadowsocksPacketListenerConfig:
		return describeTunneled(c.Endpoint)
	case *netconfig.ShadowsocksPacketDialerConfig:
		return describeTunneled(c.Listener.Endpoint)
	case *IPTableStreamDialerConfig:
		return describeIPTable(c)
	default:
		return ConnInfo{}, fmt.Errorf("%w: %T", ErrNoConnInfo, cfg)
	}
}

// DescribeTransport returns the connection info of a parsed transport.
func DescribeTransport(cfg TransportPairConfig) (TransportPairInfo, error) {
	switch c := cfg.(type) {
	case *TCPUDPTransportConfig:
		stream, err := Describe(c.TCP)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("tcp: %w", err)
		}
		packet, err := Describe(c.UDP)
		if err != nil {
			return TransportPairInfo{}, fmt.Errorf("udp: %w", err)
		}
		return TransportPairInfo{Stream: stream, Packet: packet}, nil
	case *ShadowsocksTransportConfig:
		stream, err := Describe(c.StreamDialer)
		if err != nil {
			return TransportPairInfo{}, err
		}
		packet, err := Describe(c.PacketListener)
		if err != nil {
			return TransportPairInfo{}, err
		}
		return TransportPairInfo{Stream: stream, Packet: packet}, nil
	case *BasicAccessTransportConfig:
		return TransportPairInfo{Stream: directInfo, Packet: directInfo}, nil
	default:
		return TransportPairInfo{}, fmt.Errorf("%w: %T", ErrNoConnInfo, cfg)
	}
}

// describeTunneled describes a proxy reached through endpoint.
func describeTunneled(endpoint any) (ConnInfo, error) {
	info, err := Describe(endpoint)
	if err != nil {
		return ConnInfo{}, err
	}
	return ConnInfo{ConnType: configregistry.ConnTypeTunneled, FirstHop: info.FirstHop}, nil
}

// describeDialed describes an endpoint that dials address with dialer.
func describeDialed(dialer any, address string) (ConnInfo, error) {
	info, err := Describe(dialer)
	if err != nil {
		return ConnInfo{}, err
	}
	if info.ConnType == configregistry.ConnTypeDirect {
		info.FirstHop = address
	}
	return info, nil
}

// describeIPTable aggregates the routes of the table. A table is blocked,
// direct, or tunneled only if every route that is not blocked agrees.
func describeIPTable(c *IPTableStreamDialerConfig) (ConnInfo, error) {
	routes := make([]any, 0, len(c.Entries)+1)
	for _, entry := range c.Entries {
		routes = append(routes, entry.Dialer)
	}
	if c.Fallback != nil {
		routes = append(routes, c.Fallback)
	}
	infos := make([]ConnInfo, 0, len(routes))
	for i, route := range routes {
		info, err := Describe(route)
		if err != nil {
			return ConnInfo{}, fmt.Errorf("iptable route %d: %w", i, err)
		}
		infos = append(infos, info)
	}
	return ConnInfo{ConnType: aggregateConnType(infos)}, nil
}

func aggregateConnType(infos []ConnInfo) configregistry.ConnType {
	allTunneled, allDirect, allBlocked := true, true, true
	for _, info := range infos {
		if info.ConnType == configregistry.ConnTypeBlocked {
			continue
		}
		allBlocked = false
		if info.ConnType != configregistry.ConnTypeTunneled {
			allTunneled = false
		}
		if info.ConnType != configregistry.ConnTypeDirect {
			allDirect = false
		}
	}
	switch {
	case allBlocked:
		return configregistry.ConnTypeBlocked
	case allTunneled:
		return configregistry.ConnTypeTunneled
	case allDirect:
		return configregistry.ConnTypeDirect
	default:
		return configregistry.ConnTypePartial
	}
}
