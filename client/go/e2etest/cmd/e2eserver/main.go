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

// e2eserver is the hermetic server side of the desktop real-tunnel E2E suite
// (client/e2e/electron/tunnel.spec.ts). It runs inside an isolated network
// namespace (see client/e2e/electron/tunnel/setup_netns.sh) and provides:
//
//   - a real outline-ss-server Shadowsocks service (TCP + UDP on one port,
//     chacha20-ietf-poly1305), the tunnel the client connects to;
//   - an HTTP target that answers 204 to HEAD requests (satisfying the
//     client's connectivity check, whose check domains the namespace's
//     /etc/hosts points here) and a distinctive body to GET requests, so
//     tests can prove traffic egresses through the tunnel: the target
//     address is routable only from inside the namespace.
//
// It prints "READY" on stdout once both listeners are accepting.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/tunnel-server/service"
)

// targetResponseBody is asserted by tunnel.spec.ts to prove the response
// came from this hermetic target and not some other endpoint.
const targetResponseBody = "outline-e2e-target"

func main() {
	ssAddr := flag.String("ss-addr", "10.200.0.2:19999", "host:port for the Shadowsocks service (TCP and UDP)")
	httpAddr := flag.String("http-addr", "10.200.1.1:80", "host:port for the HTTP target")
	secret := flag.String("secret", "outline-e2e-tunnel", "Shadowsocks secret (cipher is chacha20-ietf-poly1305)")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))

	if err := run(*ssAddr, *httpAddr, *secret); err != nil {
		slog.Error("e2eserver failed", "err", err)
		os.Exit(1)
	}
}

func run(ssAddr, httpAddr, secret string) error {
	if err := startSSService(ssAddr, secret); err != nil {
		return fmt.Errorf("failed to start Shadowsocks service on %s: %w", ssAddr, err)
	}
	if err := startHTTPTarget(httpAddr); err != nil {
		return fmt.Errorf("failed to start HTTP target on %s: %w", httpAddr, err)
	}

	// The test action waits for this line before launching the app.
	fmt.Println("READY")
	select {}
}

// startSSService starts a real outline-ss-server Shadowsocks service, like
// the in-process one in ../../ss_server_test.go but on a fixed address.
func startSSService(addr, secret string) error {
	// MakeTestCiphers registers the secret with chacha20-ietf-poly1305.
	ciphers, err := service.MakeTestCiphers([]string{secret})
	if err != nil {
		return err
	}
	// The default target validators reject non-public addresses (a proxy
	// shouldn't relay to localhost), but our test target lives on an
	// address that is private to the network namespace.
	allowAll := func(net.IP) error { return nil }
	streamHandler, associationHandler := service.NewShadowsocksHandlers(
		service.WithCiphers(ciphers),
		service.WithStreamDialer(service.MakeValidatingTCPStreamDialer(allowAll, 0)),
		service.WithPacketListener(service.MakeTargetUDPListener(allowAll, 30*time.Second, 0)),
		service.WithLogger(slog.Default()),
	)

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	packetConn, err := net.ListenPacket("udp", addr)
	if err != nil {
		listener.Close()
		return err
	}

	go service.StreamServe(
		func() (transport.StreamConn, error) {
			conn, err := listener.Accept()
			if err != nil {
				return nil, err
			}
			return conn.(*net.TCPConn), nil
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
	slog.Info("Shadowsocks service listening", "addr", addr)
	return nil
}

// startHTTPTarget serves the connectivity-check and Net.Web target endpoint.
func startHTTPTarget(addr string) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The renderer fetches cross-origin (the app is served from file://).
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodHead {
			// The client's connectivity check sends HEAD requests to
			// generate_204-style URLs; any readable response satisfies it.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		fmt.Fprint(w, targetResponseBody)
	})
	go http.Serve(listener, handler) //nolint:errcheck
	slog.Info("HTTP target listening", "addr", addr)
	return nil
}

type noopNATMetrics struct{}

func (noopNATMetrics) AddNATEntry()    {}
func (noopNATMetrics) RemoveNATEntry() {}
