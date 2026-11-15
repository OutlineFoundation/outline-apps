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
	"localhost/client/go/composer"
)

func parseStreamEndpoint(t *testing.T, r composer.Registry, text string) (StreamEndpointConfig, error) {
	t.Helper()
	return composer.Parse[StreamEndpointConfig](context.Background(), r, mustNode(t, text))
}

func TestDialEndpoint_ScalarAndMappingForms(t *testing.T) {
	r := newTestRegistry(&recordingDialer{})
	for _, text := range []string{
		`"example.com:443"`,
		"address: example.com:443",
		"$type: dial\naddress: example.com:443",
		"$type: dial\naddress: example.com:443\ndialer: {$type: direct}",
	} {
		parsed, err := parseStreamEndpoint(t, r, text)
		require.NoError(t, err, text)
		config := parsed.(*StreamDialEndpointConfig)
		require.Equal(t, "example.com:443", config.Address, text)
		require.IsType(t, &DirectStreamDialerConfig{}, config.Dialer, text)
	}
}

func TestDialEndpoint_ValidatesTheAddress(t *testing.T) {
	r := newTestRegistry(&recordingDialer{})
	for _, bad := range []string{`"example.com"`, `":443"`, `"example.com:"`, `"example.com:0"`, `"example.com:99999"`, `"example.com:https"`} {
		_, err := parseStreamEndpoint(t, r, bad)
		require.Error(t, err, "address %s", bad)
		require.NotErrorIs(t, err, errors.ErrUnsupported, "address %s", bad)
	}
	_, err := parseStreamEndpoint(t, r, "$type: dial")
	require.ErrorContains(t, err, "address", "the address is required")
}

// Parsing composes configs and touches nothing. Building creates the
// endpoint. Only connecting reaches the network, with the address as written.
func TestDialEndpoint_OnlyConnectingDials(t *testing.T) {
	network := &recordingDialer{}
	ctx := context.Background()

	streamConfig, err := parseStreamEndpoint(t, newTestRegistry(network), `"example.com:443"`)
	require.NoError(t, err)
	streamEndpoint, err := streamConfig.NewStreamEndpoint(ctx)
	require.NoError(t, err)
	require.Empty(t, network.dialed, "parsing and building must not dial")
	_, err = streamEndpoint.ConnectStream(ctx)
	require.ErrorIs(t, err, errNotConnecting)
	require.Equal(t, []string{"example.com:443"}, network.dialed, "the name is not resolved here")

	packetConfig, err := composer.Parse[PacketEndpointConfig](ctx, newTestRegistry(network), mustNode(t, `"example.com:53"`))
	require.NoError(t, err)
	packetEndpoint, err := packetConfig.NewPacketEndpoint(ctx)
	require.NoError(t, err)
	_, err = packetEndpoint.ConnectPacket(ctx)
	require.ErrorIs(t, err, errNotConnecting)
	require.Equal(t, []string{"example.com:443", "example.com:53"}, network.dialed)
}

func TestDialEndpoint_UsesTheConfiguredDialer(t *testing.T) {
	network := &recordingDialer{}
	ctx := context.Background()
	config, err := parseStreamEndpoint(t, newTestRegistry(network), "address: example.com:443\ndialer: {$type: block}")
	require.NoError(t, err)
	endpoint, err := config.NewStreamEndpoint(ctx)
	require.NoError(t, err)
	_, err = endpoint.ConnectStream(ctx)
	require.ErrorIs(t, err, ErrBlocked)
	require.Empty(t, network.dialed)

	_, err = parseStreamEndpoint(t, newTestRegistry(network), "address: example.com:443\ndialer: {$type: teleport}")
	require.ErrorIs(t, err, errors.ErrUnsupported, "an unknown dialer type")
}

// The parser has no dialer of its own: it asks the registry it is given. An
// application can therefore change how every endpoint of a config reaches the
// network, for one parse, without registering anything again.
func TestDialEndpoint_DialerComesFromTheCallersRegistry(t *testing.T) {
	shared := newTestRegistry(&recordingDialer{})
	protected := &recordingDialer{}

	top := composer.NewEmptyRegistry()
	composer.Register(top, composer.DefaultName, composer.As[StreamDialerConfig](NewDirectStreamDialerParser(protected)))
	config, err := parseStreamEndpoint(t, composer.Overlay(top, shared), `"example.com:443"`)
	require.NoError(t, err)

	endpoint, err := config.NewStreamEndpoint(context.Background())
	require.NoError(t, err)
	_, err = endpoint.ConnectStream(context.Background())
	require.ErrorIs(t, err, errNotConnecting)
	require.Equal(t, []string{"example.com:443"}, protected.dialed)
}
