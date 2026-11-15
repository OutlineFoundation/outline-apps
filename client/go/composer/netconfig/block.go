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
	"net"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

// ErrBlocked is returned by the dialers that a [BlockConfig] builds.
var ErrBlocked = errors.New("blocked by config")

// BlockConfig refuses every connection. It is a [StreamDialerConfig] and a
// [PacketDialerConfig].
type BlockConfig struct{}

// NewStreamDialer implements [StreamDialerConfig].
func (c *BlockConfig) NewStreamDialer(context.Context) (transport.StreamDialer, error) {
	return transport.FuncStreamDialer(func(context.Context, string) (transport.StreamConn, error) {
		return nil, ErrBlocked
	}), nil
}

// NewPacketDialer implements [PacketDialerConfig].
func (c *BlockConfig) NewPacketDialer(context.Context) (transport.PacketDialer, error) {
	return transport.FuncPacketDialer(func(context.Context, string) (net.Conn, error) {
		return nil, ErrBlocked
	}), nil
}

// ParseBlock parses a block config, which has no fields.
func ParseBlock(_ context.Context, _ composer.Registry, node composer.Node) (*BlockConfig, error) {
	if err := decodeNoFields(node); err != nil {
		return nil, err
	}
	return &BlockConfig{}, nil
}
