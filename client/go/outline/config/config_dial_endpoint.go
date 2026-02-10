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

package config

import (
	"context"
	"errors"
	"fmt"
	"net"
	"runtime"
	"strconv"
	"testing"

	"localhost/client/go/configyaml"
)

// DialEndpointConfig is the format for the Dial Endpoint config.
type DialEndpointConfig struct {
	Address string
	Dialer  any
}

func NewDialEndpointSubParser[ConnType any](parse configyaml.ParseFunc[*Dialer[ConnType]]) func(ctx context.Context, input map[string]any) (*Endpoint[ConnType], error) {
	return func(ctx context.Context, input map[string]any) (*Endpoint[ConnType], error) {
		return parseDirectDialerEndpoint(ctx, input, parse)
	}
}

func parseDirectDialerEndpoint[ConnType any](ctx context.Context, config any, newDialer configyaml.ParseFunc[*Dialer[ConnType]]) (*Endpoint[ConnType], error) {
	if config == nil {
		return nil, errors.New("endpoint config cannot be nil")
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

func parseEndpointConfig(node configyaml.ConfigNode) (*DialEndpointConfig, error) {
	config, err := toDialEndpointConfig(node)
	if err != nil {
		return nil, err
	}
	host, portText, err := net.SplitHostPort(config.Address)
	if err != nil {
		return nil, fmt.Errorf("invalid address format: %w", err)
	}
	if host == "" {
		return nil, errors.New("host must not be empty")
	}
	if portText == "" {
		return nil, errors.New("port must not be empty")
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil {
		return nil, fmt.Errorf("invalid port number: %w", err)
	}
	if port == 0 {
		return nil, errors.New("port must not be zero")
	}
	return config, err
}

func toDialEndpointConfig(node configyaml.ConfigNode) (*DialEndpointConfig, error) {
	switch typed := node.(type) {
	case string:
		return &DialEndpointConfig{Address: typed}, nil

	case map[string]any:
		var config DialEndpointConfig
		if err := configyaml.MapToAny(typed, &config); err != nil {
			return nil, err
		}
		// If Address is empty, check for an "endpoint" field as a fallback.
		if config.Address == "" {
			if endpoint, ok := typed["endpoint"].(string); ok {
				config.Address = endpoint
			}
		}
		return &config, nil

	default:
		return nil, fmt.Errorf("endpoint config of type %T is not supported", typed)
	}
}
