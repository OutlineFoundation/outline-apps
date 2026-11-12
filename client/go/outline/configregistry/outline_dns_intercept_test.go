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

package configregistry

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
)

// countingPacketListener counts the sockets opened to the proxy. Its sockets answer every
// packet with a copy that has the DNS response bit set.
type countingPacketListener struct {
	sockets atomic.Int32
}

func (l *countingPacketListener) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	l.sockets.Add(1)
	return &echoPacketConn{responses: make(chan echoPacket, 256), closed: make(chan struct{})}, nil
}

type echoPacket struct {
	payload []byte
	from    net.Addr
}

type echoPacketConn struct {
	responses chan echoPacket
	closed    chan struct{}
	closeOnce sync.Once

	mu       sync.Mutex
	deadline time.Time
}

func (c *echoPacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	resp := append([]byte(nil), p...)
	resp[2] |= 0x80 // QR
	select {
	case c.responses <- echoPacket{resp, addr}:
	case <-c.closed:
		return 0, net.ErrClosed
	}
	return len(p), nil
}

func (c *echoPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	c.mu.Lock()
	deadline := c.deadline
	c.mu.Unlock()
	timeout := make(<-chan time.Time)
	if !deadline.IsZero() {
		timer := time.NewTimer(time.Until(deadline))
		defer timer.Stop()
		timeout = timer.C
	}
	select {
	case resp := <-c.responses:
		return copy(p, resp.payload), resp.from, nil
	case <-c.closed:
		return 0, nil, net.ErrClosed
	case <-timeout:
		return 0, nil, os.ErrDeadlineExceeded
	}
}

func (c *echoPacketConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return nil
}

func (c *echoPacketConn) SetDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deadline = t
	return nil
}

func (c *echoPacketConn) SetReadDeadline(t time.Time) error  { return c.SetDeadline(t) }
func (c *echoPacketConn) SetWriteDeadline(t time.Time) error { return nil }
func (c *echoPacketConn) LocalAddr() net.Addr                { return &net.UDPAddr{IP: net.IPv4zero} }

type packetQueue chan []byte

func (q packetQueue) HandlePacket(p []byte, _ netip.AddrPort) error {
	q <- append([]byte(nil), p...)
	return nil
}

// queryOutlineDNS sends a DNS query to the intercepted resolver from a new association, as the
// OS does from a new socket, and returns the response.
func queryOutlineDNS(t *testing.T, relay *PacketRelay, id byte) []byte {
	t.Helper()
	sender, receiver, err := relay.NewAssociation()
	require.NoError(t, err)
	defer sender.Close()
	responses := make(packetQueue, 1)
	go receiver.ReceivePackets(responses)
	query := []byte{0, id, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 3, 'c', 'o', 'm', 0, 0, 1, 0, 1}
	require.NoError(t, sender.SendPacket(query, linkLocalDNS))
	select {
	case resp := <-responses:
		require.Equal(t, query[:2], resp[:2])
		return resp
	case <-time.After(5 * time.Second):
		require.FailNow(t, "no DNS response")
		return nil
	}
}

func isTruncatedDNS(resp []byte) bool { return resp[2]&0x02 != 0 }

// Regression test: every DNS query used to open a new socket, and so a new UDP flow, to the
// proxy. NAT gateways limit the UDP flows to one destination, so a burst of queries would break
// name resolution for as long as the OS kept retrying.
func TestOutlineDNS_BurstOfQueriesDoesNotOpenASocketPerQuery(t *testing.T) {
	listener := &countingPacketListener{}
	sd := &Dialer[transport.StreamConn]{
		ConnectionProviderInfo{ConnTypeTunneled, "proxy:1234"},
		func(ctx context.Context, addr string) (transport.StreamConn, error) {
			return nil, errors.New("not used")
		},
	}
	pair, err := wrapTransportPairWithOutlineDNS(sd, &PacketListener{ConnectionProviderInfo{ConnTypeTunneled, "proxy:1234"}, listener})
	require.NoError(t, err)

	// Until UDP is known to work, queries are answered locally with a truncated response.
	require.True(t, isTruncatedDNS(queryOutlineDNS(t, pair.PacketRelay, 0)))
	require.Zero(t, listener.sockets.Load())

	// The session starts: the UDP check passes and queries start being forwarded.
	pair.PacketRelay.NotifyNetworkChanged()
	require.Eventually(t, func() bool {
		return !isTruncatedDNS(queryOutlineDNS(t, pair.PacketRelay, 1))
	}, 5*time.Second, 10*time.Millisecond)
	socketsBefore := listener.sockets.Load()

	const queries = 300
	var wg sync.WaitGroup
	for i := range queries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			require.False(t, isTruncatedDNS(queryOutlineDNS(t, pair.PacketRelay, byte(i))))
		}()
	}
	wg.Wait()
	require.Zero(t, listener.sockets.Load()-socketsBefore, "%d DNS queries must reuse the open socket", queries)
	// One socket for the UDP check, one for all the DNS queries.
	require.LessOrEqual(t, listener.sockets.Load(), int32(2))

	// A network change moves DNS to a new socket.
	pair.PacketRelay.NotifyNetworkChanged()
	require.Eventually(t, func() bool {
		return !isTruncatedDNS(queryOutlineDNS(t, pair.PacketRelay, 2)) && listener.sockets.Load() >= socketsBefore+2
	}, 5*time.Second, 10*time.Millisecond)
	require.LessOrEqual(t, listener.sockets.Load(), socketsBefore+2)
}
