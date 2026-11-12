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

// Package dnsmux provides a [packetrelay.PacketRelay] that multiplexes many short-lived DNS
// query associations onto a single long-lived upstream association.
//
// # Why
//
// The DNS interceptor opens one association per intercepted DNS packet. When every association
// is backed by its own socket, each query (and each retransmission of it) becomes a brand-new UDP
// flow to the proxy. All of those flows share one destination (the proxy), and NAT gateways
// commonly cap or rate-limit new UDP flows per destination. A page load is enough to trip such a
// limit; from then on new flows are dropped, the OS retransmits, every retransmission opens yet
// another flow, and name resolution stays broken while the VPN still reports "connected".
//
// [Relay] keeps the association-per-query API but sends all queries over one upstream
// association, so DNS costs one UDP flow no matter how many queries are made.
//
// # How
//
//   - Queries are demultiplexed by DNS message ID. The relay rewrites the ID of every query to
//     one that is unique among the in-flight queries and restores the original ID on the response.
//   - If the upstream does not answer a query within [Config.FallbackAfter], the relay answers it
//     with a truncated response. That makes the OS retry the query over TCP, which does not depend
//     on the UDP path.
//   - When a query goes unanswered and the upstream has not answered anything else since it was
//     sent, the relay stops trusting the UDP path: queries are answered with a truncated response
//     immediately, except for one probe every [Config.ProbeInterval] that is sent over a fresh
//     upstream association. The first response re-enables UDP.
package dnsmux

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"net/netip"
	"sync"
	"time"

	"golang.getoutline.org/sdk/network/packetrelay"
)

const (
	dnsHeaderLen = 12
	// maxPending bounds the number of in-flight queries, and therefore memory use.
	maxPending = 2048

	dnsFlagsByte    = 2           // The header byte with the QR and TC bits.
	dnsResponseBit  = uint8(0x80) // QR
	dnsTruncatedBit = uint8(0x02) // TC
	dnsRCodeByte    = 3
	dnsRCodeMask    = uint8(0x0f)
)

// ErrTooManyQueries is returned by SendPacket when too many queries are in flight.
var ErrTooManyQueries = errors.New("too many DNS queries in flight")

// Config configures a [Relay]. Zero values select the defaults.
type Config struct {
	// FallbackAfter is how long to wait for the upstream to answer a query before answering it
	// with a truncated response. Defaults to 1500ms.
	FallbackAfter time.Duration
	// QueryTimeout is the lifetime of a query association. Defaults to 5s.
	QueryTimeout time.Duration
	// ProbeInterval is the minimum time between two queries sent upstream while the UDP path is
	// not trusted. It also bounds how often a new upstream association is opened. Defaults to 3s.
	ProbeInterval time.Duration
}

func (c Config) withDefaults() Config {
	if c.FallbackAfter <= 0 {
		c.FallbackAfter = 1500 * time.Millisecond
	}
	if c.QueryTimeout <= 0 {
		c.QueryTimeout = 5 * time.Second
	}
	if c.ProbeInterval <= 0 {
		c.ProbeInterval = 3 * time.Second
	}
	return c
}

// Relay is a [packetrelay.PacketRelay] for DNS queries. See the package documentation.
//
// Multiple goroutines can simultaneously invoke methods on a Relay.
type Relay struct {
	inner packetrelay.PacketRelay
	cfg   Config

	mu           sync.Mutex
	up           *upstream
	pending      map[uint16]*query
	degraded     bool      // Whether the UDP path is not trusted.
	lastProbe    time.Time // When the last query was sent upstream while degraded.
	lastResponse time.Time // When the upstream last answered a query.
}

var _ packetrelay.PacketRelay = (*Relay)(nil)

// upstream is the shared association that carries the queries.
type upstream struct {
	sender packetrelay.PacketSender
}

// query is an in-flight query.
type query struct {
	assoc   *association
	id      uint16 // The ID we sent upstream.
	origID  [2]byte
	dst     netip.AddrPort
	payload []byte // A copy of the original query, used to build the truncated response.
	sentAt  time.Time
	timer   *time.Timer // Fires the fallback.
}

// NewRelay creates a [Relay] that sends queries over associations of inner.
//
// The associations of inner should be long-lived: inner should not close them shortly after
// each packet.
func NewRelay(inner packetrelay.PacketRelay, cfg Config) (*Relay, error) {
	if inner == nil {
		return nil, errors.New("inner relay must not be nil")
	}
	return &Relay{inner: inner, cfg: cfg.withDefaults(), pending: make(map[uint16]*query)}, nil
}

// NewAssociation implements [packetrelay.PacketRelay]. The returned association is virtual:
// it does not open a socket. It closes itself after [Config.QueryTimeout].
func (r *Relay) NewAssociation() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
	a := &association{
		relay:     r,
		responses: make(chan response, 4),
		done:      make(chan struct{}),
	}
	a.mu.Lock()
	a.expiry = time.AfterFunc(r.cfg.QueryTimeout, func() { _ = a.Close() })
	a.mu.Unlock()
	return a, a, nil
}

// Reset drops the upstream association and trusts the UDP path again. Call it when the
// underlying network changes: the next query will go over a new upstream association.
func (r *Relay) Reset() {
	r.mu.Lock()
	up := r.up
	r.up = nil
	r.degraded = false
	r.mu.Unlock()
	if up != nil {
		_ = up.sender.Close()
	}
}

// send forwards the query p from a to dst, or answers it with a truncated response.
func (r *Relay) send(a *association, p []byte, dst netip.AddrPort) error {
	if len(p) < dnsHeaderLen {
		return errors.New("invalid DNS message: too short")
	}

	r.mu.Lock()
	if r.degraded {
		if time.Since(r.lastProbe) < r.cfg.ProbeInterval {
			r.mu.Unlock()
			a.deliver(truncatedResponse(p), dst)
			return nil
		}
		// This query probes the UDP path, over a new association in case the old one is stuck.
		r.lastProbe = time.Now()
		if up := r.up; up != nil {
			r.up = nil
			defer up.sender.Close()
		}
	}
	if len(r.pending) >= maxPending {
		r.mu.Unlock()
		return ErrTooManyQueries
	}
	up, err := r.upstreamLocked()
	if err != nil {
		r.mu.Unlock()
		return err
	}
	q := &query{assoc: a, id: r.newIDLocked(), dst: dst, payload: append([]byte(nil), p...), sentAt: time.Now()}
	copy(q.origID[:], p[:2])
	r.pending[q.id] = q
	q.timer = time.AfterFunc(r.cfg.FallbackAfter, func() { r.fallback(q) })
	r.mu.Unlock()

	out := append([]byte(nil), p...)
	binary.BigEndian.PutUint16(out, q.id)
	err = up.sender.SendPacket(out, dst)
	if err != nil {
		// The upstream association is gone (for example, it idled out). Retry once over a new one.
		r.dropUpstream(up)
		r.mu.Lock()
		up, err = r.upstreamLocked()
		r.mu.Unlock()
		if err == nil {
			if err = up.sender.SendPacket(out, dst); err != nil {
				r.dropUpstream(up)
			}
		}
	}
	if err != nil {
		r.remove(q)
	}
	return err
}

// upstreamLocked returns the upstream association, creating it if needed.
func (r *Relay) upstreamLocked() (*upstream, error) {
	if r.up != nil {
		return r.up, nil
	}
	sender, receiver, err := r.inner.NewAssociation()
	if err != nil {
		return nil, err
	}
	up := &upstream{sender: sender}
	r.up = up
	go func() {
		_ = receiver.ReceivePackets(upstreamHandler{r})
		r.dropUpstream(up)
	}()
	return up, nil
}

func (r *Relay) dropUpstream(up *upstream) {
	r.mu.Lock()
	if r.up == up {
		r.up = nil
	}
	r.mu.Unlock()
	_ = up.sender.Close()
}

// newIDLocked returns a random ID that no in-flight query is using.
func (r *Relay) newIDLocked() uint16 {
	var b [2]byte
	for {
		_, _ = rand.Read(b[:])
		id := binary.BigEndian.Uint16(b[:])
		if _, used := r.pending[id]; !used {
			return id
		}
	}
}

// remove forgets q. It returns false if q was already answered or removed.
func (r *Relay) remove(q *query) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pending[q.id] != q {
		return false
	}
	delete(r.pending, q.id)
	q.timer.Stop()
	return true
}

// removeAll forgets the queries of a.
func (r *Relay) removeAll(a *association) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, q := range r.pending {
		if q.assoc == a {
			delete(r.pending, id)
			q.timer.Stop()
		}
	}
}

// fallback answers q with a truncated response, because the upstream did not answer in time.
func (r *Relay) fallback(q *query) {
	r.mu.Lock()
	if r.pending[q.id] != q {
		r.mu.Unlock()
		return
	}
	delete(r.pending, q.id)
	// A lost packet is not a broken path: only stop trusting UDP if the upstream has not
	// answered anything since this query was sent.
	if !r.degraded && !r.lastResponse.After(q.sentAt) {
		r.degraded = true
		r.lastProbe = time.Now()
	}
	r.mu.Unlock()
	q.assoc.deliver(truncatedResponse(q.payload), q.dst)
}

type upstreamHandler struct{ r *Relay }

// HandlePacket routes a response from the upstream to the association that sent the query.
func (h upstreamHandler) HandlePacket(p []byte, source netip.AddrPort) error {
	if len(p) < dnsHeaderLen {
		return nil
	}
	r := h.r
	id := binary.BigEndian.Uint16(p)
	r.mu.Lock()
	q := r.pending[id]
	if q == nil || !sameAddrPort(q.dst, source) {
		// Late, duplicate or unsolicited response.
		r.mu.Unlock()
		return nil
	}
	delete(r.pending, id)
	q.timer.Stop()
	r.degraded = false
	r.lastResponse = time.Now()
	r.mu.Unlock()

	resp := append([]byte(nil), p...)
	copy(resp[:2], q.origID[:])
	q.assoc.deliver(resp, source)
	return nil
}

func sameAddrPort(a, b netip.AddrPort) bool {
	return a.Addr().Unmap() == b.Addr().Unmap() && a.Port() == b.Port()
}

// truncatedResponse returns a response to query with the TC (truncated) bit set, which tells
// the DNS client to retry over TCP. It mirrors the SDK's dnstruncate package.
func truncatedResponse(query []byte) []byte {
	resp := append([]byte(nil), query...)
	resp[dnsFlagsByte] |= dnsResponseBit | dnsTruncatedBit
	resp[dnsRCodeByte] &^= dnsRCodeMask
	// Set ANCOUNT to QDCOUNT. This is technically incorrect, since the response has no answer.
	// However, without it some DNS clients do not retry over TCP.
	copy(resp[6:8], resp[4:6])
	return resp
}

type response struct {
	payload []byte
	source  netip.AddrPort
}

// association is a virtual association for the queries of one caller.
type association struct {
	relay     *Relay
	responses chan response
	done      chan struct{}
	closeOnce sync.Once

	mu     sync.Mutex
	expiry *time.Timer // Closes the association after the query timeout.
}

var _ packetrelay.PacketSender = (*association)(nil)
var _ packetrelay.PacketReceiver = (*association)(nil)

// SendPacket implements [packetrelay.PacketSender].
func (a *association) SendPacket(p []byte, destination netip.AddrPort) error {
	select {
	case <-a.done:
		return packetrelay.ErrClosed
	default:
	}
	return a.relay.send(a, p, destination)
}

// Close implements [packetrelay.PacketSender]. It makes ReceivePackets return.
func (a *association) Close() error {
	err := packetrelay.ErrClosed
	a.closeOnce.Do(func() {
		close(a.done)
		a.mu.Lock()
		a.expiry.Stop()
		a.mu.Unlock()
		a.relay.removeAll(a)
		err = nil
	})
	return err
}

// ReceivePackets implements [packetrelay.PacketReceiver].
func (a *association) ReceivePackets(handler packetrelay.PacketHandler) error {
	for {
		select {
		case resp := <-a.responses:
			if err := handler.HandlePacket(resp.payload, resp.source); err != nil {
				return err
			}
		case <-a.done:
			return packetrelay.ErrClosed
		}
	}
}

// deliver queues a response for ReceivePackets. It drops the response if the association is
// closed or the caller is not keeping up.
func (a *association) deliver(payload []byte, source netip.AddrPort) {
	select {
	case <-a.done:
	case a.responses <- response{payload, source}:
	default:
	}
}
