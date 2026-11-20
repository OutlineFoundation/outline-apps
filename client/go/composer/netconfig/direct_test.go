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
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

func TestDirect_BuildsWhatTheApplicationSupplied(t *testing.T) {
	stream := &transport.TCPDialer{}
	packet := &transport.UDPDialer{}
	listener := &transport.UDPListener{}
	ctx := context.Background()

	streamConfig, err := NewDirectStreamDialerParser(stream)(ctx, nil, mustNode(t, "$type: direct"))
	require.NoError(t, err)
	builtStream, err := streamConfig.NewStreamDialer(ctx)
	require.NoError(t, err)
	require.Same(t, stream, builtStream)

	packetConfig, err := NewDirectPacketDialerParser(packet)(ctx, nil, mustNode(t, "$type: direct"))
	require.NoError(t, err)
	builtPacket, err := packetConfig.NewPacketDialer(ctx)
	require.NoError(t, err)
	require.Same(t, packet, builtPacket)

	listenerConfig, err := NewDirectPacketListenerParser(listener)(ctx, nil, mustNode(t, "$type: direct"))
	require.NoError(t, err)
	builtListener, err := listenerConfig.NewPacketListener(ctx)
	require.NoError(t, err)
	require.Same(t, listener, builtListener)
}

func TestDirect_AcceptsAnAbsentValueAndNoFields(t *testing.T) {
	parse := NewDirectStreamDialerParser(&transport.TCPDialer{})

	_, err := parse(context.Background(), nil, composer.Node{})
	require.NoError(t, err, "an omitted value")

	_, err = parse(context.Background(), nil, mustNode(t, "$type: direct\nunexpected: true"))
	require.ErrorIs(t, err, errors.ErrUnsupported, "an unknown field")

	_, err = parse(context.Background(), nil, mustNode(t, "$type: direct\nunexpected?: true"))
	require.NoError(t, err, "an unknown field the sender marked as ignorable")

	_, err = parse(context.Background(), nil, mustNode(t, `"direct"`))
	require.Error(t, err, "a scalar")
}

func TestBlock_RefusesEveryConnection(t *testing.T) {
	ctx := context.Background()
	config, err := ParseBlock(ctx, nil, mustNode(t, "$type: block"))
	require.NoError(t, err)

	streamDialer, err := config.NewStreamDialer(ctx)
	require.NoError(t, err)
	_, err = streamDialer.DialStream(ctx, "example.com:443")
	require.ErrorIs(t, err, ErrBlocked)

	packetDialer, err := config.NewPacketDialer(ctx)
	require.NoError(t, err)
	_, err = packetDialer.DialPacket(ctx, "example.com:443")
	require.ErrorIs(t, err, ErrBlocked)

	_, err = ParseBlock(ctx, nil, mustNode(t, "$type: block\nwat: 1"))
	require.ErrorIs(t, err, errors.ErrUnsupported)
}
