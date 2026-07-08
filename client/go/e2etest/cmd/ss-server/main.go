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

// Command ss-server runs a real outline-ss-server Shadowsocks service on a
// fixed local port, as a hermetic tunnel target for device/emulator E2E runs
// (the Android emulator reaches the host's loopback via 10.0.2.2). It mirrors
// the in-process server used by the transport tests in this module.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"log/slog"
	"net"
	"os"
	"time"

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/tunnel-server/service"
)

const cipherName = "chacha20-ietf-poly1305"

func main() {
	port := flag.Int("port", 18388, "TCP+UDP port to listen on")
	secret := flag.String("secret", "e2e-test-secret", "Shadowsocks secret")
	flag.Parse()

	ciphers, err := service.MakeTestCiphers([]string{*secret})
	if err != nil {
		log.Fatal(err)
	}
	// Allow all targets: the client's connectivity probes hit public
	// addresses, and test echo targets live on loopback.
	allowAll := func(net.IP) error { return nil }
	streamHandler, associationHandler := service.NewShadowsocksHandlers(
		service.WithCiphers(ciphers),
		service.WithStreamDialer(service.MakeValidatingTCPStreamDialer(allowAll, 0)),
		service.WithPacketListener(service.MakeTargetUDPListener(allowAll, 30*time.Second, 0)),
		service.WithLogger(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))),
	)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	packetConn, err := net.ListenPacket("udp", addr)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("shadowsocks server listening on %s (tcp+udp), cipher=%s", addr, cipherName)

	go service.PacketServe(packetConn, func(ctx context.Context, conn net.Conn) {
		associationHandler.HandleAssociation(ctx, conn, &service.NoOpUDPAssociationMetrics{})
	}, noopNATMetrics{})

	service.StreamServe(
		func() (transport.StreamConn, error) {
			conn, err := listener.Accept()
			if err != nil {
				return nil, err
			}
			log.Printf("tcp connection from %s", conn.RemoteAddr())
			return conn.(*net.TCPConn), nil
		},
		func(ctx context.Context, conn transport.StreamConn) {
			streamHandler.HandleStream(ctx, conn, &service.NoOpTCPConnMetrics{})
		},
	)
}

type noopNATMetrics struct{}

func (noopNATMetrics) AddNATEntry()    {}
func (noopNATMetrics) RemoveNATEntry() {}
