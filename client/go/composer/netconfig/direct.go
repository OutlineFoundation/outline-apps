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

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

// A direct config stands for the way the device itself reaches the network.
// It has no fields: the application supplies the dialer or listener, for
// example one whose sockets bypass a VPN, when it registers the parser. Every
// other strategy is composed over the direct configs, so replacing them in a
// registry redirects a whole config.

// DirectStreamDialerConfig builds the stream dialer supplied by the
// application.
type DirectStreamDialerConfig struct {
	dialer transport.StreamDialer
}

// NewDirectStreamDialerConfig returns a config that builds dialer.
func NewDirectStreamDialerConfig(dialer transport.StreamDialer) *DirectStreamDialerConfig {
	return &DirectStreamDialerConfig{dialer: dialer}
}

// NewDirectStreamDialerParser returns a parser whose result builds dialer.
// The parser accepts an absent value or a mapping with no fields.
func NewDirectStreamDialerParser(dialer transport.StreamDialer) composer.Parser[*DirectStreamDialerConfig] {
	return fieldlessParser(NewDirectStreamDialerConfig(dialer))
}

// NewStreamDialer implements [StreamDialerConfig].
func (c *DirectStreamDialerConfig) NewStreamDialer(context.Context) (transport.StreamDialer, error) {
	return c.dialer, nil
}

// DirectPacketDialerConfig builds the packet dialer supplied by the
// application.
type DirectPacketDialerConfig struct {
	dialer transport.PacketDialer
}

// NewDirectPacketDialerConfig returns a config that builds dialer.
func NewDirectPacketDialerConfig(dialer transport.PacketDialer) *DirectPacketDialerConfig {
	return &DirectPacketDialerConfig{dialer: dialer}
}

// NewDirectPacketDialerParser returns a parser whose result builds dialer.
// The parser accepts an absent value or a mapping with no fields.
func NewDirectPacketDialerParser(dialer transport.PacketDialer) composer.Parser[*DirectPacketDialerConfig] {
	return fieldlessParser(NewDirectPacketDialerConfig(dialer))
}

// NewPacketDialer implements [PacketDialerConfig].
func (c *DirectPacketDialerConfig) NewPacketDialer(context.Context) (transport.PacketDialer, error) {
	return c.dialer, nil
}

// DirectPacketListenerConfig builds the packet listener supplied by the
// application.
type DirectPacketListenerConfig struct {
	listener transport.PacketListener
}

// NewDirectPacketListenerConfig returns a config that builds listener.
func NewDirectPacketListenerConfig(listener transport.PacketListener) *DirectPacketListenerConfig {
	return &DirectPacketListenerConfig{listener: listener}
}

// NewDirectPacketListenerParser returns a parser whose result builds
// listener. The parser accepts an absent value or a mapping with no fields.
func NewDirectPacketListenerParser(listener transport.PacketListener) composer.Parser[*DirectPacketListenerConfig] {
	return fieldlessParser(NewDirectPacketListenerConfig(listener))
}

// NewPacketListener implements [PacketListenerConfig].
func (c *DirectPacketListenerConfig) NewPacketListener(context.Context) (transport.PacketListener, error) {
	return c.listener, nil
}

// fieldlessParser returns a parser that always returns cfg, after checking
// that the config sets no fields.
func fieldlessParser[Cfg any](cfg Cfg) composer.Parser[Cfg] {
	return func(_ context.Context, _ composer.Registry, node composer.Node) (Cfg, error) {
		if err := decodeNoFields(node); err != nil {
			var zero Cfg
			return zero, err
		}
		return cfg, nil
	}
}

// decodeNoFields accepts an absent value or a mapping that sets no fields.
func decodeNoFields(node composer.Node) error {
	if node.IsAbsent() {
		return nil
	}
	var fields struct{}
	return node.Decode(&fields)
}
