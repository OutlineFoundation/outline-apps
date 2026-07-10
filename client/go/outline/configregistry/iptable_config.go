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
	"net/netip"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/outline/iptable"
)

type IPTableEntryConfig struct {
	Prefixes []netip.Prefix
	Dialer   netconfig.StreamDialerConfig
}

// IPTableStreamDialerConfig routes by destination IP prefix.
type IPTableStreamDialerConfig struct {
	Entries  []IPTableEntryConfig
	Fallback netconfig.StreamDialerConfig // nil: no fallback
}

func (c *IPTableStreamDialerConfig) NewStreamDialer(ctx context.Context) (transport.StreamDialer, error) {
	table := iptable.NewIPTable[transport.StreamDialer]()
	for _, entry := range c.Entries {
		dialer, err := entry.Dialer.NewStreamDialer(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to build iptable entry dialer: %w", err)
		}
		for _, prefix := range entry.Prefixes {
			table.AddPrefix(prefix, dialer)
		}
	}
	var fallback transport.StreamDialer
	if c.Fallback != nil {
		var err error
		fallback, err = c.Fallback.NewStreamDialer(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to build iptable fallback dialer: %w", err)
		}
	}
	return iptable.NewStreamDialer(table, fallback)
}

type ipTableEntryFields struct {
	IPs    []string
	Dialer composer.Node
}

type ipTableFields struct {
	Table    []ipTableEntryFields
	Fallback composer.Optional[composer.Node]
}

func newIPTableParser(parseSD composer.ParseFunc[netconfig.StreamDialerConfig]) composer.ParseFunc[*IPTableStreamDialerConfig] {
	return func(ctx context.Context, node composer.Node) (*IPTableStreamDialerConfig, error) {
		var f ipTableFields
		if err := node.Decode(&f); err != nil {
			return nil, fmt.Errorf("failed to decode iptable config: %w", err)
		}
		if len(f.Table) == 0 {
			return nil, errors.New("iptable config 'table' must not be empty")
		}
		cfg := &IPTableStreamDialerConfig{}
		for i, entry := range f.Table {
			if entry.Dialer.IsAbsent() {
				return nil, fmt.Errorf("iptable entry %d has no dialer specified", i)
			}
			dialer, err := parseSD(ctx, entry.Dialer)
			if err != nil {
				return nil, fmt.Errorf("failed to parse dialer for table entry %d: %w", i, err)
			}
			parsed := IPTableEntryConfig{Dialer: dialer}
			for _, ip := range entry.IPs {
				prefix, err := netip.ParsePrefix(ip)
				if err != nil {
					addr, errAddr := netip.ParseAddr(ip)
					if errAddr != nil {
						return nil, fmt.Errorf("iptable entry %d IP %q is not a valid IP address or CIDR prefix", i, ip)
					}
					prefix = netip.PrefixFrom(addr, addr.BitLen())
				}
				parsed.Prefixes = append(parsed.Prefixes, prefix)
			}
			cfg.Entries = append(cfg.Entries, parsed)
		}
		if fbNode, ok := f.Fallback.Get(); ok {
			fallback, err := parseSD(ctx, fbNode)
			if err != nil {
				return nil, fmt.Errorf("failed to parse fallback dialer: %w", err)
			}
			cfg.Fallback = fallback
		}
		return cfg, nil
	}
}

// ipTableInfo aggregates the entry dialers' connection types.
func ipTableInfo(ctx context.Context, cfg *IPTableStreamDialerConfig) (ConnectionProviderInfo, error) {
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
	for _, entry := range cfg.Entries {
		info, err := requireInfo(ctx, entry.Dialer)
		if err != nil {
			return ConnectionProviderInfo{}, err
		}
		consider(info)
	}
	if cfg.Fallback != nil {
		info, err := requireInfo(ctx, cfg.Fallback)
		if err != nil {
			return ConnectionProviderInfo{}, err
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
