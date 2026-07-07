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

// Package e2etest runs the Outline client's transport stack against a real,
// in-process outline-ss-server (QA automation plan Layer 2; see
// docs/qa-automation-plan.md). Test names reference the QA checklist IDs
// they automate.
package e2etest

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"localhost/client/go/outline"
)

func newTestClient(t *testing.T, configText string) *outline.Client {
	t.Helper()
	result := (&outline.ClientConfig{DataDir: t.TempDir()}).New("test-key", configText)
	require.Nil(t, result.Error, "client config error: %v", result.Error)
	require.NotNil(t, result.Client)
	return result.Client
}

// ssURL builds a SIP002 static access key for the test server.
func ssURL(server *testSSServer) string {
	userInfo := base64.URLEncoding.WithPadding(base64.NoPadding).
		EncodeToString([]byte(testCipher + ":" + testSecret))
	return fmt.Sprintf("ss://%s@%s/?outline=1", userInfo, server.HostPort())
}

// roundTripTCP dials targetAddr through the client and verifies an echo.
func roundTripTCP(t *testing.T, client *outline.Client, targetAddr string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := client.DialStream(ctx, targetAddr)
	require.NoError(t, err)
	defer conn.Close()

	message := []byte("hello through the Outline client")
	_, err = conn.Write(message)
	require.NoError(t, err)

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(10*time.Second)))
	received := make([]byte, len(message))
	_, err = io.ReadFull(conn, received)
	require.NoError(t, err)
	require.Equal(t, message, received)
}

// Net.Raw.Tcp, Vpn.Connect (transport half): a static ss:// key tunnels TCP.
func TestTCPRoundTrip_StaticKey(t *testing.T) {
	server := startSSServer(t)
	target := startTCPEcho(t)

	client := newTestClient(t, "transport: "+ssURL(server))
	roundTripTCP(t, client, target)
}

// Vpn.OnlineConfig (JSON config): the legacy JSON form tunnels TCP.
func TestTCPRoundTrip_JSONConfig(t *testing.T) {
	server := startSSServer(t)
	target := startTCPEcho(t)

	config := fmt.Sprintf(
		`transport: {"server":"127.0.0.1","server_port":%s,"method":"%s","password":"%s"}`,
		portOf(t, server.HostPort()), testCipher, testSecret)
	client := newTestClient(t, config)
	roundTripTCP(t, client, target)
}

// Vpn.Connect.WithPrefix: a prefixed key tunnels TCP, and the prefix bytes
// actually appear at the start of the wire traffic.
func TestTCPRoundTrip_Prefix(t *testing.T) {
	server := startSSServer(t)
	target := startTCPEcho(t)

	const prefix = "POST "
	config := fmt.Sprintf(`
transport:
  $type: tcpudp
  tcp:
    $type: shadowsocks
    endpoint: %[1]s
    cipher: %[2]s
    secret: %[3]s
    prefix: "%[4]s"
  udp:
    $type: shadowsocks
    endpoint: %[1]s
    cipher: %[2]s
    secret: %[3]s`,
		server.HostPort(), testCipher, testSecret, prefix)

	client := newTestClient(t, config)
	roundTripTCP(t, client, target)

	wire := server.FirstWireBytes()
	require.GreaterOrEqual(t, len(wire), len(prefix))
	require.True(t, bytes.HasPrefix(wire, []byte(prefix)),
		"wire traffic %q does not start with prefix %q", wire, prefix)
}

type packetHandlerFunc func(p []byte, source netip.AddrPort) error

func (f packetHandlerFunc) HandlePacket(p []byte, source netip.AddrPort) error {
	return f(p, source)
}

// Net.Raw.Udp: a static ss:// key relays UDP datagrams both ways.
func TestUDPRoundTrip_StaticKey(t *testing.T) {
	server := startSSServer(t)
	target := startUDPEcho(t)

	client := newTestClient(t, "transport: "+ssURL(server))

	sender, receiver, err := client.NewAssociation()
	require.NoError(t, err)
	defer sender.Close()

	received := make(chan []byte, 8)
	go func() {
		receiver.ReceivePackets(packetHandlerFunc(func(p []byte, _ netip.AddrPort) error { //nolint:errcheck
			received <- append([]byte(nil), p...)
			return nil
		}))
	}()

	// UDP offers no delivery guarantee even on loopback; retry a few times.
	payload := []byte("udp ping through the Outline client")
	var echoed []byte
	for attempt := 0; attempt < 5 && echoed == nil; attempt++ {
		require.NoError(t, sender.SendPacket(payload, target))
		select {
		case echoed = <-received:
		case <-time.After(2 * time.Second):
		}
	}
	require.Equal(t, payload, echoed, "no echo received over UDP")
}

// Vpn.OnlineConfig.AddKey/Connect (transport half): a config fetched from a
// dynamic-key location tunnels TCP. Fetching itself is covered by
// fetch_test.go; this test covers the served-config-to-working-tunnel path.
func TestTCPRoundTrip_DynamicKeyConfig(t *testing.T) {
	server := startSSServer(t)
	target := startTCPEcho(t)

	configServer := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprintln(w, ssURL(server))
		}))
	t.Cleanup(configServer.Close)

	resp, err := http.Get(configServer.URL)
	require.NoError(t, err)
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	require.NoError(t, err)

	client := newTestClient(t, "transport: "+string(bytes.TrimSpace(body)))
	roundTripTCP(t, client, target)
}

func portOf(t *testing.T, hostPort string) string {
	t.Helper()
	addrPort, err := netip.ParseAddrPort(hostPort)
	require.NoError(t, err)
	return fmt.Sprintf("%d", addrPort.Port())
}
