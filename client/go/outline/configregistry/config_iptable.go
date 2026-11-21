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

	"localhost/client/go/composer"
	"localhost/client/go/outline/iptable"
	"golang.getoutline.org/sdk/transport"
)

type ipTableRootConfig struct {
	Table    composer.Optional[[]ipTableEntryConfig]
	Fallback composer.Optional[composer.Node]
}

type ipTableEntryConfig struct {
	IPs    composer.Optional[[]string]
	Dialer composer.Optional[composer.Node]
}

func parseIPTableStreamDialer(ctx context.Context, r composer.Registry, node composer.Node) (*Dialer[transport.StreamConn], error) {
	var rootCfg ipTableRootConfig
	if err := node.Decode(&rootCfg); err != nil {
		return nil, fmt.Errorf("failed to map iptable stream config: %w", err)
	}
	table := rootCfg.Table.Or(nil)

	if len(table) == 0 {
		return nil, errors.New("iptable config 'table' must not be empty for stream dialer")
	}

	allConnTunnelled := true
	allConnDirect := true
	allConnBlocked := true

	dialerTable := iptable.NewIPTable[transport.StreamDialer]()
	for i, entryCfg := range table {
		dialerNode := entryCfg.Dialer.Or(composer.Node{})
		if dialerNode.IsAbsent() {
			return nil, fmt.Errorf("iptable entry %d has no dialer specified", i)
		}

		parsedSubDialer, err := composer.Parse[*Dialer[transport.StreamConn]](ctx, r, dialerNode)

		if err != nil {
			return nil, fmt.Errorf("failed to parse nested stream dialer for table entry %d: %w", i, err)
		}

		if parsedSubDialer.ConnType != ConnTypeBlocked {
			allConnBlocked = false
			if parsedSubDialer.ConnType != ConnTypeTunneled {
				allConnTunnelled = false
			}
			if parsedSubDialer.ConnType != ConnTypeDirect {
				allConnDirect = false
			}
		}

		ipsDialer := transport.FuncStreamDialer(parsedSubDialer.Dial)

		for _, ip := range entryCfg.IPs.Or(nil) {
			var currentPrefix netip.Prefix
			parsedPrefix, errPrefix := netip.ParsePrefix(ip)
			if errPrefix == nil {
				currentPrefix = parsedPrefix
			} else {
				addr, errAddr := netip.ParseAddr(ip)
				if errAddr != nil {
					return nil, fmt.Errorf("iptable entry %d IP '%s' is not a valid IP address or CIDR prefix: failed to parse as prefix (%v) and failed to parse as address (%v)", i, ip, errPrefix, errAddr)
				}
				currentPrefix = netip.PrefixFrom(addr, addr.BitLen())
			}

			dialerTable.AddPrefix(currentPrefix, ipsDialer)
		}
	}

	var fallbackDialer transport.StreamDialer

	if fallbackNode := rootCfg.Fallback.Or(composer.Node{}); !fallbackNode.IsAbsent() {
		parsedFallbackDialer, err := composer.Parse[*Dialer[transport.StreamConn]](ctx, r, fallbackNode)

		if err != nil {
			return nil, fmt.Errorf("failed to parse nested stream dialer fallback: %w", err)
		}

		if parsedFallbackDialer.ConnType != ConnTypeBlocked {
			allConnBlocked = false
			if parsedFallbackDialer.ConnType != ConnTypeTunneled {
				allConnTunnelled = false
			}
			if parsedFallbackDialer.ConnType != ConnTypeDirect {
				allConnDirect = false
			}
		}

		fallbackDialer = transport.FuncStreamDialer(parsedFallbackDialer.Dial)
	}

	dialer, err := iptable.NewStreamDialer(dialerTable, fallbackDialer)

	if err != nil {
		return nil, fmt.Errorf("failed to create IPTableStreamDialer: %w", err)
	}

	var connType ConnType
	if allConnBlocked {
		connType = ConnTypeBlocked
	} else if allConnDirect && allConnTunnelled {
		// These should never happen because we require len(rootCfg.Table) != 0
		return nil, fmt.Errorf("allConnDirect, allConnTunnelled cannot all be true")
	} else if allConnTunnelled {
		connType = ConnTypeTunneled
	} else if allConnDirect {
		connType = ConnTypeDirect
	} else {
		connType = ConnTypePartial
	}

	return &Dialer[transport.StreamConn]{
		Dial: dialer.DialStream,
		ConnectionProviderInfo: ConnectionProviderInfo{
			ConnType: connType,
		},
	}, nil
}
