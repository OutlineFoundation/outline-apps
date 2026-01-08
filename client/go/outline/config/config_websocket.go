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

package config

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"

	"localhost/client/go/configyaml"
	"localhost/client/go/outline/useragent"
	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/x/websocket"
)

type WebsocketEndpointConfig struct {
	URL      string
	Endpoint any
}

func NewWebsocketStreamEndpointSubParser(parseSE configyaml.ParseFunc[*Endpoint[transport.StreamConn]]) func(ctx context.Context, input map[string]any) (*Endpoint[transport.StreamConn], error) {
	return func(ctx context.Context, input map[string]any) (*Endpoint[transport.StreamConn], error) {
		return parseWebsocketEndpoint(ctx, input, parseSE, websocket.NewStreamEndpoint)
	}
}

func NewWebsocketPacketEndpointSubParser(parseSE configyaml.ParseFunc[*Endpoint[transport.StreamConn]]) func(ctx context.Context, input map[string]any) (*Endpoint[net.Conn], error) {
	return func(ctx context.Context, input map[string]any) (*Endpoint[net.Conn], error) {
		return parseWebsocketEndpoint(ctx, input, parseSE, websocket.NewPacketEndpoint)
	}
}

type newWebsocketEndpoint[ConnType any] func(urlStr string, se transport.StreamEndpoint, opts ...websocket.Option) (func(context.Context) (ConnType, error), error)

func parseWebsocketEndpoint[ConnType any](ctx context.Context, configMap map[string]any, parseSE configyaml.ParseFunc[*Endpoint[transport.StreamConn]], newWE newWebsocketEndpoint[ConnType]) (*Endpoint[ConnType], error) {
	var config WebsocketEndpointConfig
	if err := configyaml.MapToAny(configMap, &config); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}

	url, err := url.Parse(config.URL)
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

	if config.Endpoint == nil {
		config.Endpoint = net.JoinHostPort(url.Hostname(), port)
	}
	se, err := parseSE(ctx, config.Endpoint)
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
