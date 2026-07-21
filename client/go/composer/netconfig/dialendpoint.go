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

package netconfig

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

// StreamDialEndpointConfig connects to a fixed address via a dialer.
type StreamDialEndpointConfig struct {
	Address string
	// ResolveAddressFirst makes NewStreamEndpoint resolve Address once before
	// dialing. It has no wire field; applications may set it on a parsed config
	// when their routing policy cannot tolerate DNS during DialStream.
	ResolveAddressFirst bool
	Dialer              StreamDialerConfig
}

func (c *StreamDialEndpointConfig) NewStreamEndpoint(ctx context.Context) (transport.StreamEndpoint, error) {
	dialer, err := c.Dialer.NewStreamDialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build dialer: %w", err)
	}
	addr := c.Address
	if c.ResolveAddressFirst {
		addr = resolveAddress(ctx, addr)
	}
	return transport.FuncStreamEndpoint(func(ctx context.Context) (transport.StreamConn, error) {
		return dialer.DialStream(ctx, addr)
	}), nil
}

// PacketDialEndpointConfig is the packet variant of StreamDialEndpointConfig.
type PacketDialEndpointConfig struct {
	Address             string
	ResolveAddressFirst bool
	Dialer              PacketDialerConfig
}

func (c *PacketDialEndpointConfig) NewPacketEndpoint(ctx context.Context) (transport.PacketEndpoint, error) {
	dialer, err := c.Dialer.NewPacketDialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build dialer: %w", err)
	}
	addr := c.Address
	if c.ResolveAddressFirst {
		addr = resolveAddress(ctx, addr)
	}
	return transport.FuncPacketEndpoint(func(ctx context.Context) (net.Conn, error) {
		return dialer.DialPacket(ctx, addr)
	}), nil
}

// resolveAddress resolves host:port once and returns address unchanged if DNS
// is unavailable. The latter lets a later dial recover when DNS comes back.
func resolveAddress(ctx context.Context, address string) string {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return address
	}
	return net.JoinHostPort(ips[0].Unmap().String(), port)
}

type dialEndpointFields struct {
	Address string
	Dialer  composer.Optional[composer.Node]
}

func decodeDialEndpoint(node composer.Node) (dialEndpointFields, error) {
	var f dialEndpointFields
	if node.Kind() == composer.KindScalar {
		if err := node.Decode(&f.Address); err != nil {
			return f, err
		}
	} else if err := node.Decode(&f); err != nil {
		return f, err
	}
	return f, validateAddress(f.Address)
}

func validateAddress(address string) error {
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("invalid address format: %w", err)
	}
	if host == "" {
		return errors.New("host must not be empty")
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil {
		return fmt.Errorf("invalid port number: %w", err)
	}
	if port == 0 {
		return errors.New("port must not be zero")
	}
	return nil
}

// NewStreamDialEndpointParser parses a dial endpoint: either a scalar
// "host:port" or a mapping {address, dialer?}. The dialer defaults to
// whatever parseSD yields for an absent node.
func NewStreamDialEndpointParser(parseSD composer.ParseFunc[StreamDialerConfig]) composer.ParseFunc[*StreamDialEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (*StreamDialEndpointConfig, error) {
		f, err := decodeDialEndpoint(node)
		if err != nil {
			return nil, err
		}
		dialerNode, _ := f.Dialer.Get()
		dialer, err := parseSD(ctx, dialerNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse sub-dialer: %w", err)
		}
		return &StreamDialEndpointConfig{Address: f.Address, Dialer: dialer}, nil
	}
}

// NewPacketDialEndpointParser is the packet variant of NewStreamDialEndpointParser.
func NewPacketDialEndpointParser(parsePD composer.ParseFunc[PacketDialerConfig]) composer.ParseFunc[*PacketDialEndpointConfig] {
	return func(ctx context.Context, node composer.Node) (*PacketDialEndpointConfig, error) {
		f, err := decodeDialEndpoint(node)
		if err != nil {
			return nil, err
		}
		dialerNode, _ := f.Dialer.Get()
		dialer, err := parsePD(ctx, dialerNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse sub-dialer: %w", err)
		}
		return &PacketDialEndpointConfig{Address: f.Address, Dialer: dialer}, nil
	}
}
