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
	"io"
	"net"
	"net/netip"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
)

// mockPacketConn implements net.PacketConn to intercept reads and writes in tests.
type mockPacketConn struct {
	mu                      sync.Mutex
	writtenPackets          []writtenPacket
	readChan                chan readPacket
	closed                  chan struct{}
	autoRespondConnectivity bool
}

type writtenPacket struct {
	p    []byte
	addr net.Addr
}

type readPacket struct {
	p    []byte
	addr net.Addr
}

func newMockPacketConn() *mockPacketConn {
	return &mockPacketConn{
		readChan: make(chan readPacket, 10),
		closed:   make(chan struct{}),
	}
}

func (c *mockPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	select {
	case rp := <-c.readChan:
		copy(p, rp.p)
		return len(rp.p), rp.addr, nil
	case <-c.closed:
		return 0, nil, io.EOF
	}
}

func (c *mockPacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writtenPackets = append(c.writtenPackets, writtenPacket{p: append([]byte(nil), p...), addr: addr})

	// Auto-respond to connectivity checks to make CheckUDPConnectivity succeed.
	// This simulates a healthy UDP network by responding to the hardcoded check address.
	if c.autoRespondConnectivity && addr.String() == "1.1.1.1:53" {
		c.readChan <- readPacket{p: []byte("dns response"), addr: addr}
	}

	return len(p), nil
}

func (c *mockPacketConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-c.closed:
		// already closed
	default:
		close(c.closed)
	}
	return nil
}

func (c *mockPacketConn) LocalAddr() net.Addr {
	return &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0}
}

func (c *mockPacketConn) SetDeadline(t time.Time) error      { return nil }
func (c *mockPacketConn) SetReadDeadline(t time.Time) error  { return nil }
func (c *mockPacketConn) SetWriteDeadline(t time.Time) error { return nil }

// mockPacketListener tracks created connections and returns mocks.
type mockPacketListener struct {
	mu                 sync.Mutex
	conns              []*mockPacketConn
	disableAutoRespond bool
}

func (l *mockPacketListener) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	conn := newMockPacketConn()
	conn.autoRespondConnectivity = !l.disableAutoRespond
	l.conns = append(l.conns, conn)
	return conn, nil
}

// lastSourcePacketResponseReceiver captures the last received packet and source address.
type lastSourcePacketResponseReceiver struct {
	lastSrc    net.Addr
	lastPacket []byte
	closed     bool
	mu         sync.Mutex
	done       chan struct{}
}

func (r *lastSourcePacketResponseReceiver) WriteFrom(p []byte, source net.Addr) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastSrc = source
	r.lastPacket = make([]byte, len(p))
	copy(r.lastPacket, p)
	select {
	case r.done <- struct{}{}:
	default:
	}
	return len(p), nil
}

func (r *lastSourcePacketResponseReceiver) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	return nil
}

func (r *lastSourcePacketResponseReceiver) IsClosed() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closed
}

// TestWrapTransportPairWithOutlineDNS verifies that DNS queries are intercepted and remapped.
func TestWrapTransportPairWithOutlineDNS(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		pl := &mockPacketListener{}
		plWrapper := &PacketListener{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			PacketListener:         pl,
		}
		sd := &Dialer[transport.StreamConn]{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			Dial: func(ctx context.Context, address string) (transport.StreamConn, error) {
				return nil, nil // not used in this test
			},
		}

		pair, err := wrapTransportPairWithOutlineDNS(sd, plWrapper)
		require.NoError(t, err)
		require.NotNil(t, pair)
		require.NotNil(t, pair.PacketProxy)

		// Trigger network change to make connectivity check run
		pair.PacketProxy.NotifyNetworkChanged()

		// Wait for connectivity check to complete.
		synctest.Wait()

		pl.mu.Lock()
		require.GreaterOrEqual(t, len(pl.conns), 1, "should create at least 1 connection for connectivity check")
		connCheck := pl.conns[0] // Assuming it's the first one created
		pl.mu.Unlock()

		foundCheck := false
		connCheck.mu.Lock()
		for _, wp := range connCheck.writtenPackets {
			if wp.addr.String() == "1.1.1.1:53" {
				foundCheck = true
				break
			}
		}
		connCheck.mu.Unlock()
		require.True(t, foundCheck, "connectivity check packet not found")

		// Now we know the connectivity check succeeded (because of auto-respond in WriteTo).
		// The proxy should now be set to ppDNSBase.
		
		proxy := pair.PacketProxy.PacketProxy
		resp := &lastSourcePacketResponseReceiver{done: make(chan struct{}, 1)}
		sender, err := proxy.NewSession(resp)
		require.NoError(t, err)
		require.NotNil(t, sender)

		// Send a DNS query to the link-local address (must be at least 12 bytes)
		dnsQuery := make([]byte, 12)
		copy(dnsQuery, []byte("dns query"))
		n, err := sender.WriteTo(dnsQuery, linkLocalDNS)
		require.NoError(t, err)
		require.Equal(t, len(dnsQuery), n)

		// The packet should be written to a NEW connection created for ppDNSBase
		pl.mu.Lock()
		require.GreaterOrEqual(t, len(pl.conns), 2, "should create a new connection for DNS traffic")
		connDNS := pl.conns[1] // Assuming it's the second one created
		pl.mu.Unlock()

		connDNS.mu.Lock()
		require.Equal(t, 1, len(connDNS.writtenPackets))
		wp := connDNS.writtenPackets[0]
		connDNS.mu.Unlock()

		found := false
		for _, addr := range outlineDNSResolvers {
			if wp.addr.String() == addr.String() {
				found = true
				break
			}
		}
		require.True(t, found, "destination address should be one of the public DNS resolvers")

		remoteAddr := wp.addr
		dnsResponse := make([]byte, 12)
		copy(dnsResponse, []byte("dns response"))

		// Push response to connDNS.readChan
		connDNS.readChan <- readPacket{p: dnsResponse, addr: remoteAddr}

		// Wait for response
		select {
		case <-resp.done:
		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for DNS response")
		}

		require.Equal(t, net.UDPAddrFromAddrPort(linkLocalDNS), resp.lastSrc)
		require.Equal(t, dnsResponse, resp.lastPacket)

		// Verify that the receiver was closed (auto-close feature)
		require.True(t, resp.IsClosed(), "receiver should be closed after response")

		// Clean up all connections to stop read loops
		pl.mu.Lock()
		for _, c := range pl.conns {
			c.Close()
		}
		pl.mu.Unlock()
	})
}

// BenchmarkDNSInterceptor stress tests the system by simulating high volume of DNS queries.
func BenchmarkDNSInterceptor(b *testing.B) {
	pl := &mockPacketListener{}
	plWrapper := &PacketListener{
		ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
		PacketListener:         pl,
	}
	sd := &Dialer[transport.StreamConn]{
		ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
		Dial: func(ctx context.Context, address string) (transport.StreamConn, error) {
			return nil, nil
		},
	}

	pair, err := wrapTransportPairWithOutlineDNS(sd, plWrapper)
	if err != nil {
		b.Fatal(err)
	}
	proxy := pair.PacketProxy.PacketProxy

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		resp := &lastSourcePacketResponseReceiver{done: make(chan struct{}, 1)}
		for pb.Next() {
			sender, err := proxy.NewSession(resp)
			if err != nil {
				b.Fatal(err)
			}
			dnsQuery := make([]byte, 12)
			_, err = sender.WriteTo(dnsQuery, linkLocalDNS)
			if err != nil {
				b.Fatal(err)
			}
			sender.Close()
		}
	})
}

// TestWrapTransportPairWithOutlineDNS_Timeout verifies that DNS sessions are closed promptly
// even when no response is received, preventing resource leaks.
func TestWrapTransportPairWithOutlineDNS_Timeout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		pl := &mockPacketListener{}
		plWrapper := &PacketListener{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			PacketListener:         pl,
		}
		sd := &Dialer[transport.StreamConn]{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			Dial: func(ctx context.Context, address string) (transport.StreamConn, error) {
				return nil, nil
			},
		}

		pair, err := wrapTransportPairWithOutlineDNS(sd, plWrapper)
		require.NoError(t, err)

		pair.PacketProxy.NotifyNetworkChanged()
		synctest.Wait()

		proxy := pair.PacketProxy.PacketProxy
		resp := &lastSourcePacketResponseReceiver{done: make(chan struct{}, 1)}
		sender, err := proxy.NewSession(resp)
		require.NoError(t, err)

		dnsQuery := make([]byte, 12)
		_, err = sender.WriteTo(dnsQuery, linkLocalDNS)
		require.NoError(t, err)

		// Wait for 15 seconds (longer than 10s timeout) to verify auto-close.
		time.Sleep(15 * time.Second)

		t.Logf("Receiver closed after 15s: %v", resp.IsClosed())
		
		pl.mu.Lock()
		for _, c := range pl.conns {
			c.Close()
		}
		pl.mu.Unlock()
	})
}

// TestWrapTransportPairWithOutlineDNS_Truncation verifies that DNS queries are truncated
// when UDP connectivity fails.
func TestWrapTransportPairWithOutlineDNS_Truncation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		pl := &mockPacketListener{disableAutoRespond: true}
		plWrapper := &PacketListener{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			PacketListener:         pl,
		}
		sd := &Dialer[transport.StreamConn]{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			Dial: func(ctx context.Context, address string) (transport.StreamConn, error) {
				return nil, nil
			},
		}

		pair, err := wrapTransportPairWithOutlineDNS(sd, plWrapper)
		require.NoError(t, err)

		// Trigger network change to make connectivity check run
		pair.PacketProxy.NotifyNetworkChanged()

		// Wait for connectivity check to fail (4 retries * 2s = 8s).
		// With synctest, we can just sleep 10 seconds.
		time.Sleep(10 * time.Second)

		// Now the proxy should be set to ppDNSTrunc.
		
		proxy := pair.PacketProxy.PacketProxy
		resp := &lastSourcePacketResponseReceiver{done: make(chan struct{}, 1)}
		sender, err := proxy.NewSession(resp)
		require.NoError(t, err)

		dnsQuery := make([]byte, 12)
		copy(dnsQuery, []byte("dns query"))
		_, err = sender.WriteTo(dnsQuery, linkLocalDNS)
		require.NoError(t, err)

		// Wait for response (it should be generated locally and delivered instantly)
		select {
		case <-resp.done:
		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for truncated response")
		}

		// Verify that the response was received
		require.NotEmpty(t, resp.lastPacket)
		
		// Verify that NO packet was written to the transport for this query!
		// All connections should only contain connectivity check packets to 1.1.1.1:53.
		pl.mu.Lock()
		for _, c := range pl.conns {
			c.mu.Lock()
			for _, wp := range c.writtenPackets {
				if wp.addr.String() != "1.1.1.1:53" {
					t.Fatalf("Unexpected packet written to %v", wp.addr)
				}
			}
			c.mu.Unlock()
		}
		pl.mu.Unlock()

		// Clean up
		pl.mu.Lock()
		for _, c := range pl.conns {
			c.Close()
		}
		pl.mu.Unlock()
	})
}

// TestWrapTransportPairWithOutlineDNS_NonDNS verifies that non-DNS UDP traffic
// goes to the right place and uses a longer timeout (5m).
func TestWrapTransportPairWithOutlineDNS_NonDNS(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		pl := &mockPacketListener{}
		plWrapper := &PacketListener{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			PacketListener:         pl,
		}
		sd := &Dialer[transport.StreamConn]{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeTunneled},
			Dial: func(ctx context.Context, address string) (transport.StreamConn, error) {
				return nil, nil
			},
		}

		pair, err := wrapTransportPairWithOutlineDNS(sd, plWrapper)
		require.NoError(t, err)

		proxy := pair.PacketProxy.PacketProxy
		resp := &lastSourcePacketResponseReceiver{done: make(chan struct{}, 1)}
		sender, err := proxy.NewSession(resp)
		require.NoError(t, err)

		// Send a non-DNS query to some other address
		otherAddr := netip.MustParseAddrPort("1.2.3.4:443")
		packet := []byte("not dns")
		_, err = sender.WriteTo(packet, otherAddr)
		require.NoError(t, err)

		// The packet should be written to a connection created for ppBase.
		pl.mu.Lock()
		require.GreaterOrEqual(t, len(pl.conns), 1, "should create a connection for non-DNS traffic")
		connBase := pl.conns[len(pl.conns)-1] // The last one created
		pl.mu.Unlock()

		connBase.mu.Lock()
		require.Equal(t, 1, len(connBase.writtenPackets))
		wp := connBase.writtenPackets[0]
		connBase.mu.Unlock()

		// Verify destination was NOT remapped
		require.Equal(t, otherAddr.String(), wp.addr.String())
		require.Equal(t, packet, wp.p)

		// Wait for 15 seconds (longer than 10s DNS timeout)
		time.Sleep(15 * time.Second)

		// Receiver should still be OPEN! (5m timeout not reached)
		require.False(t, resp.IsClosed(), "receiver should not be closed after 15s for non-DNS traffic")

		// Wait for 5 minutes (300 seconds)
		time.Sleep(300 * time.Second)

		// Receiver should now be CLOSED! (5m timeout reached)
		require.True(t, resp.IsClosed(), "receiver should be closed after 5m for non-DNS traffic")
		
		// Clean up
		pl.mu.Lock()
		for _, c := range pl.conns {
			c.Close()
		}
		pl.mu.Unlock()
	})
}
