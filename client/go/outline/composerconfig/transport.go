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

// Package composerconfig is Outline's Composer vocabulary: the $type names,
// compatibility forms, app-only configs, and connection metadata that the
// Outline Client layers over the reusable composer and netconfig packages.
//
// The client does not use this package yet. It is built beside
// configregistry, and a differential test checks that both read every config
// in its corpus the same way.
package composerconfig

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net/netip"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/transport/tlsfrag"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/outline/iptable"
)

// TransportPair is a built transport, before Outline's DNS policy is applied.
type TransportPair struct {
	StreamDialer   transport.StreamDialer
	PacketListener transport.PacketListener
}

// TransportPairConfig is a parsed Outline transport.
type TransportPairConfig interface {
	NewTransportPair(ctx context.Context) (*TransportPair, error)
}

// TCPUDPTransportConfig pairs independent TCP and UDP strategies.
type TCPUDPTransportConfig struct {
	TCP netconfig.StreamDialerConfig
	UDP netconfig.PacketListenerConfig
}

func (c *TCPUDPTransportConfig) NewTransportPair(ctx context.Context) (*TransportPair, error) {
	sd, err := c.TCP.NewStreamDialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build StreamDialer: %w", err)
	}
	pl, err := c.UDP.NewPacketListener(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build PacketListener: %w", err)
	}
	return &TransportPair{StreamDialer: sd, PacketListener: pl}, nil
}

func parseTCPUDP(ctx context.Context, r composer.Registry, node composer.Node) (*TCPUDPTransportConfig, error) {
	var fields struct {
		TCP composer.Optional[composer.Node]
		UDP composer.Optional[composer.Node]
	}
	if err := node.Decode(&fields); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}
	tcpNode, _ := fields.TCP.Get()
	sd, err := composer.Parse[netconfig.StreamDialerConfig](ctx, r, tcpNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse StreamDialer: %w", err)
	}
	udpNode, _ := fields.UDP.Get()
	pl, err := composer.Parse[netconfig.PacketListenerConfig](ctx, r, udpNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse PacketListener: %w", err)
	}
	return &TCPUDPTransportConfig{TCP: sd, UDP: pl}, nil
}

// ShadowsocksTransportConfig is the legacy transport form: one Shadowsocks
// config used for both TCP and UDP.
type ShadowsocksTransportConfig struct {
	StreamDialer   *netconfig.ShadowsocksStreamDialerConfig
	PacketListener *netconfig.ShadowsocksPacketListenerConfig
}

func (c *ShadowsocksTransportConfig) NewTransportPair(ctx context.Context) (*TransportPair, error) {
	sd, err := c.StreamDialer.NewStreamDialer(ctx)
	if err != nil {
		return nil, err
	}
	pl, err := c.PacketListener.NewPacketListener(ctx)
	if err != nil {
		return nil, err
	}
	return &TransportPair{StreamDialer: sd, PacketListener: pl}, nil
}

func parseLegacyShadowsocksTransport(ctx context.Context, r composer.Registry, node composer.Node) (*ShadowsocksTransportConfig, error) {
	if node.IsAbsent() {
		return nil, errors.New("transport config missing")
	}
	stream, err := netconfig.ParseShadowsocksStreamDialer(ctx, r, node)
	if err != nil {
		return nil, err
	}
	packet, err := netconfig.ParseShadowsocksPacketListener(ctx, r, node)
	if err != nil {
		return nil, err
	}
	// The legacy transport prefix applies only to TCP.
	packet.SaltGenerator = nil
	return &ShadowsocksTransportConfig{StreamDialer: stream, PacketListener: packet}, nil
}

const (
	// TLS fragmentation split points are measured within the record content;
	// the five-byte TLS record header is not included.
	minSplit = 6
	maxSplit = 64
)

// BasicAccessTransportConfig is direct access with TLS fragmentation.
type BasicAccessTransportConfig struct{}

func (c *BasicAccessTransportConfig) NewTransportPair(context.Context) (*TransportPair, error) {
	// TODO: build on the injected direct dialers. This keeps master's
	// behavior, which dials with a new TCPDialer and so does not apply the
	// socket protection the client injects (for example, the fwmark on Linux).
	length := minSplit + rand.Intn(maxSplit+1-minSplit)
	fragSD, err := tlsfrag.NewFixedLenStreamDialer(&transport.TCPDialer{}, length)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}
	return &TransportPair{StreamDialer: fragSD, PacketListener: &transport.UDPListener{}}, nil
}

func parseBasicAccess(_ context.Context, _ composer.Registry, node composer.Node) (*BasicAccessTransportConfig, error) {
	var fields struct{}
	if err := node.Decode(&fields); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}
	return &BasicAccessTransportConfig{}, nil
}

// IPTableEntryConfig routes a set of destination prefixes to a dialer.
type IPTableEntryConfig struct {
	Prefixes []netip.Prefix
	Dialer   netconfig.StreamDialerConfig
}

// IPTableStreamDialerConfig routes by destination IP prefix.
type IPTableStreamDialerConfig struct {
	Entries []IPTableEntryConfig
	// Fallback dials addresses no entry matches. Nil means those addresses fail.
	Fallback netconfig.StreamDialerConfig
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

func parseIPTable(ctx context.Context, r composer.Registry, node composer.Node) (*IPTableStreamDialerConfig, error) {
	var fields struct {
		Table []struct {
			IPs    []string
			Dialer composer.Node
		}
		Fallback composer.Optional[composer.Node]
	}
	if err := node.Decode(&fields); err != nil {
		return nil, fmt.Errorf("failed to decode iptable config: %w", err)
	}
	if len(fields.Table) == 0 {
		return nil, errors.New("iptable config 'table' must not be empty")
	}
	cfg := &IPTableStreamDialerConfig{}
	for i, entry := range fields.Table {
		dialer, err := composer.Parse[netconfig.StreamDialerConfig](ctx, r, entry.Dialer)
		if err != nil {
			return nil, fmt.Errorf("failed to parse dialer for table entry %d: %w", i, err)
		}
		parsed := IPTableEntryConfig{Dialer: dialer}
		for _, text := range entry.IPs {
			prefix, err := netip.ParsePrefix(text)
			if err != nil {
				addr, addrErr := netip.ParseAddr(text)
				if addrErr != nil {
					return nil, fmt.Errorf("iptable entry %d IP %q is not a valid IP address or CIDR prefix", i, text)
				}
				prefix = netip.PrefixFrom(addr, addr.BitLen())
			}
			parsed.Prefixes = append(parsed.Prefixes, prefix)
		}
		cfg.Entries = append(cfg.Entries, parsed)
	}
	if fallbackNode, ok := fields.Fallback.Get(); ok {
		fallback, err := composer.Parse[netconfig.StreamDialerConfig](ctx, r, fallbackNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse fallback dialer: %w", err)
		}
		cfg.Fallback = fallback
	}
	return cfg, nil
}

// registerDefaults installs the parsers for values without a $type. They only
// choose which named parser handles each shape, and reach it through the
// registry they are given. Replacing "direct" in an overlay therefore also
// changes what an omitted dialer means.
func registerDefaults(r composer.MutableRegistry) {
	composer.Register(r, composer.DefaultName, delegateByShape[netconfig.StreamDialerConfig]("direct", "shadowsocks"))
	composer.Register(r, composer.DefaultName, delegateByShape[netconfig.PacketDialerConfig]("direct", "shadowsocks"))
	composer.Register(r, composer.DefaultName, delegateByShape[netconfig.PacketListenerConfig]("direct", ""))
	composer.Register(r, composer.DefaultName, delegateTo[netconfig.StreamEndpointConfig]("dial"))
	composer.Register(r, composer.DefaultName, delegateTo[netconfig.PacketEndpointConfig]("dial"))
}

// delegateByShape handles an absent value with the absentName parser and a
// scalar with the scalarName parser. An empty name rejects that shape.
func delegateByShape[T any](absentName, scalarName string) composer.Parser[T] {
	return func(ctx context.Context, r composer.Registry, node composer.Node) (T, error) {
		name := ""
		switch node.Kind() {
		case composer.KindAbsent:
			name = absentName
		case composer.KindScalar:
			name = scalarName
		}
		if name == "" {
			var zero T
			return zero, errors.New("parser not specified")
		}
		return delegateTo[T](name)(ctx, r, node)
	}
}

func delegateTo[T any](name string) composer.Parser[T] {
	return func(ctx context.Context, r composer.Registry, node composer.Node) (T, error) {
		parse, err := composer.Lookup[T](r, name)
		if err != nil {
			var zero T
			return zero, err
		}
		return parse(ctx, r, node)
	}
}
