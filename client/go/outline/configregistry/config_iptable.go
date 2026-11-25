// Copyright 2025 The Outline Authors
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
	"net/netip"

	"localhost/client/go/configyaml"
	"localhost/client/go/outline/iptable"
	"golang.getoutline.org/sdk/transport"
)

type ipTableRootConfig struct {
	Table    []ipTableEntryConfig  `yaml:"table"`
	Fallback configyaml.ConfigNode `yaml:"fallback,omitempty"`
}

type ipTableEntryConfig struct {
	IPs    []string              `yaml:"ips"`
	Dialer configyaml.ConfigNode `yaml:"dialer"`
}

type ipTablePacketListenerRootConfig struct {
	Table    []ipTablePacketListenerEntryConfig `yaml:"table"`
	Fallback configyaml.ConfigNode              `yaml:"fallback,omitempty"`
}

type ipTablePacketListenerEntryConfig struct {
	IPs      []string              `yaml:"ips"`
	Listener configyaml.ConfigNode `yaml:"listener"`
}

// ipTableConnTypes computes the [ConnType] of an IP table from the types of its routes.
// Blocked routes don't affect the result, unless all routes are blocked.
type ipTableConnTypes struct {
	allConnTunnelled bool
	allConnDirect    bool
	allConnBlocked   bool
}

func newIPTableConnTypes() *ipTableConnTypes {
	return &ipTableConnTypes{allConnTunnelled: true, allConnDirect: true, allConnBlocked: true}
}

func (c *ipTableConnTypes) add(connType ConnType) {
	if connType == ConnTypeBlocked {
		return
	}
	c.allConnBlocked = false
	if connType != ConnTypeTunneled {
		c.allConnTunnelled = false
	}
	if connType != ConnTypeDirect {
		c.allConnDirect = false
	}
}

func (c *ipTableConnTypes) result() (ConnType, error) {
	if c.allConnBlocked {
		return ConnTypeBlocked, nil
	} else if c.allConnDirect && c.allConnTunnelled {
		// These should never happen because we require a non-empty table.
		return 0, fmt.Errorf("allConnDirect, allConnTunnelled cannot all be true")
	} else if c.allConnTunnelled {
		return ConnTypeTunneled, nil
	} else if c.allConnDirect {
		return ConnTypeDirect, nil
	}
	return ConnTypePartial, nil
}

// parseIPTablePrefix parses an IP table entry as a CIDR prefix or a single IP address.
func parseIPTablePrefix(entryIndex int, ip string) (netip.Prefix, error) {
	parsedPrefix, errPrefix := netip.ParsePrefix(ip)
	if errPrefix == nil {
		return parsedPrefix, nil
	}
	addr, errAddr := netip.ParseAddr(ip)
	if errAddr != nil {
		return netip.Prefix{}, fmt.Errorf("iptable entry %d IP '%s' is not a valid IP address or CIDR prefix: failed to parse as prefix (%v) and failed to parse as address (%v)", entryIndex, ip, errPrefix, errAddr)
	}
	return netip.PrefixFrom(addr, addr.BitLen()), nil
}

func parseIPTableStreamDialer(
	ctx context.Context,
	configMap map[string]any,
	parseSD configyaml.ParseFunc[*Dialer[transport.StreamConn]],
) (*Dialer[transport.StreamConn], error) {
	var rootCfg ipTableRootConfig
	if err := configyaml.MapToAny(configMap, &rootCfg); err != nil {
		return nil, fmt.Errorf("failed to map iptable stream config: %w", err)
	}

	if len(rootCfg.Table) == 0 {
		return nil, errors.New("iptable config 'table' must not be empty for stream dialer")
	}

	connTypes := newIPTableConnTypes()
	dialerTable := iptable.NewIPTable[transport.StreamDialer]()
	for i, entryCfg := range rootCfg.Table {
		if entryCfg.Dialer == nil {
			return nil, fmt.Errorf("iptable entry %d has no dialer specified", i)
		}

		parsedSubDialer, err := parseSD(ctx, entryCfg.Dialer)
		if err != nil {
			return nil, fmt.Errorf("failed to parse nested stream dialer for table entry %d: %w", i, err)
		}
		connTypes.add(parsedSubDialer.ConnType)

		ipsDialer := transport.FuncStreamDialer(parsedSubDialer.Dial)
		for _, ip := range entryCfg.IPs {
			prefix, err := parseIPTablePrefix(i, ip)
			if err != nil {
				return nil, err
			}
			dialerTable.AddPrefix(prefix, ipsDialer)
		}
	}

	var fallbackDialer transport.StreamDialer
	if rootCfg.Fallback != nil {
		parsedFallbackDialer, err := parseSD(ctx, rootCfg.Fallback)
		if err != nil {
			return nil, fmt.Errorf("failed to parse nested stream dialer fallback: %w", err)
		}
		connTypes.add(parsedFallbackDialer.ConnType)
		fallbackDialer = transport.FuncStreamDialer(parsedFallbackDialer.Dial)
	}

	dialer, err := iptable.NewStreamDialer(dialerTable, fallbackDialer)
	if err != nil {
		return nil, fmt.Errorf("failed to create IPTableStreamDialer: %w", err)
	}

	connType, err := connTypes.result()
	if err != nil {
		return nil, err
	}

	return &Dialer[transport.StreamConn]{
		Dial: dialer.DialStream,
		ConnectionProviderInfo: ConnectionProviderInfo{
			ConnType: connType,
		},
	}, nil
}

func NewIPTableStreamDialerSubParser(parseSD configyaml.ParseFunc[*Dialer[transport.StreamConn]]) func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
	return func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
		return parseIPTableStreamDialer(ctx, input, parseSD)
	}
}

func parseIPTablePacketListener(
	ctx context.Context,
	configMap map[string]any,
	parsePL configyaml.ParseFunc[*PacketListener],
) (*PacketListener, error) {
	var rootCfg ipTablePacketListenerRootConfig
	if err := configyaml.MapToAny(configMap, &rootCfg); err != nil {
		return nil, fmt.Errorf("failed to map iptable packet listener config: %w", err)
	}

	if len(rootCfg.Table) == 0 {
		return nil, errors.New("iptable config 'table' must not be empty for packet listener")
	}

	connTypes := newIPTableConnTypes()
	listenerTable := iptable.NewIPTable[transport.PacketListener]()
	for i, entryCfg := range rootCfg.Table {
		if entryCfg.Listener == nil {
			return nil, fmt.Errorf("iptable entry %d has no listener specified", i)
		}

		parsedSubListener, err := parsePL(ctx, entryCfg.Listener)
		if err != nil {
			return nil, fmt.Errorf("failed to parse nested packet listener for table entry %d: %w", i, err)
		}
		connTypes.add(parsedSubListener.ConnType)

		for _, ip := range entryCfg.IPs {
			prefix, err := parseIPTablePrefix(i, ip)
			if err != nil {
				return nil, err
			}
			// The *PacketListener pointer identifies the route's socket in iptable.PacketListener.
			listenerTable.AddPrefix(prefix, parsedSubListener)
		}
	}

	var fallbackListener transport.PacketListener
	if rootCfg.Fallback != nil {
		parsedFallbackListener, err := parsePL(ctx, rootCfg.Fallback)
		if err != nil {
			return nil, fmt.Errorf("failed to parse nested packet listener fallback: %w", err)
		}
		connTypes.add(parsedFallbackListener.ConnType)
		fallbackListener = parsedFallbackListener
	}

	listener, err := iptable.NewPacketListener(listenerTable, fallbackListener)
	if err != nil {
		return nil, fmt.Errorf("failed to create IPTablePacketListener: %w", err)
	}

	connType, err := connTypes.result()
	if err != nil {
		return nil, err
	}

	return &PacketListener{
		ConnectionProviderInfo: ConnectionProviderInfo{
			ConnType: connType,
		},
		PacketListener: listener,
	}, nil
}

func NewIPTablePacketListenerSubParser(parsePL configyaml.ParseFunc[*PacketListener]) func(ctx context.Context, input map[string]any) (*PacketListener, error) {
	return func(ctx context.Context, input map[string]any) (*PacketListener, error) {
		return parseIPTablePacketListener(ctx, input, parsePL)
	}
}
