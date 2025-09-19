// Copyright 2023 The Outline Authors
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

package connectivity

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"time"

	"github.com/Jigsaw-Code/outline-apps/client/go/outline/platerrors"
	"github.com/Jigsaw-Code/outline-sdk/transport"
)

// TODO: make these values configurable by exposing a struct with the connectivity methods.
const (
	tcpTimeout          = 10 * time.Second
	udpTimeout          = 2 * time.Second
	udpMaxRetryAttempts = 4
	bufferLength        = 512
)

const (
	testDNSServerIP   = "1.1.1.1"
	testDNSServerPort = 53
)

var testTCPURLs = []string{
	// We want a diversity of operators here for resilience.
	// We need to consider the use case of users tunneling into a censoring country where a provider may be blocked.
	// If all of these are down at the same time, the Internet is in serious trouble.
	"http://connectivitycheck.gstatic.com/generate_204",
	"http://cp.cloudflare.com/generate_204",
	"http://captive.apple.com/",
	"http://www.google.com/generate_204",
}

// CheckTCPAndUDPConnectivity checks whether the given `tcp` and `udp` clients can relay traffic.
//
// It parallelizes the execution of TCP and UDP checks, and returns a TCP error and a UDP error.
// A nil error indicates successful connectivity for the corresponding protocol.
//
// Deprecated: Use CheckTCPConnectivity and CheckUDPConnectivity instead.
func CheckTCPAndUDPConnectivity(
	tcp transport.StreamDialer, udp transport.PacketListener,
) (tcpErr error, udpErr error) {
	// Start asynchronous UDP support check.
	udpErrChan := make(chan error)
	go func() { udpErrChan <- CheckUDPConnectivity(udp) }()

	tcpErr = CheckTCPConnectivityWithHTTP(tcpTimeout, tcp, testTCPURLs)
	udpErr = <-udpErrChan
	return
}

// CheckTCPConnectivity checks whether the given StreamDialer can relay traffic.
func CheckTCPConnectivity(sd transport.StreamDialer) error {
	return CheckTCPConnectivityWithHTTP(tcpTimeout, sd, testTCPURLs)
}

// CheckUDPConnectivity checks whether the given PacketListener can relay traffic.
func CheckUDPConnectivity(pl transport.PacketListener) error {
	resolverAddr := &net.UDPAddr{IP: net.ParseIP(testDNSServerIP), Port: testDNSServerPort}
	return CheckUDPConnectivityWithDNS(pl, resolverAddr)
}

// CheckUDPConnectivityWithDNS determines whether the Outline proxy represented by `client` and
// the network support UDP traffic by issuing a DNS query though a resolver at `resolverAddr`.
// Returns nil on success or an error on failure.
func CheckUDPConnectivityWithDNS(client transport.PacketListener, resolverAddr net.Addr) error {
	conn, err := client.ListenPacket(context.Background())
	if err != nil {
		return platerrors.PlatformError{
			Code:    platerrors.ProxyServerUDPUnsupported,
			Message: "failed to listen for UDP packets",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	defer conn.Close()

	buf := make([]byte, bufferLength)
	for attempt := 0; attempt < udpMaxRetryAttempts; attempt++ {
		conn.SetDeadline(time.Now().Add(udpTimeout))
		_, err := conn.WriteTo(getDNSRequest(), resolverAddr)
		if err != nil {
			continue
		}
		n, addr, err := conn.ReadFrom(buf)
		if n == 0 && err != nil {
			continue
		}
		if addr.String() != resolverAddr.String() {
			continue // Ensure we got a response from the resolver.
		}
		return nil
	}

	return platerrors.PlatformError{
		Code:    platerrors.ProxyServerUDPUnsupported,
		Message: "UDP connectivity check timed out",
	}
}

func getDNSRequest() []byte {
	return []byte{
		0, 0, // [0-1]   query ID
		1, 0, // [2-3]   flags; byte[2] = 1 for recursion desired (RD).
		0, 1, // [4-5]   QDCOUNT (number of queries)
		0, 0, // [6-7]   ANCOUNT (number of answers)
		0, 0, // [8-9]   NSCOUNT (number of name server records)
		0, 0, // [10-11] ARCOUNT (number of additional records)
		3, 'c', 'o', 'm',
		0,    // null terminator of FQDN (root TLD)
		0, 1, // QTYPE, set to A
		0, 1, // QCLASS, set to 1 = IN (Internet)
	}
}

// CheckTCPConnectivityWithHTTP determines the stream dialer's connectivity by performing an HTTP HEAD request to
// the URLs in `urlList`, which must use the 'http' scheme.
// Returns nil on success, error on connectivity failure.
func CheckTCPConnectivityWithHTTP(timeout time.Duration, dialer transport.StreamDialer, urlList []string) error {
	if len(urlList) == 0 {
		return errors.New("test url list is empty")
	}
	if timeout == 0 {
		return context.DeadlineExceeded
	}

	deadline := time.Now().Add(timeout)
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()

	errCh := make(chan error, len(urlList))
	for i, targetURL := range urlList {
		go func() {
			// We pre-define the start time of the probes to make their timing independent of each other
			// and to randomize their order. This mitigates some fingerprinting attacks.
			// The first URL is always started immediately, and given at least 500ms of a head start.
			// The intent is to not trigger the fallback unless needed.
			// The other tests start at a random times, uniformly distributed within [500ms, timeout - 500ms]
			// (we want the last test to have at least 500ms to complete).
			if i > 0 {
				endMs := max(int(timeout/time.Millisecond)-500, 0)
				beginMs := min(endMs, 500)
				// We use math/rand here because there's no need for strong encryption.
				time.Sleep(time.Duration(beginMs+rand.Intn(endMs-beginMs+1)) * time.Millisecond)
			}
			errCh <- testTCPWithOneURL(ctx, dialer, targetURL)
		}()
	}
	var firstErr error
	pending := len(urlList)
	for pending > 0 {
		select {
		case <-ctx.Done():
			return context.Cause(ctx)
		case err := <-errCh:
			pending -= 1
			if err == nil {
				return nil
			}
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func testTCPWithOneURL(ctx context.Context, dialer transport.StreamDialer, targetURL string) error {
	if ctx.Err() != nil {
		return context.Cause(ctx)
	}
	req, err := http.NewRequestWithContext(ctx, "HEAD", targetURL, nil)
	if err != nil {
		return err
	}
	targetAddr := req.Host
	switch req.URL.Scheme {
	case "http":
		if !hasPort(targetAddr) {
			targetAddr = net.JoinHostPort(targetAddr, "80")
		}
	default:
		return fmt.Errorf("connectivity test currently only supports \"http\" URLs, found \"%v\"", req.URL.Scheme)
	}
	conn, err := dialer.DialStream(ctx, targetAddr)
	if err != nil {
		return platerrors.PlatformError{
			Code:    platerrors.ProxyServerUnreachable,
			Message: "failed to dial to the server",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		conn.SetDeadline(deadline)
	}
	err = req.Write(conn)
	if err != nil {
		return platerrors.PlatformError{
			Code:    platerrors.ProxyServerWriteFailed,
			Message: "failed to write HTTP HEAD to the server",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	n, err := conn.Read(make([]byte, bufferLength))
	if n == 0 && err != nil {
		return platerrors.PlatformError{
			Code:    platerrors.ProxyServerReadFailed,
			Message: "failed to read HTTP HEAD response from the server",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	return nil
}

func hasPort(hostPort string) bool {
	_, _, err := net.SplitHostPort(hostPort)
	return err == nil
}
