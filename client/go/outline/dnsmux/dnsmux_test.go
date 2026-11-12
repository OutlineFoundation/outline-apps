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

package dnsmux

import (
	"encoding/binary"
	"errors"
	"fmt"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/network/dnsintercept"
	"golang.getoutline.org/sdk/network/packetrelay"
)

var (
	resolver     = netip.MustParseAddrPort("1.1.1.1:53")
	fakeResolver = netip.MustParseAddrPort("169.254.113.53:53")
)

// fakeUpstream is a PacketRelay that records the associations opened on it. Each association
// echoes the queries it gets back as responses, unless it is silent.
type fakeUpstream struct {
	mu     sync.Mutex
	assocs []*fakeAssoc
	silent bool  // New associations do not answer.
	err    error // Returned by NewAssociation.
}

type fakeAssoc struct {
	mu      sync.Mutex
	silent  bool
	closed  bool
	sent    [][]byte
	handler packetrelay.PacketHandler
	ready   chan struct{}
	done    chan struct{}
}

func (u *fakeUpstream) NewAssociation() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.err != nil {
		return nil, nil, u.err
	}
	a := &fakeAssoc{silent: u.silent, ready: make(chan struct{}), done: make(chan struct{})}
	u.assocs = append(u.assocs, a)
	return a, a, nil
}

func (u *fakeUpstream) count() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.assocs)
}

func (u *fakeUpstream) assoc(i int) *fakeAssoc {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.assocs[i]
}

func (u *fakeUpstream) setSilent(silent bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.silent = silent
}

func (a *fakeAssoc) SendPacket(p []byte, dst netip.AddrPort) error {
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return packetrelay.ErrClosed
	}
	q := append([]byte(nil), p...)
	a.sent = append(a.sent, q)
	silent := a.silent
	a.mu.Unlock()
	if !silent {
		go a.respond(q, dst)
	}
	return nil
}

// respond delivers a response to query as if it came from source.
func (a *fakeAssoc) respond(query []byte, source netip.AddrPort) {
	select {
	case <-a.ready:
	case <-a.done:
		return
	}
	resp := append([]byte(nil), query...)
	resp[dnsFlagsByte] |= dnsResponseBit
	_ = a.handler.HandlePacket(resp, source)
}

func (a *fakeAssoc) sentCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.sent)
}

func (a *fakeAssoc) Close() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return packetrelay.ErrClosed
	}
	a.closed = true
	close(a.done)
	return nil
}

func (a *fakeAssoc) ReceivePackets(h packetrelay.PacketHandler) error {
	a.handler = h
	close(a.ready)
	<-a.done
	return packetrelay.ErrClosed
}

// collector is a PacketHandler that queues the packets it receives.
type collector chan []byte

func (c collector) HandlePacket(p []byte, _ netip.AddrPort) error {
	c <- append([]byte(nil), p...)
	return nil
}

func (c collector) next(t *testing.T, within time.Duration) []byte {
	t.Helper()
	select {
	case p := <-c:
		return p
	case <-time.After(within):
		require.FailNow(t, "no response", "waited %v", within)
		return nil
	}
}

func newQuery(id uint16, name string) []byte {
	q := make([]byte, dnsHeaderLen, dnsHeaderLen+len(name)+6)
	binary.BigEndian.PutUint16(q, id)
	q[2] = 0x01                          // RD
	binary.BigEndian.PutUint16(q[4:], 1) // QDCOUNT
	q = append(q, byte(len(name)))
	q = append(q, name...)
	return append(q, 0, 0, 1, 0, 1)
}

func isTruncated(p []byte) bool {
	return p[dnsFlagsByte]&dnsTruncatedBit != 0
}

// open opens an association on relay and starts receiving its responses.
func open(t *testing.T, relay packetrelay.PacketRelay) (packetrelay.PacketSender, collector) {
	t.Helper()
	s, r, err := relay.NewAssociation()
	require.NoError(t, err)
	c := make(collector, 16)
	go r.ReceivePackets(c)
	t.Cleanup(func() { s.Close() })
	return s, c
}

func TestNewRelayRequiresInner(t *testing.T) {
	_, err := NewRelay(nil, Config{})
	require.Error(t, err)
}

func TestManyQueriesShareOneUpstreamAssociation(t *testing.T) {
	up := &fakeUpstream{}
	relay, err := NewRelay(up, Config{})
	require.NoError(t, err)

	const n = 200
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, c := open(t, relay)
			// Every caller uses the same ID: the relay must still route each response correctly.
			query := newQuery(0x1234, fmt.Sprintf("host%d", i))
			require.NoError(t, s.SendPacket(query, resolver))
			resp := c.next(t, 2*time.Second)
			require.False(t, isTruncated(resp))
			require.Equal(t, query[:2], resp[:2], "the original ID must be restored")
			require.Equal(t, query[dnsHeaderLen:], resp[dnsHeaderLen:], "response for another query")
		}()
	}
	wg.Wait()

	require.Equal(t, 1, up.count(), "all queries must share one upstream association")
	require.Equal(t, n, up.assoc(0).sentCount())
}

func TestUpstreamIDsAreUniqueAmongInFlightQueries(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: time.Minute})
	require.NoError(t, err)

	const n = 500
	for i := range n {
		s, _ := open(t, relay)
		require.NoError(t, s.SendPacket(newQuery(7, fmt.Sprintf("host%d", i)), resolver))
	}
	seen := make(map[uint16]bool)
	a := up.assoc(0)
	a.mu.Lock()
	defer a.mu.Unlock()
	require.Len(t, a.sent, n)
	for _, p := range a.sent {
		id := binary.BigEndian.Uint16(p)
		require.False(t, seen[id], "ID %d reused while in flight", id)
		seen[id] = true
	}
}

func TestRetransmissionsDoNotOpenNewAssociations(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: time.Minute})
	require.NoError(t, err)

	s, _ := open(t, relay)
	query := newQuery(1, "example")
	for range 5 {
		require.NoError(t, s.SendPacket(query, resolver))
	}
	require.Equal(t, 1, up.count())
	require.Equal(t, 5, up.assoc(0).sentCount())
}

func TestSilentUpstreamFallsBackToTruncatedResponse(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: 50 * time.Millisecond, ProbeInterval: time.Minute})
	require.NoError(t, err)

	s, c := open(t, relay)
	query := newQuery(0xbeef, "example")
	start := time.Now()
	require.NoError(t, s.SendPacket(query, resolver))
	resp := c.next(t, 2*time.Second)
	require.GreaterOrEqual(t, time.Since(start), 50*time.Millisecond)
	require.True(t, isTruncated(resp), "must tell the client to retry over TCP")
	require.NotZero(t, resp[dnsFlagsByte]&dnsResponseBit)
	require.Equal(t, query[:2], resp[:2])
	require.Equal(t, query[dnsHeaderLen:], resp[dnsHeaderLen:])
	require.Equal(t, uint16(1), binary.BigEndian.Uint16(resp[6:8]), "ANCOUNT must equal QDCOUNT")

	// While the UDP path is not trusted, queries are answered at once and do not go upstream.
	s2, c2 := open(t, relay)
	start = time.Now()
	require.NoError(t, s2.SendPacket(newQuery(2, "other"), resolver))
	require.True(t, isTruncated(c2.next(t, 2*time.Second)))
	require.Less(t, time.Since(start), 40*time.Millisecond)
	require.Equal(t, 1, up.count())
	require.Equal(t, 1, up.assoc(0).sentCount())
}

func TestLostPacketDoesNotDisableUDP(t *testing.T) {
	up := &fakeUpstream{}
	relay, err := NewRelay(up, Config{FallbackAfter: 60 * time.Millisecond, ProbeInterval: time.Minute})
	require.NoError(t, err)

	// The first query opens the upstream association and is answered.
	s, c := open(t, relay)
	require.NoError(t, s.SendPacket(newQuery(1, "a"), resolver))
	require.False(t, isTruncated(c.next(t, 2*time.Second)))

	// The next query is lost...
	a := up.assoc(0)
	a.mu.Lock()
	a.silent = true
	a.mu.Unlock()
	sLost, cLost := open(t, relay)
	require.NoError(t, sLost.SendPacket(newQuery(2, "lost"), resolver))

	// ...but the upstream keeps answering other queries.
	a.mu.Lock()
	a.silent = false
	a.mu.Unlock()
	time.Sleep(5 * time.Millisecond)
	s2, c2 := open(t, relay)
	require.NoError(t, s2.SendPacket(newQuery(3, "b"), resolver))
	require.False(t, isTruncated(c2.next(t, 2*time.Second)))

	// The lost query still falls back to TCP, but later queries keep using UDP.
	require.True(t, isTruncated(cLost.next(t, 2*time.Second)))
	s3, c3 := open(t, relay)
	require.NoError(t, s3.SendPacket(newQuery(4, "c"), resolver))
	require.False(t, isTruncated(c3.next(t, 2*time.Second)))
	require.Equal(t, 1, up.count())
}

func TestProbeRestoresUDPWhenUpstreamRecovers(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: 30 * time.Millisecond, ProbeInterval: 100 * time.Millisecond})
	require.NoError(t, err)

	s, c := open(t, relay)
	require.NoError(t, s.SendPacket(newQuery(1, "a"), resolver))
	require.True(t, isTruncated(c.next(t, 2*time.Second)))

	// The path recovers, but only for new flows: the old association stays silent.
	up.setSilent(false)
	time.Sleep(120 * time.Millisecond)

	// The next query is a probe. It must go over a new association.
	s2, c2 := open(t, relay)
	require.NoError(t, s2.SendPacket(newQuery(2, "b"), resolver))
	require.False(t, isTruncated(c2.next(t, 2*time.Second)))
	require.Equal(t, 2, up.count())

	// UDP is trusted again: no more probing, no more new associations.
	for i := range 20 {
		s3, c3 := open(t, relay)
		require.NoError(t, s3.SendPacket(newQuery(uint16(i), "c"), resolver))
		require.False(t, isTruncated(c3.next(t, 2*time.Second)))
	}
	require.Equal(t, 2, up.count())
}

func TestProbesAreRateLimitedWhileUpstreamIsSilent(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: 10 * time.Millisecond, ProbeInterval: 150 * time.Millisecond})
	require.NoError(t, err)

	// A storm of queries for ~0.5s must open only a handful of upstream associations.
	deadline := time.Now().Add(500 * time.Millisecond)
	queries := 0
	for time.Now().Before(deadline) {
		s, c := open(t, relay)
		require.NoError(t, s.SendPacket(newQuery(uint16(queries), "x"), resolver))
		require.True(t, isTruncated(c.next(t, 2*time.Second)))
		queries++
	}
	require.Greater(t, queries, 20)
	require.LessOrEqual(t, up.count(), 5, "%d queries opened %d associations", queries, up.count())
}

func TestReopensUpstreamAfterItCloses(t *testing.T) {
	up := &fakeUpstream{}
	relay, err := NewRelay(up, Config{})
	require.NoError(t, err)

	s, c := open(t, relay)
	require.NoError(t, s.SendPacket(newQuery(1, "a"), resolver))
	require.False(t, isTruncated(c.next(t, 2*time.Second)))

	// The upstream association idles out.
	require.NoError(t, up.assoc(0).Close())

	s2, c2 := open(t, relay)
	require.NoError(t, s2.SendPacket(newQuery(2, "b"), resolver))
	require.False(t, isTruncated(c2.next(t, 2*time.Second)))
	require.Equal(t, 2, up.count())
}

func TestResetOpensNewUpstreamAndTrustsUDPAgain(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: 20 * time.Millisecond, ProbeInterval: time.Minute})
	require.NoError(t, err)

	s, c := open(t, relay)
	require.NoError(t, s.SendPacket(newQuery(1, "a"), resolver))
	require.True(t, isTruncated(c.next(t, 2*time.Second)))

	up.setSilent(false)
	relay.Reset() // The network changed.

	s2, c2 := open(t, relay)
	require.NoError(t, s2.SendPacket(newQuery(2, "b"), resolver))
	require.False(t, isTruncated(c2.next(t, 2*time.Second)))
	require.Equal(t, 2, up.count())
	a := up.assoc(0)
	a.mu.Lock()
	defer a.mu.Unlock()
	require.True(t, a.closed, "Reset must close the old upstream association")
}

func TestIgnoresResponsesThatMatchNoQuery(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: time.Minute})
	require.NoError(t, err)

	s, c := open(t, relay)
	query := newQuery(1, "a")
	require.NoError(t, s.SendPacket(query, resolver))
	a := up.assoc(0)
	a.mu.Lock()
	sent := a.sent[0]
	a.mu.Unlock()

	// Right ID, wrong source.
	a.respond(sent, netip.MustParseAddrPort("6.6.6.6:53"))
	// Unknown ID.
	unknown := append([]byte(nil), sent...)
	unknown[0] ^= 0xff
	a.respond(unknown, resolver)
	// Too short.
	require.NoError(t, a.handler.HandlePacket([]byte{1, 2, 3}, resolver))
	select {
	case p := <-c:
		require.FailNow(t, "unexpected response", "%x", p)
	case <-time.After(50 * time.Millisecond):
	}

	// The real response still gets through, exactly once.
	a.respond(sent, resolver)
	require.Equal(t, query[:2], c.next(t, 2*time.Second)[:2])
	a.respond(sent, resolver)
	select {
	case p := <-c:
		require.FailNow(t, "duplicate response", "%x", p)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestRejectsInvalidQuery(t *testing.T) {
	up := &fakeUpstream{}
	relay, err := NewRelay(up, Config{})
	require.NoError(t, err)
	s, _ := open(t, relay)
	require.Error(t, s.SendPacket([]byte{1, 2, 3}, resolver))
	require.Zero(t, up.count())
}

func TestUpstreamErrorIsReturned(t *testing.T) {
	up := &fakeUpstream{err: errors.New("no network")}
	relay, err := NewRelay(up, Config{})
	require.NoError(t, err)
	s, _ := open(t, relay)
	require.ErrorContains(t, s.SendPacket(newQuery(1, "a"), resolver), "no network")
	relay.mu.Lock()
	defer relay.mu.Unlock()
	require.Empty(t, relay.pending)
}

func TestAssociationExpiresAndReleasesItsQueries(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: time.Minute, QueryTimeout: 50 * time.Millisecond})
	require.NoError(t, err)

	s, r, err := relay.NewAssociation()
	require.NoError(t, err)
	require.NoError(t, s.SendPacket(newQuery(1, "a"), resolver))

	returned := make(chan error, 1)
	go func() { returned <- r.ReceivePackets(make(collector, 1)) }()
	select {
	case err := <-returned:
		require.ErrorIs(t, err, packetrelay.ErrClosed)
	case <-time.After(2 * time.Second):
		require.FailNow(t, "ReceivePackets did not return after the query timeout")
	}
	require.ErrorIs(t, s.SendPacket(newQuery(2, "b"), resolver), packetrelay.ErrClosed)
	require.ErrorIs(t, s.Close(), packetrelay.ErrClosed)
	relay.mu.Lock()
	defer relay.mu.Unlock()
	require.Empty(t, relay.pending)
}

func TestTooManyQueriesInFlight(t *testing.T) {
	up := &fakeUpstream{silent: true}
	relay, err := NewRelay(up, Config{FallbackAfter: time.Minute})
	require.NoError(t, err)
	s, _ := open(t, relay)
	for i := range maxPending {
		require.NoError(t, s.SendPacket(newQuery(uint16(i), "a"), resolver))
	}
	require.ErrorIs(t, s.SendPacket(newQuery(1, "a"), resolver), ErrTooManyQueries)
}

// This is the regression that motivated the package: behind the SDK's DNS interceptor, which
// opens one association per DNS packet, a burst of queries must not open a burst of upstream
// associations (each of which is a UDP flow to the proxy).
func TestBehindDNSInterceptorABurstOfQueriesUsesOneUpstreamAssociation(t *testing.T) {
	dnsUp := &fakeUpstream{}
	otherUp := &fakeUpstream{}
	mux, err := NewRelay(dnsUp, Config{})
	require.NoError(t, err)
	relay := dnsintercept.NewInterceptDNSPacketRelay(mux, otherUp, fakeResolver, resolver)

	const queries = 200
	var wg sync.WaitGroup
	for i := range queries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, c := open(t, relay)
			query := newQuery(0x4242, fmt.Sprintf("host%d", i))
			require.NoError(t, s.SendPacket(query, fakeResolver))
			resp := c.next(t, 2*time.Second)
			require.False(t, isTruncated(resp))
			require.Equal(t, query[:2], resp[:2])
			require.Equal(t, query[dnsHeaderLen:], resp[dnsHeaderLen:])
		}()
	}
	wg.Wait()

	require.Equal(t, 1, dnsUp.count(), "DNS must use a single UDP flow to the proxy")
	require.Equal(t, queries, dnsUp.assoc(0).sentCount())
	require.Zero(t, otherUp.count())
}
