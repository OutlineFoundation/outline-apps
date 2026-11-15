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
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

func mustNode(t *testing.T, text string) composer.Node {
	t.Helper()
	node, err := composer.ParseYAML([]byte(text))
	require.NoError(t, err)
	return node
}

var errNotConnecting = errors.New("recording dialer: not connecting")

// recordingDialer stands for the device's network. It records the addresses
// it is asked to dial, and connects to none of them.
type recordingDialer struct {
	mu     sync.Mutex
	dialed []string
}

func (d *recordingDialer) record(address string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.dialed = append(d.dialed, address)
}

func (d *recordingDialer) DialStream(_ context.Context, address string) (transport.StreamConn, error) {
	d.record(address)
	return nil, errNotConnecting
}

func (d *recordingDialer) DialPacket(_ context.Context, address string) (net.Conn, error) {
	d.record(address)
	return nil, errNotConnecting
}

// newTestRegistry registers the configs of this package the way an
// application would: an omitted dialer is direct, and an endpoint without a
// $type is a dial endpoint.
func newTestRegistry(network *recordingDialer) composer.MutableRegistry {
	r := composer.NewRegistry()
	directStream := composer.As[StreamDialerConfig](NewDirectStreamDialerParser(network))
	composer.Register(r, "direct", directStream)
	composer.Register(r, composer.DefaultName, directStream)
	composer.Register(r, "block", composer.As[StreamDialerConfig](ParseBlock))

	directPacket := composer.As[PacketDialerConfig](NewDirectPacketDialerParser(network))
	composer.Register(r, "direct", directPacket)
	composer.Register(r, composer.DefaultName, directPacket)
	composer.Register(r, "block", composer.As[PacketDialerConfig](ParseBlock))

	dialStream := composer.As[StreamEndpointConfig](ParseStreamDialEndpoint)
	composer.Register(r, "dial", dialStream)
	composer.Register(r, composer.DefaultName, dialStream)
	dialPacket := composer.As[PacketEndpointConfig](ParsePacketDialEndpoint)
	composer.Register(r, "dial", dialPacket)
	composer.Register(r, composer.DefaultName, dialPacket)
	return r
}
