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
	Address composer.Optional[string]
	Dialer  composer.Optional[composer.Node]
}

// parseDialEndpoint parses an endpoint that dials a fixed address. The config is the address, or
// a [DialEndpointConfig].
func parseDialEndpoint[ConnType any](ctx context.Context, r composer.Registry, node composer.Node) (*Endpoint[ConnType], error) {
	if node.IsAbsent() {
		return nil, errors.New("endpoint config cannot be nil")
	}

	address, dialerNode, err := parseEndpointConfig(node)
	if err != nil {
		return nil, err
	}

	dialer, err := composer.Parse[*Dialer[ConnType]](ctx, r, dialerNode)
	if err != nil {
		return nil, fmt.Errorf("failed to create sub-dialer: %w", err)
	}

	// We need to resolve to the proxy server address before attempting a connection.
	// This is because we cannot protect the system DNS resolution connection
	// with our FW_MARK (Linux) or by binding to an interface (Windows). Therefore, as a workaround on Linux and Windows, we resolve the address first.
	ipPortStr := address
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
		endpoint.ConnectionProviderInfo.FirstHop = address
	}
	return endpoint, nil
}

func parseEndpointConfig(node composer.Node) (address string, dialer composer.Node, err error) {
	switch node.Kind() {
	case composer.KindScalar:
		if err := node.Decode(&address); err != nil {
			return "", composer.Node{}, err
		}

	case composer.KindMapping:
		// TODO: Make it type-based
		var config DialEndpointConfig
		if err := node.Decode(&config); err != nil {
			return "", composer.Node{}, err
		}
		address, dialer = config.Address.Or(""), config.Dialer.Or(composer.Node{})

	default:
		return "", composer.Node{}, fmt.Errorf("endpoint config of type %v is not supported", node.Kind())
	}

	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return "", composer.Node{}, fmt.Errorf("invalid address format: %w", err)
	}
	if host == "" {
		return "", composer.Node{}, errors.New("host must not be empty")
	}
	if portText == "" {
		return "", composer.Node{}, errors.New("port must not be empty")
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil {
		return "", composer.Node{}, fmt.Errorf("invalid port number: %w", err)
	}
	if port == 0 {
		return "", composer.Node{}, errors.New("port must not be zero")
	}
	return address, dialer, nil
}
