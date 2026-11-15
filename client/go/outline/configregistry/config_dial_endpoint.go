// Copyright 2024 The Outline Authors
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
	"strconv"
	"testing"

	"localhost/client/go/composer"
)

// DialEndpointConfig is the format for the Dial Endpoint config.
type DialEndpointConfig struct {
	Address string
	Dialer  composer.Node
}

func NewDialEndpointSubParser[ConnType any](parse composer.ParseFunc[*Dialer[ConnType]]) composer.ParseFunc[*Endpoint[ConnType]] {
	return func(ctx context.Context, input composer.Node) (*Endpoint[ConnType], error) {
		return parseDirectDialerEndpoint(ctx, input, parse)
	}
}

func parseDirectDialerEndpoint[ConnType any](ctx context.Context, config composer.Node, newDialer composer.ParseFunc[*Dialer[ConnType]]) (*Endpoint[ConnType], error) {
	if config.IsAbsent() {
		return nil, config.WrapError(errors.New("endpoint config cannot be nil"))
	}

	dialParams, err := parseEndpointConfig(config)
	if err != nil {
		return nil, err
	}

	dialer, err := newDialer(ctx, dialParams.Dialer)
	if err != nil {
		return nil, fmt.Errorf("failed to create sub-dialer: %w", err)
	}

	// We need to resolve to the proxy server address before attempting a connection.
	// This is because we cannot protect the system DNS resolution connection
	// with our FW_MARK (Linux) or by binding to an interface (Windows). Therefore, as a workaround on Linux and Windows, we resolve the address first.
	ipPortStr := dialParams.Address
	if dialer.ConnType == ConnTypeDirect && (runtime.GOOS == "linux" || runtime.GOOS == "windows") && !testing.Testing() {
		ipPort, err := net.ResolveTCPAddr("tcp", ipPortStr)
		// We ignore the resolved name in case of failures and use the original hostname instead
		// so that parsing doesn't fail and to allow for recovery if the server becomes resolvable again.
		if err == nil {
			ipPortStr = ipPort.String()
		}
	}

	endpoint := &Endpoint[ConnType]{
		Connect: func(ctx context.Context) (ConnType, error) {
			return dialer.Dial(ctx, ipPortStr)
		},
		ConnectionProviderInfo: dialer.ConnectionProviderInfo,
	}
	if dialer.ConnType == ConnTypeDirect {
		endpoint.ConnectionProviderInfo.FirstHop = dialParams.Address
	}
	return endpoint, nil
}

func parseEndpointConfig(node composer.Node) (*DialEndpointConfig, error) {
	config, err := toDialEndpointConfig(node)
	if err != nil {
		return nil, err
	}
	addressNode := node
	if node.Kind() == composer.KindMapping {
		var fields map[string]composer.Node
		if err := node.Decode(&fields); err != nil {
			return nil, err
		}
		if address, ok := fields["address"]; ok {
			addressNode = address
		}
	}
	host, portText, err := net.SplitHostPort(config.Address)
	if err != nil {
		return nil, addressNode.WrapError(fmt.Errorf("invalid address format: %w", err))
	}
	if host == "" {
		return nil, addressNode.WrapError(errors.New("host must not be empty"))
	}
	if portText == "" {
		return nil, addressNode.WrapError(errors.New("port must not be empty"))
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil {
		return nil, addressNode.WrapError(fmt.Errorf("invalid port number: %w", err))
	}
	if port == 0 {
		return nil, addressNode.WrapError(errors.New("port must not be zero"))
	}
	return config, err
}

func toDialEndpointConfig(node composer.Node) (*DialEndpointConfig, error) {
	switch node.Kind() {
	case composer.KindScalar:
		var address string
		if err := node.Decode(&address); err != nil {
			return nil, err
		}
		return &DialEndpointConfig{Address: address}, nil

	case composer.KindMapping:
		// TODO: Make it type-based
		var config DialEndpointConfig
		if err := (composer.Decoder{CoerceScalars: true}).Decode(node, &config); err != nil {
			return nil, err
		}
		return &config, nil

	default:
		return nil, node.WrapError(fmt.Errorf("endpoint config of kind %s is not supported", node.Kind()))
	}
}
