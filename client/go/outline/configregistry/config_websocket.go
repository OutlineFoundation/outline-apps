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
	"fmt"
	"net"
	"net/http"
	"net/url"

	"localhost/client/go/composer"
	"localhost/client/go/outline/useragent"
	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/x/websocket"
)

type WebsocketEndpointConfig struct {
	URL      composer.Optional[string]
	Endpoint composer.Optional[composer.Node]
}

func parseWebsocketStreamEndpoint(ctx context.Context, r composer.Registry, node composer.Node) (*Endpoint[transport.StreamConn], error) {
	return parseWebsocketEndpoint(ctx, r, node, websocket.NewStreamEndpoint)
}

func parseWebsocketPacketEndpoint(ctx context.Context, r composer.Registry, node composer.Node) (*Endpoint[net.Conn], error) {
	return parseWebsocketEndpoint(ctx, r, node, websocket.NewPacketEndpoint)
}

type newWebsocketEndpoint[ConnType any] func(urlStr string, se transport.StreamEndpoint, opts ...websocket.Option) (func(context.Context) (ConnType, error), error)

func parseWebsocketEndpoint[ConnType any](ctx context.Context, r composer.Registry, node composer.Node, newWE newWebsocketEndpoint[ConnType]) (*Endpoint[ConnType], error) {
	var config WebsocketEndpointConfig
	if err := node.Decode(&config); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}

	url, err := url.Parse(config.URL.Or(""))
	if err != nil {
		return nil, fmt.Errorf("url is invalid: %w", err)
	}
	port := url.Port()
	if port == "" {
		switch url.Scheme {
		case "https", "wss":
			url.Scheme = "wss"
			port = "443"
		case "http", "ws":
			url.Scheme = "ws"
			port = "80"
		}
	}

	endpointNode, ok := config.Endpoint.Get()
	if !ok || endpointNode.IsAbsent() {
		endpointNode, err = stringNode(net.JoinHostPort(url.Hostname(), port))
		if err != nil {
			return nil, err
		}
	}
	se, err := composer.Parse[*Endpoint[transport.StreamConn]](ctx, r, endpointNode)
	if err != nil {
		return nil, fmt.Errorf("failed to parse websocket endpoint: %w", err)
	}

	headers := http.Header(map[string][]string{
		"User-Agent": {useragent.GetOutlineUserAgent()},
	})
	connect, err := newWE(url.String(), transport.FuncStreamEndpoint(se.Connect), websocket.WithHTTPHeaders(headers))
	if err != nil {
		return nil, err
	}

	return &Endpoint[ConnType]{
		ConnectionProviderInfo: se.ConnectionProviderInfo,
		Connect:                connect,
	}, nil
}
