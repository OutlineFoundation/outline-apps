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
	"fmt"
	"io"
	"net"
	"net/netip"
	"os"
	"sync"
	"time"

	"golang.getoutline.org/sdk/transport"
)

// maxUDPPacketSize is the largest UDP payload a route socket can receive.
const maxUDPPacketSize = 65535

// PacketListener is a [transport.PacketListener] that routes each outgoing packet
// based on its destination IP address using an [IPTable].
// If a specific route is found in the table, the corresponding listener is used.
// Otherwise, the fallback listener (if set) is used.
//
// Each [net.PacketConn] returned by ListenPacket opens at most one socket per route,
// the first time a packet is sent through that route, and merges the packets received
// on all of them.
//
// The listeners in the table and the fallback must be comparable (for example, pointers),
// because they identify the per-route sockets.
type PacketListener struct {
	table    IPTable[transport.PacketListener]
	fallback transport.PacketListener
}

var _ transport.PacketListener = (*PacketListener)(nil)

// NewPacketListener creates a new [PacketListener].
// If the provided table is nil, a new empty table will be created internally.
func NewPacketListener(table IPTable[transport.PacketListener], fallback transport.PacketListener) (*PacketListener, error) {
	if table == nil {
		table = NewIPTable[transport.PacketListener]()
	}
	return &PacketListener{
		table:    table,
		fallback: fallback,
	}, nil
}

// ListenPacket implements [transport.PacketListener]. It doesn't open any sockets until
// the first packet is sent.
func (l *PacketListener) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	openCtx, cancelOpens := context.WithCancel(context.Background())
	return &routingPacketConn{
		listener:            l,
		openCtx:             openCtx,
		cancelOpens:         cancelOpens,
		routes:              make(map[transport.PacketListener]net.PacketConn),
		packets:             make(chan receivedPacket),
		done:                make(chan struct{}),
		readDeadlineEarlier: make(chan struct{}),
	}, nil
}

func (l *PacketListener) route(addr net.Addr) (transport.PacketListener, error) {
	if ip, ok := addrIP(addr); ok {
		if selected := l.table.Lookup(ip); selected != nil {
			return selected, nil
		}
	}
	if l.fallback == nil {
		return nil, fmt.Errorf("no listener available for address %v", addr)
	}
	return l.fallback, nil
}

func addrIP(addr net.Addr) (netip.Addr, bool) {
	if udpAddr, ok := addr.(*net.UDPAddr); ok {
		if ip, ok := netip.AddrFromSlice(udpAddr.IP); ok {
			return ip.Unmap(), true
		}
		return netip.Addr{}, false
	}
	if addr == nil {
		return netip.Addr{}, false
	}
	host := addr.String()
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return ip.Unmap(), true
}

type receivedPacket struct {
	data []byte
	addr net.Addr
	err  error
	// ack is signaled once data has been copied, so the reader can reuse its buffer.
	ack chan<- struct{}
}

// routingPacketConn is the [net.PacketConn] returned by [PacketListener.ListenPacket].
type routingPacketConn struct {
	listener *PacketListener

	// packets hands packets from the route readers to ReadFrom.
	packets chan receivedPacket
	// done is closed by Close.
	done chan struct{}
	// openCtx bounds the opening of route sockets. Close cancels it.
	openCtx     context.Context
	cancelOpens context.CancelFunc

	mu     sync.Mutex
	closed bool
	routes map[transport.PacketListener]net.PacketConn
	// Read deadlines are enforced by ReadFrom. Write deadlines are applied to every route socket.
	readDeadline  time.Time
	writeDeadline time.Time
	// readDeadlineEarlier is closed and replaced when the read deadline moves earlier,
	// so a blocked ReadFrom can re-arm its timer. Extensions don't need to wake it up.
	readDeadlineEarlier chan struct{}
}

var _ net.PacketConn = (*routingPacketConn)(nil)

// WriteTo implements [net.PacketConn]. It sends the packet through the socket of the route
// selected for addr, opening that socket first if needed.
func (c *routingPacketConn) WriteTo(p []byte, addr net.Addr) (int, error) {
	listener, err := c.listener.route(addr)
	if err != nil {
		return 0, err
	}
	conn, err := c.routeConn(listener)
	if err != nil {
		return 0, err
	}
	return conn.WriteTo(p, addr)
}

func (c *routingPacketConn) routeConn(listener transport.PacketListener) (net.PacketConn, error) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil, net.ErrClosed
	}
	if conn, ok := c.routes[listener]; ok {
		c.mu.Unlock()
		return conn, nil
	}
	ctx, cancel := c.openCtx, context.CancelFunc(func() {})
	if !c.writeDeadline.IsZero() {
		ctx, cancel = context.WithDeadline(ctx, c.writeDeadline)
	}
	c.mu.Unlock()
	defer cancel()

	// Don't hold the lock while opening the socket, since it may involve network operations.
	conn, err := listener.ListenPacket(ctx)
	if err != nil {
		if c.isClosed() {
			return nil, net.ErrClosed
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, fmt.Errorf("failed to open route socket: %w: %w", os.ErrDeadlineExceeded, err)
		}
		return nil, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		conn.Close()
		return nil, net.ErrClosed
	}
	if existing, ok := c.routes[listener]; ok {
		// Another write opened the same route concurrently.
		conn.Close()
		return existing, nil
	}
	if !c.writeDeadline.IsZero() {
		if err := conn.SetWriteDeadline(c.writeDeadline); err != nil {
			conn.Close()
			return nil, err
		}
	}
	c.routes[listener] = conn
	go c.readLoop(listener, conn)
	return conn, nil
}

// readLoop forwards the packets received on a route socket to ReadFrom. It stops when the
// routingPacketConn is closed or the socket returns an error, which is also forwarded.
func (c *routingPacketConn) readLoop(listener transport.PacketListener, conn net.PacketConn) {
	buf := make([]byte, maxUDPPacketSize)
	ack := make(chan struct{}, 1)
	for {
		n, addr, err := conn.ReadFrom(buf)
		select {
		case c.packets <- receivedPacket{data: buf[:n], addr: addr, err: err, ack: ack}:
		case <-c.done:
			return
		}
		select {
		case <-ack:
		case <-c.done:
			return
		}
		if err != nil {
			// Forget the broken socket, so the next write through this route opens a new one.
			c.mu.Lock()
			if c.routes[listener] == conn {
				delete(c.routes, listener)
			}
			c.mu.Unlock()
			conn.Close()
			return
		}
	}
}

// ReadFrom implements [net.PacketConn]. It returns the next packet received on any route socket.
func (c *routingPacketConn) ReadFrom(p []byte) (int, net.Addr, error) {
	if c.isClosed() {
		return 0, nil, net.ErrClosed
	}

	var timer *time.Timer
	defer func() {
		if timer != nil {
			timer.Stop()
		}
	}()
	for {
		c.mu.Lock()
		deadline := c.readDeadline
		deadlineEarlier := c.readDeadlineEarlier
		c.mu.Unlock()

		var timeout <-chan time.Time
		if !deadline.IsZero() {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return 0, nil, os.ErrDeadlineExceeded
			}
			if timer == nil {
				timer = time.NewTimer(remaining)
			} else {
				timer.Reset(remaining)
			}
			timeout = timer.C
		}

		select {
		case packet := <-c.packets:
			n := copy(p, packet.data)
			packet.ack <- struct{}{}
			if packet.err != nil && c.isClosed() {
				// The route socket failed because Close closed it.
				return 0, nil, net.ErrClosed
			}
			if packet.err == nil && n < len(packet.data) {
				// Like the Shadowsocks PacketConn, report truncation so callers can drop the packet.
				return n, packet.addr, io.ErrShortBuffer
			}
			return n, packet.addr, packet.err
		case <-timeout:
			// The deadline may have been extended since the timer was armed, so check it again.
		case <-deadlineEarlier:
		case <-c.done:
			return 0, nil, net.ErrClosed
		}
	}
}

func (c *routingPacketConn) isClosed() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

// Close implements [net.PacketConn]. It closes all route sockets, cancels pending route
// opens and unblocks ReadFrom.
func (c *routingPacketConn) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return net.ErrClosed
	}
	c.closed = true
	close(c.done)
	c.cancelOpens()
	routes := c.routes
	c.routes = nil
	c.mu.Unlock()

	var errs []error
	for _, conn := range routes {
		if err := conn.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// LocalAddr implements [net.PacketConn]. There's no single local address, since each route
// has its own socket, so it returns an unspecified UDP address.
func (c *routingPacketConn) LocalAddr() net.Addr {
	return &net.UDPAddr{}
}

// SetDeadline implements [net.PacketConn].
func (c *routingPacketConn) SetDeadline(t time.Time) error {
	if err := c.SetReadDeadline(t); err != nil {
		return err
	}
	return c.SetWriteDeadline(t)
}

// SetReadDeadline implements [net.PacketConn].
func (c *routingPacketConn) SetReadDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return net.ErrClosed
	}
	moreUrgent := !t.IsZero() && (c.readDeadline.IsZero() || t.Before(c.readDeadline))
	c.readDeadline = t
	if moreUrgent {
		close(c.readDeadlineEarlier)
		c.readDeadlineEarlier = make(chan struct{})
	}
	return nil
}

// SetWriteDeadline implements [net.PacketConn]. The deadline also applies to route sockets
// opened later.
func (c *routingPacketConn) SetWriteDeadline(t time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return net.ErrClosed
	}
	c.writeDeadline = t
	var errs []error
	for _, conn := range c.routes {
		if err := conn.SetWriteDeadline(t); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
