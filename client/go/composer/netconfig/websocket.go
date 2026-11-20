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
	"net/http"
	"net/url"
	"strconv"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/x/websocket"
	"localhost/client/go/composer"
)

// WebsocketEndpointConfig tunnels a stream or packets over a WebSocket. It is
// a [StreamEndpointConfig] and a [PacketEndpointConfig].
type WebsocketEndpointConfig struct {
	// URL is the ws:// or wss:// URL of the WebSocket.
	URL string
	// Headers are sent with the WebSocket handshake.
	Headers http.Header
	// Endpoint makes the connection that carries the WebSocket.
	Endpoint StreamEndpointConfig
}

func (c *WebsocketEndpointConfig) options() []websocket.Option {
	if len(c.Headers) == 0 {
		return nil
	}
	return []websocket.Option{websocket.WithHTTPHeaders(c.Headers)}
}

// NewStreamEndpoint implements [StreamEndpointConfig].
func (c *WebsocketEndpointConfig) NewStreamEndpoint(ctx context.Context) (transport.StreamEndpoint, error) {
	inner, err := c.Endpoint.NewStreamEndpoint(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build websocket inner endpoint: %w", err)
	}
	connect, err := websocket.NewStreamEndpoint(c.URL, inner, c.options()...)
	if err != nil {
		return nil, err
	}
	return transport.FuncStreamEndpoint(connect), nil
}

// NewPacketEndpoint implements [PacketEndpointConfig].
func (c *WebsocketEndpointConfig) NewPacketEndpoint(ctx context.Context) (transport.PacketEndpoint, error) {
	inner, err := c.Endpoint.NewStreamEndpoint(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to build websocket inner endpoint: %w", err)
	}
	connect, err := websocket.NewPacketEndpoint(c.URL, inner, c.options()...)
	if err != nil {
		return nil, err
	}
	return transport.FuncPacketEndpoint(connect), nil
}

type websocketOptions struct {
	headers http.Header
}

// WebsocketOption configures the parser from [NewWebsocketEndpointParser].
type WebsocketOption func(*websocketOptions)

// WithWebsocketHeaders sets headers sent with every WebSocket handshake, such
// as the application's User-Agent. Each parsed config gets its own copy.
func WithWebsocketHeaders(headers http.Header) WebsocketOption {
	return func(o *websocketOptions) { o.headers = headers }
}

// NewWebsocketEndpointParser returns a parser of WebSocket endpoints.
//
// The config has a url, and an optional endpoint for the connection that
// carries the WebSocket. Without one, the endpoint is the host and port of
// the URL. Either way it is parsed with the registry, so the application's
// rules for endpoints apply. http and https URLs are accepted as ws and wss.
func NewWebsocketEndpointParser(opts ...WebsocketOption) composer.Parser[*WebsocketEndpointConfig] {
	var options websocketOptions
	for _, opt := range opts {
		opt(&options)
	}
	return func(ctx context.Context, registry composer.Registry, node composer.Node) (*WebsocketEndpointConfig, error) {
		var fields struct {
			URL      string
			Endpoint composer.Optional[composer.Node]
		}
		if err := node.Decode(&fields); err != nil {
			return nil, err
		}
		u, err := url.Parse(fields.URL)
		if err != nil {
			return nil, fmt.Errorf("url is invalid: %w", err)
		}
		port := u.Port()
		switch u.Scheme {
		case "https", "wss":
			u.Scheme = "wss"
			if port == "" {
				port = "443"
			}
		case "http", "ws":
			u.Scheme = "ws"
			if port == "" {
				port = "80"
			}
		default:
			return nil, fmt.Errorf("unsupported websocket scheme %q", u.Scheme)
		}
		if u.Hostname() == "" {
			return nil, errors.New("websocket url has no host")
		}

		endpointNode, ok := fields.Endpoint.Get()
		if !ok {
			endpointNode, err = scalarNode(net.JoinHostPort(u.Hostname(), port))
			if err != nil {
				return nil, err
			}
		}
		inner, err := composer.Parse[StreamEndpointConfig](ctx, registry, endpointNode)
		if err != nil {
			return nil, fmt.Errorf("failed to parse websocket endpoint: %w", err)
		}
		return &WebsocketEndpointConfig{
			URL:      u.String(),
			Headers:  options.headers.Clone(),
			Endpoint: inner,
		}, nil
	}
}

// scalarNode returns a string node that is not part of any document. Parsers
// use it to hand a value they derived, such as an address taken from a URL, to
// the parser that a written value would have gone to.
func scalarNode(text string) (composer.Node, error) {
	return composer.ParseYAML([]byte(strconv.Quote(text)))
}
