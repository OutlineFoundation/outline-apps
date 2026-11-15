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

// StreamDialEndpointConfig connects to a fixed address with a dialer.
//
// Address is dialed as written. The package resolves no names. An
// application that must dial an IP address, for example because it cannot
// protect the system resolver's socket, resolves the address itself before it
// builds the endpoint.
type StreamDialEndpointConfig struct {
	// Address is the host:port to connect to.
	Address string
	// Dialer makes the connection.
	Dialer StreamDialerConfig
}

// NewStreamEndpoint implements [StreamEndpointConfig].
func (c *StreamDialEndpointConfig) NewStreamEndpoint(ctx context.Context) (transport.StreamEndpoint, error) {
	dialer, err := c.Dialer.NewStreamDialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build dialer: %w", err)
	}
	return &transport.StreamDialerEndpoint{Dialer: dialer, Address: c.Address}, nil
}

// PacketDialEndpointConfig is the packet counterpart of
// [StreamDialEndpointConfig].
type PacketDialEndpointConfig struct {
	// Address is the host:port to connect to.
	Address string
	// Dialer makes the connection.
	Dialer PacketDialerConfig
}

// NewPacketEndpoint implements [PacketEndpointConfig].
func (c *PacketDialEndpointConfig) NewPacketEndpoint(ctx context.Context) (transport.PacketEndpoint, error) {
	dialer, err := c.Dialer.NewPacketDialer(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build dialer: %w", err)
	}
	return &transport.PacketDialerEndpoint{Dialer: dialer, Address: c.Address}, nil
}

// dialEndpointFields is the config of a dial endpoint. A scalar config is
// shorthand for the address alone.
type dialEndpointFields struct {
	Address string
	Dialer  composer.Optional[composer.Node]
}

func decodeDialEndpoint(node composer.Node) (dialEndpointFields, error) {
	var fields dialEndpointFields
	var err error
	if node.Kind() == composer.KindScalar {
		err = node.Decode(&fields.Address)
	} else {
		err = node.Decode(&fields)
	}
	if err != nil {
		return fields, err
	}
	return fields, validateAddress(fields.Address)
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

// ParseStreamDialEndpoint parses a dial endpoint for streams: a host:port
// string, or a mapping with an address and an optional dialer. The dialer is
// parsed with registry, and so is an omitted dialer, which lets the registry
// decide what the default is.
func ParseStreamDialEndpoint(ctx context.Context, registry composer.Registry, node composer.Node) (*StreamDialEndpointConfig, error) {
	fields, err := decodeDialEndpoint(node)
	if err != nil {
		return nil, err
	}
	dialerNode, _ := fields.Dialer.Get()
	dialer, err := composer.Parse[StreamDialerConfig](ctx, registry, dialerNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse dialer: %w", err)
	}
	return &StreamDialEndpointConfig{Address: fields.Address, Dialer: dialer}, nil
}

// ParsePacketDialEndpoint is the packet counterpart of
// [ParseStreamDialEndpoint].
func ParsePacketDialEndpoint(ctx context.Context, registry composer.Registry, node composer.Node) (*PacketDialEndpointConfig, error) {
	fields, err := decodeDialEndpoint(node)
	if err != nil {
		return nil, err
	}
	dialerNode, _ := fields.Dialer.Get()
	dialer, err := composer.Parse[PacketDialerConfig](ctx, registry, dialerNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse dialer: %w", err)
	}
	return &PacketDialEndpointConfig{Address: fields.Address, Dialer: dialer}, nil
}
