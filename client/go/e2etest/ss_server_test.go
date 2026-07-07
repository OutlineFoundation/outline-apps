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

package e2etest

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/tunnel-server/service"
)

const (
	// MakeTestCiphers registers secrets with the chacha20-ietf-poly1305 cipher.
	testCipher = "chacha20-ietf-poly1305"
	testSecret = "e2e-test-secret"
)

// testSSServer is a real outline-ss-server Shadowsocks service listening on
// loopback, so tests can exercise the client's full transport stack without
// touching the network.
type testSSServer struct {
	hostPort string

	mu             sync.Mutex
	lastFirstBytes []byte
}

// HostPort returns the loopback host:port the server listens on (same port
// for TCP and UDP, as access keys carry a single endpoint).
func (s *testSSServer) HostPort() string {
	return s.hostPort
}

// FirstWireBytes returns the first raw bytes the client sent on the most
// recent TCP connection, for wire-level assertions such as the salt prefix.
func (s *testSSServer) FirstWireBytes() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]byte(nil), s.lastFirstBytes...)
}

func startSSServer(t *testing.T) *testSSServer {
	t.Helper()

	ciphers, err := service.MakeTestCiphers([]string{testSecret})
	require.NoError(t, err)
	// The default target validators reject non-public addresses (a proxy
	// shouldn't relay to localhost), but our test targets live on loopback.
	allowAll := func(net.IP) error { return nil }
	options := []service.Option{
		service.WithCiphers(ciphers),
		service.WithStreamDialer(service.MakeValidatingTCPStreamDialer(allowAll, 0)),
		service.WithPacketListener(service.MakeTargetUDPListener(allowAll, 30*time.Second, 0)),
	}
	if testing.Verbose() {
		options = append(options, service.WithLogger(slog.New(
			slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}),
		)))
	}
	streamHandler, associationHandler := service.NewShadowsocksHandlers(options...)

	// TCP and UDP must share a port number because access keys carry a single
	// endpoint. Binding the UDP port right after the ephemeral TCP port can
	// race with other processes, so retry a few times.
	var listener net.Listener
	var packetConn net.PacketConn
	for attempt := 0; attempt < 10 && packetConn == nil; attempt++ {
		listener, err = net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		port := listener.Addr().(*net.TCPAddr).Port
		packetConn, err = net.ListenPacket("udp", fmt.Sprintf("127.0.0.1:%d", port))
		if err != nil {
			listener.Close()
			listener = nil
		}
	}
	require.NotNil(t, packetConn, "could not bind TCP and UDP on the same port")

	server := &testSSServer{hostPort: listener.Addr().String()}

	go service.StreamServe(
		func() (transport.StreamConn, error) {
			conn, err := listener.Accept()
			if err != nil {
				return nil, err
			}
			server.mu.Lock()
			server.lastFirstBytes = nil
			server.mu.Unlock()
			return &recordingConn{TCPConn: conn.(*net.TCPConn), server: server}, nil
		},
		func(ctx context.Context, conn transport.StreamConn) {
			streamHandler.HandleStream(ctx, conn, &service.NoOpTCPConnMetrics{})
		},
	)
	go service.PacketServe(
		packetConn,
		func(ctx context.Context, conn net.Conn) {
			associationHandler.HandleAssociation(ctx, conn, &service.NoOpUDPAssociationMetrics{})
		},
		noopNATMetrics{},
	)

	t.Cleanup(func() {
		listener.Close()
		packetConn.Close()
	})
	return server
}

// wireCaptureLimit bounds how many raw bytes recordingConn captures; enough
// to cover any prefix used in tests.
const wireCaptureLimit = 16

// recordingConn captures the first bytes the client sends on the wire.
type recordingConn struct {
	*net.TCPConn
	server *testSSServer
}

func (c *recordingConn) Read(p []byte) (int, error) {
	n, err := c.TCPConn.Read(p)
	if n > 0 {
		c.server.mu.Lock()
		if captured := len(c.server.lastFirstBytes); captured < wireCaptureLimit {
			take := wireCaptureLimit - captured
			if take > n {
				take = n
			}
			c.server.lastFirstBytes = append(c.server.lastFirstBytes, p[:take]...)
		}
		c.server.mu.Unlock()
	}
	return n, err
}

type noopNATMetrics struct{}

func (noopNATMetrics) AddNATEntry()    {}
func (noopNATMetrics) RemoveNATEntry() {}

// startTCPEcho starts a loopback TCP server that echoes everything back.
func startTCPEcho(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				io.Copy(c, c) //nolint:errcheck
			}(conn)
		}
	}()
	t.Cleanup(func() { listener.Close() })
	return listener.Addr().String()
}

// startUDPEcho starts a loopback UDP server that echoes datagrams back.
func startUDPEcho(t *testing.T) netip.AddrPort {
	t.Helper()
	packetConn, err := net.ListenPacket("udp", "127.0.0.1:0")
	require.NoError(t, err)
	go func() {
		buffer := make([]byte, 2048)
		for {
			n, addr, err := packetConn.ReadFrom(buffer)
			if err != nil {
				return
			}
			packetConn.WriteTo(buffer[:n], addr) //nolint:errcheck
		}
	}()
	t.Cleanup(func() { packetConn.Close() })
	return packetConn.LocalAddr().(*net.UDPAddr).AddrPort()
}
