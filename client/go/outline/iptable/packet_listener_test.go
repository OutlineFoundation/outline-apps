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

package iptable

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
)

type sentPacket struct {
	data string
	addr string
}

type fakePacketConn struct {
	sent     chan sentPacket
	incoming chan receivedPacket

	mu            sync.Mutex
	closed        chan struct{}
	writeDeadline time.Time
}

func (c *fakePacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	c.sent <- sentPacket{string(p), addr.String()}
	return len(p), nil
}

func (c *fakePacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	select {
	case packet := <-c.incoming:
		return copy(p, packet.data), packet.addr, packet.err
	case <-c.closed:
		return 0, nil, net.ErrClosed
	}
}

func (c *fakePacketConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-c.closed:
		return net.ErrClosed
	default:
		close(c.closed)
		return nil
	}
}

func (c *fakePacketConn) isClosed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
}

func (c *fakePacketConn) LocalAddr() net.Addr { return &net.UDPAddr{} }

func (c *fakePacketConn) SetDeadline(t time.Time) error     { return errors.New("not used") }
func (c *fakePacketConn) SetReadDeadline(t time.Time) error { return errors.New("not used") }
func (c *fakePacketConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writeDeadline = t
	return nil
}

func (c *fakePacketConn) getWriteDeadline() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.writeDeadline
}

type fakePacketListener struct {
	mu    sync.Mutex
	conns []*fakePacketConn
	err   error
}

var _ transport.PacketListener = (*fakePacketListener)(nil)

func (l *fakePacketListener) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.err != nil {
		return nil, l.err
	}
	conn := &fakePacketConn{
		sent:     make(chan sentPacket, 10),
		incoming: make(chan receivedPacket),
		closed:   make(chan struct{}),
	}
	l.conns = append(l.conns, conn)
	return conn, nil
}

func (l *fakePacketListener) openedConns() []*fakePacketConn {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]*fakePacketConn(nil), l.conns...)
}

func newTestPacketListener(t *testing.T, routes map[string]*fakePacketListener, fallback *fakePacketListener) *PacketListener {
	table := NewIPTable[transport.PacketListener]()
	for prefix, listener := range routes {
		require.NoError(t, table.AddPrefix(netip.MustParsePrefix(prefix), listener))
	}
	var fallbackListener transport.PacketListener
	if fallback != nil {
		fallbackListener = fallback
	}
	listener, err := NewPacketListener(table, fallbackListener)
	require.NoError(t, err)
	return listener
}

func udpAddr(s string) *net.UDPAddr {
	return net.UDPAddrFromAddrPort(netip.MustParseAddrPort(s))
}

func TestPacketListener_RoutesByDestination(t *testing.T) {
	wide, narrow, fallback, unused := &fakePacketListener{}, &fakePacketListener{}, &fakePacketListener{}, &fakePacketListener{}
	pl := newTestPacketListener(t, map[string]*fakePacketListener{
		"10.0.0.0/8":    wide,
		"10.1.0.0/16":   narrow,
		"192.0.2.0/24":  unused,
		"2001:db8::/32": narrow,
	}, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	for _, tc := range []struct {
		addr     net.Addr
		listener *fakePacketListener
	}{
		{udpAddr("10.2.3.4:443"), wide},
		{udpAddr("10.1.2.3:443"), narrow},
		{udpAddr("[::ffff:10.1.2.3]:443"), narrow},
		{udpAddr("[2001:db8::1]:443"), narrow},
		{udpAddr("8.8.8.8:53"), fallback},
		{udpAddr("10.2.3.4:443"), wide},
	} {
		_, err := conn.WriteTo([]byte("hello"), tc.addr)
		require.NoError(t, err)
		conns := tc.listener.openedConns()
		require.Len(t, conns, 1, "route for %v must open exactly one socket", tc.addr)
		require.Equal(t, sentPacket{"hello", tc.addr.String()}, <-conns[0].sent)
	}
	require.Empty(t, unused.openedConns(), "unused routes must not open sockets")
}

func TestPacketListener_NoFallback(t *testing.T) {
	routed := &fakePacketListener{}
	pl := newTestPacketListener(t, map[string]*fakePacketListener{"10.0.0.0/8": routed}, nil)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	_, err = conn.WriteTo([]byte("hello"), udpAddr("8.8.8.8:53"))
	require.ErrorContains(t, err, "no listener available for address 8.8.8.8:53")
	require.Empty(t, routed.openedConns())
}

func TestPacketListener_RouteOpenFailureIsIsolated(t *testing.T) {
	broken := &fakePacketListener{err: errors.New("cannot open")}
	fallback := &fakePacketListener{}
	pl := newTestPacketListener(t, map[string]*fakePacketListener{"10.0.0.0/8": broken}, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	_, err = conn.WriteTo([]byte("hello"), udpAddr("10.0.0.1:443"))
	require.ErrorContains(t, err, "cannot open")

	_, err = conn.WriteTo([]byte("hello"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)
}

func TestPacketListener_ReadFromMergesRoutes(t *testing.T) {
	routed, fallback := &fakePacketListener{}, &fakePacketListener{}
	pl := newTestPacketListener(t, map[string]*fakePacketListener{"10.0.0.0/8": routed}, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	_, err = conn.WriteTo([]byte("a"), udpAddr("10.0.0.1:443"))
	require.NoError(t, err)
	_, err = conn.WriteTo([]byte("b"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)

	go func() {
		routed.openedConns()[0].incoming <- receivedPacket{data: []byte("from routed"), addr: udpAddr("10.0.0.1:443")}
		fallback.openedConns()[0].incoming <- receivedPacket{data: []byte("from fallback"), addr: udpAddr("8.8.8.8:53")}
	}()

	got := map[string]string{}
	buf := make([]byte, 100)
	for range 2 {
		n, addr, err := conn.ReadFrom(buf)
		require.NoError(t, err)
		got[addr.String()] = string(buf[:n])
	}
	require.Equal(t, map[string]string{
		"10.0.0.1:443": "from routed",
		"8.8.8.8:53":   "from fallback",
	}, got)
}

func TestPacketListener_ReadFromShortBuffer(t *testing.T) {
	fallback := &fakePacketListener{}
	pl := newTestPacketListener(t, nil, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	_, err = conn.WriteTo([]byte("a"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)
	go func() {
		incoming := fallback.openedConns()[0].incoming
		incoming <- receivedPacket{data: []byte("too long"), addr: udpAddr("8.8.8.8:53")}
		incoming <- receivedPacket{data: []byte("fits"), addr: udpAddr("8.8.8.8:53")}
	}()

	buf := make([]byte, 4)
	_, _, err = conn.ReadFrom(buf)
	require.ErrorIs(t, err, io.ErrShortBuffer)
	n, _, err := conn.ReadFrom(buf)
	require.NoError(t, err)
	require.Equal(t, "fits", string(buf[:n]))
}

func TestPacketListener_ReadDeadline(t *testing.T) {
	fallback := &fakePacketListener{}
	pl := newTestPacketListener(t, nil, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	t.Run("expires without any route socket", func(t *testing.T) {
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(20*time.Millisecond)))
		_, _, err := conn.ReadFrom(make([]byte, 10))
		require.ErrorIs(t, err, os.ErrDeadlineExceeded)
		var netErr net.Error
		require.ErrorAs(t, err, &netErr)
		require.True(t, netErr.Timeout())
	})

	t.Run("past deadline returns immediately", func(t *testing.T) {
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(-time.Second)))
		_, _, err := conn.ReadFrom(make([]byte, 10))
		require.ErrorIs(t, err, os.ErrDeadlineExceeded)
	})

	t.Run("extension while blocked", func(t *testing.T) {
		_, err := conn.WriteTo([]byte("a"), udpAddr("8.8.8.8:53"))
		require.NoError(t, err)
		require.NoError(t, conn.SetReadDeadline(time.Now().Add(50*time.Millisecond)))
		go func() {
			time.Sleep(10 * time.Millisecond)
			conn.SetReadDeadline(time.Now().Add(time.Second))
			time.Sleep(100 * time.Millisecond)
			fallback.openedConns()[0].incoming <- receivedPacket{data: []byte("late"), addr: udpAddr("8.8.8.8:53")}
		}()
		buf := make([]byte, 10)
		n, _, err := conn.ReadFrom(buf)
		require.NoError(t, err)
		require.Equal(t, "late", string(buf[:n]))
	})

	t.Run("earlier deadline while blocked", func(t *testing.T) {
		require.NoError(t, conn.SetReadDeadline(time.Time{}))
		go func() {
			time.Sleep(10 * time.Millisecond)
			conn.SetReadDeadline(time.Now().Add(10 * time.Millisecond))
		}()
		start := time.Now()
		_, _, err := conn.ReadFrom(make([]byte, 10))
		require.ErrorIs(t, err, os.ErrDeadlineExceeded)
		require.Less(t, time.Since(start), time.Second)
	})
}

func TestPacketListener_WriteDeadlineAppliesToAllRoutes(t *testing.T) {
	routed, fallback := &fakePacketListener{}, &fakePacketListener{}
	pl := newTestPacketListener(t, map[string]*fakePacketListener{"10.0.0.0/8": routed}, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	first := time.Now().Add(time.Minute)
	require.NoError(t, conn.SetDeadline(first))
	_, err = conn.WriteTo([]byte("a"), udpAddr("10.0.0.1:443"))
	require.NoError(t, err)
	require.Equal(t, first, routed.openedConns()[0].getWriteDeadline(), "sockets opened later must get the current deadline")

	second := first.Add(time.Minute)
	require.NoError(t, conn.SetDeadline(second))
	_, err = conn.WriteTo([]byte("b"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)
	require.Equal(t, second, routed.openedConns()[0].getWriteDeadline(), "existing sockets must get the new deadline")
	require.Equal(t, second, fallback.openedConns()[0].getWriteDeadline())
}

func TestPacketListener_RouteReadErrorReopensRoute(t *testing.T) {
	fallback := &fakePacketListener{}
	pl := newTestPacketListener(t, nil, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	_, err = conn.WriteTo([]byte("a"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)
	readErr := errors.New("read failed")
	go func() {
		fallback.openedConns()[0].incoming <- receivedPacket{addr: udpAddr("8.8.8.8:53"), err: readErr}
	}()
	_, _, err = conn.ReadFrom(make([]byte, 10))
	require.ErrorIs(t, err, readErr)

	require.Eventually(t, fallback.openedConns()[0].isClosed, time.Second, time.Millisecond, "failed socket must be closed")
	_, err = conn.WriteTo([]byte("b"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)
	require.Len(t, fallback.openedConns(), 2, "next write must open a new socket")
}

func TestPacketListener_Close(t *testing.T) {
	routed, fallback := &fakePacketListener{}, &fakePacketListener{}
	pl := newTestPacketListener(t, map[string]*fakePacketListener{"10.0.0.0/8": routed}, fallback)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)

	_, err = conn.WriteTo([]byte("a"), udpAddr("10.0.0.1:443"))
	require.NoError(t, err)
	_, err = conn.WriteTo([]byte("b"), udpAddr("8.8.8.8:53"))
	require.NoError(t, err)

	readErr := make(chan error)
	go func() {
		_, _, err := conn.ReadFrom(make([]byte, 10))
		readErr <- err
	}()
	time.Sleep(10 * time.Millisecond)
	require.NoError(t, conn.Close())

	select {
	case err := <-readErr:
		require.ErrorIs(t, err, net.ErrClosed)
	case <-time.After(time.Second):
		t.Fatal("Close did not unblock ReadFrom")
	}
	require.True(t, routed.openedConns()[0].isClosed())
	require.True(t, fallback.openedConns()[0].isClosed())

	_, err = conn.WriteTo([]byte("c"), udpAddr("8.8.8.8:53"))
	require.ErrorIs(t, err, net.ErrClosed)
	require.Len(t, fallback.openedConns(), 1)
	require.ErrorIs(t, conn.Close(), net.ErrClosed)
}

type blockingPacketListener struct{}

func (blockingPacketListener) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestPacketListener_RouteOpenIsBounded(t *testing.T) {
	table := NewIPTable[transport.PacketListener]()
	require.NoError(t, table.AddPrefix(netip.MustParsePrefix("10.0.0.0/8"), &blockingPacketListener{}))
	pl, err := NewPacketListener(table, nil)
	require.NoError(t, err)

	t.Run("by the write deadline", func(t *testing.T) {
		conn, err := pl.ListenPacket(context.Background())
		require.NoError(t, err)
		defer conn.Close()
		require.NoError(t, conn.SetWriteDeadline(time.Now().Add(20*time.Millisecond)))
		_, err = conn.WriteTo([]byte("a"), udpAddr("10.0.0.1:443"))
		require.ErrorIs(t, err, os.ErrDeadlineExceeded)
	})

	t.Run("by Close", func(t *testing.T) {
		conn, err := pl.ListenPacket(context.Background())
		require.NoError(t, err)
		writeErr := make(chan error)
		go func() {
			_, err := conn.WriteTo([]byte("a"), udpAddr("10.0.0.1:443"))
			writeErr <- err
		}()
		time.Sleep(10 * time.Millisecond)
		require.NoError(t, conn.Close())
		select {
		case err := <-writeErr:
			require.ErrorIs(t, err, net.ErrClosed)
		case <-time.After(time.Second):
			t.Fatal("Close did not cancel the pending route open")
		}
	})
}

func TestPacketListener_RealUDP(t *testing.T) {
	echo, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	require.NoError(t, err)
	defer echo.Close()
	go func() {
		buf := make([]byte, 100)
		for {
			n, addr, err := echo.ReadFrom(buf)
			if err != nil {
				return
			}
			echo.WriteTo(buf[:n], addr)
		}
	}()

	table := NewIPTable[transport.PacketListener]()
	require.NoError(t, table.AddPrefix(netip.MustParsePrefix("127.0.0.0/8"), &transport.UDPListener{}))
	pl, err := NewPacketListener(table, nil)
	require.NoError(t, err)
	conn, err := pl.ListenPacket(context.Background())
	require.NoError(t, err)
	defer conn.Close()

	require.NoError(t, conn.SetDeadline(time.Now().Add(5*time.Second)))
	_, err = conn.WriteTo([]byte("ping"), echo.LocalAddr())
	require.NoError(t, err)
	buf := make([]byte, 100)
	n, addr, err := conn.ReadFrom(buf)
	require.NoError(t, err)
	require.Equal(t, "ping", string(buf[:n]))
	require.Equal(t, echo.LocalAddr().String(), addr.String())
}
