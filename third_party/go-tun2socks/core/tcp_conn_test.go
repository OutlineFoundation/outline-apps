package core

import (
	"encoding/binary"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// These tests cover the ownership of lwIP TCP pcbs by tcpConn. A pcb must be
// freed exactly once, and only lwIP may free it. The Go glue must therefore
// never call tcp_abort or tcp_close on a pcb after it has been handed back to
// lwIP, and must never keep a conn in tcpConns once lwIP may free its pcb
// without telling Go.
//
// Every connection here is set up with real packets through the stack, so
// lwIP's own state machine drives the pcb. lwipopts.h sets MEMP_MEM_MALLOC
// and MEM_LIBC_MALLOC, so pcbs come from the C allocator and a double free
// aborts the test binary on most platforms.

const (
	tcpFIN = 0x01
	tcpSYN = 0x02
	tcpRST = 0x04
	tcpPSH = 0x08
	tcpACK = 0x10

	// lwIP enum tcp_state (tcpbase.h) and TF_RXCLOSED (tcp.h). Test
	// files cannot use cgo, so the values are spelled out here.
	lwipCloseWait  = 7
	lwipTFRxClosed = 0x10
)

// captureTCPHandler hands every accepted conn to the test instead of dialing
// a proxy, so the test plays the role of the Outline relay.
type captureTCPHandler struct {
	conns chan *tcpConn
}

func (h *captureTCPHandler) Handle(conn net.Conn, target *net.TCPAddr) error {
	h.conns <- conn.(*tcpConn)
	return nil
}

// tcpTestStack bundles a fresh stack, the packets it emits and the conns it
// accepts.
type tcpTestStack struct {
	t     *testing.T
	stack LWIPStack
	out   chan []byte
	conns chan *tcpConn
}

func setupTCP(t *testing.T) *tcpTestStack {
	t.Helper()
	// Start from an empty connection table so tests cannot see each other.
	tcpConns = sync.Map{}

	ts := &tcpTestStack{
		t:     t,
		out:   make(chan []byte, 256),
		conns: make(chan *tcpConn, 8),
	}
	RegisterOutputFn(func(data []byte) (int, error) {
		pkt := make([]byte, len(data))
		copy(pkt, data)
		select {
		case ts.out <- pkt:
		default:
			t.Error("output channel full")
		}
		return len(data), nil
	})
	RegisterTCPConnHandler(&captureTCPHandler{conns: ts.conns})

	ts.stack = NewLWIPStack()
	t.Cleanup(func() { ts.stack.Close() })
	return ts
}

// tcpPeer is the test's model of the local app's socket: one side of a TCP
// connection through the stack.
type tcpPeer struct {
	ts        *tcpTestStack
	src, dst  net.IP
	sport     uint16
	dport     uint16
	seq       uint32 // Next sequence number the peer sends.
	serverSeq uint32 // Next sequence number expected from lwIP.
	conn      *tcpConn
}

// send writes one segment from the peer into the stack.
func (p *tcpPeer) send(flags byte, payload []byte) {
	p.ts.t.Helper()
	pkt := tcpPacket(p.src, p.dst, p.sport, p.dport, p.seq, p.serverSeq, flags, payload)
	if _, err := p.ts.stack.Write(pkt); err != nil {
		p.ts.t.Fatal(err)
	}
	p.seq += uint32(len(payload))
	if flags&(tcpSYN|tcpFIN) != 0 {
		p.seq++
	}
}

// nextPeerPort hands out a fresh source port for every connection. Ports
// must not be reused within a test binary: lwIP keeps pcbs in TIME_WAIT for
// 2*MSL after a handler-first close, and a SYN that matches such a pcb gets
// a RST instead of a SYN-ACK.
var nextPeerPort uint32 = 40000

// connect performs the three-way handshake on a new source port and waits
// for the handler to receive the conn and for the conn to become connected.
func (ts *tcpTestStack) connect() *tcpPeer {
	ts.t.Helper()
	sport := uint16(atomic.AddUint32(&nextPeerPort, 1))
	p := &tcpPeer{
		ts:    ts,
		src:   net.IPv4(10, 0, 0, 2),
		dst:   net.IPv4(93, 184, 216, 34),
		sport: sport,
		dport: 80,
		seq:   1000,
	}
	p.send(tcpSYN, nil)
	iss, _ := ts.waitForSegment(sport, tcpSYN|tcpACK)
	p.serverSeq = iss + 1
	p.send(tcpACK, nil)

	select {
	case p.conn = <-ts.conns:
	case <-time.After(5 * time.Second):
		ts.t.Fatal("handler was not called")
	}
	waitForState(ts.t, p.conn, tcpConnected)
	return p
}

// tcpPacket builds an IPv4 packet carrying one TCP segment. Checksums are left
// at zero because lwipopts.h compiles the checks out (CHECKSUM_CHECK_IP and
// CHECKSUM_CHECK_TCP are 0).
func tcpPacket(src, dst net.IP, sport, dport uint16, seq, ack uint32, flags byte, payload []byte) []byte {
	pkt := make([]byte, 20+20+len(payload))
	pkt[0] = 0x45 // IPv4, 20 byte header.
	binary.BigEndian.PutUint16(pkt[2:4], uint16(len(pkt)))
	pkt[6] = 0x40 // Don't fragment.
	pkt[8] = 64   // TTL.
	pkt[9] = 6    // TCP.
	copy(pkt[12:16], src.To4())
	copy(pkt[16:20], dst.To4())

	tcp := pkt[20:]
	binary.BigEndian.PutUint16(tcp[0:2], sport)
	binary.BigEndian.PutUint16(tcp[2:4], dport)
	binary.BigEndian.PutUint32(tcp[4:8], seq)
	binary.BigEndian.PutUint32(tcp[8:12], ack)
	tcp[12] = 5 << 4 // Data offset: 20 bytes, no options.
	tcp[13] = flags
	binary.BigEndian.PutUint16(tcp[14:16], 65535)
	copy(tcp[20:], payload)
	return pkt
}

// parseTCP returns the destination port, flags, sequence and acknowledgment
// numbers of an IPv4 TCP segment emitted by lwIP, or ok == false otherwise.
func parseTCP(pkt []byte) (dport uint16, flags byte, seq, ack uint32, ok bool) {
	if len(pkt) < 20 || pkt[0]>>4 != 4 || pkt[9] != 6 {
		return 0, 0, 0, 0, false
	}
	ihl := int(pkt[0]&0x0f) * 4
	if len(pkt) < ihl+20 {
		return 0, 0, 0, 0, false
	}
	tcp := pkt[ihl:]
	return binary.BigEndian.Uint16(tcp[2:4]), tcp[13],
		binary.BigEndian.Uint32(tcp[4:8]), binary.BigEndian.Uint32(tcp[8:12]), true
}

// waitForSegment drains the output until lwIP emits a segment to the given
// peer port with all of want's flags set, and returns its seq and ack.
func (ts *tcpTestStack) waitForSegment(peerPort uint16, want byte) (seq, ack uint32) {
	ts.t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case pkt := <-ts.out:
			dport, flags, seq, ack, ok := parseTCP(pkt)
			if ok && dport == peerPort && flags&want == want {
				return seq, ack
			}
		case <-deadline:
			ts.t.Fatalf("timed out waiting for TCP segment to port %d with flags %#x", peerPort, want)
		}
	}
}

func (conn *tcpConn) stateForTest() tcpConnState {
	conn.Lock()
	defer conn.Unlock()
	return conn.state
}

func (conn *tcpConn) pcbOwnedForTest() bool {
	conn.Lock()
	defer conn.Unlock()
	return conn.pcbOwned()
}

func waitForState(t *testing.T, conn *tcpConn, want tcpConnState) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if conn.stateForTest() == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("conn state is %d, want %d", conn.stateForTest(), want)
}

func tcpConnCount() int {
	n := 0
	tcpConns.Range(func(_, _ interface{}) bool {
		n++
		return true
	})
	return n
}

func assertReleased(t *testing.T, conn *tcpConn, when string) {
	t.Helper()
	if conn.pcbOwnedForTest() {
		t.Fatalf("conn still owns its pcb %s (state %d)", when, conn.stateForTest())
	}
	if got := tcpConnCount(); got != 0 {
		t.Fatalf("tcpConns has %d entries %s, want 0", got, when)
	}
}

// TestTCPSilentLastAckFreeReleasesConn reproduces the interleaving behind
// the Android "tcp_abort -> tcp_abandon -> tcp_free -> mem_free" crash with
// real lwIP state transitions:
//
//  1. The handler stops reading (as the Outline relay does when the proxy
//     side fails) while the local app is still sending.
//  2. The app's next data segment is refused with ERR_CLSD, which makes the
//     glue shut down the receive side and sets TF_RXCLOSED on the pcb.
//  3. The app sends FIN. lwIP moves to CLOSE_WAIT and tells Go, which moves
//     the conn to tcpReceiveClosed.
//  4. The handler calls CloseWrite. lwIP sends its FIN and enters LAST_ACK.
//  5. The app ACKs the FIN. lwIP frees the pcb. Because TF_RXCLOSED is set
//     it does not call the err callback, and because only a FIN was acked it
//     does not call the sent callback either, so Go hears nothing.
//
// Before the fix the conn stayed in tcpConns in state tcpClosing with a
// dangling pcb, and the next Abort() (for example from LWIPStack.Close on
// disconnect) called tcp_abort on freed memory. After the fix CloseWrite in
// step 4 hands the pcb back to lwIP immediately, so by step 5 Go no longer
// references it.
func TestTCPSilentLastAckFreeReleasesConn(t *testing.T) {
	ts := setupTCP(t)
	p := ts.connect()
	if got := tcpConnCount(); got != 1 {
		t.Fatalf("tcpConns has %d entries after accept, want 1", got)
	}

	// Step 1: the handler gives up on reading.
	if err := p.conn.CloseRead(); err != nil {
		t.Fatal(err)
	}

	// Step 2: data arrives for the closed reader.
	p.send(tcpACK|tcpPSH, []byte("hello"))

	// Step 3: the app closes its side.
	p.send(tcpACK|tcpFIN, nil)
	waitForState(t, p.conn, tcpReceiveClosed)

	// Check the preconditions of the bug on the live pcb: lwIP is in
	// CLOSE_WAIT and the receive side is marked closed.
	lwipMutex.Lock()
	pcbState := int(p.conn.pcb.state)
	rxClosed := p.conn.pcb.flags&lwipTFRxClosed != 0
	lwipMutex.Unlock()
	if pcbState != lwipCloseWait {
		t.Fatalf("lwIP pcb state is %d, want CLOSE_WAIT (%d)", pcbState, lwipCloseWait)
	}
	if !rxClosed {
		t.Fatal("TF_RXCLOSED is not set on the pcb; the test no longer exercises the silent-free path")
	}

	// Step 4: the handler is done writing. This must hand the pcb back to
	// lwIP: lwIP sends its FIN (or a RST if it has unread data) and Go
	// forgets the pcb.
	if err := p.conn.CloseWrite(); err != nil {
		t.Fatal(err)
	}
	assertReleased(t, p.conn, "after CloseWrite")
	ts.waitForSegment(p.sport, tcpFIN|tcpACK)

	// Step 5: the app ACKs our FIN. lwIP frees the pcb without a callback.
	p.serverSeq++
	p.send(tcpACK, nil)

	// The crash site: every disconnect aborts whatever is left in tcpConns.
	// With the conn released this is a no-op; with a dangling conn it is a
	// double free.
	if err := ts.stack.Close(); err != nil {
		t.Fatal(err)
	}
	p.conn.Abort()
}

// TestTCPAbortTwice checks that a second Abort does not touch the pcb that
// the first one already freed.
func TestTCPAbortTwice(t *testing.T) {
	ts := setupTCP(t)
	p := ts.connect()

	p.conn.Abort()
	ts.waitForSegment(p.sport, tcpRST)
	assertReleased(t, p.conn, "after Abort")

	p.conn.Abort()
	if err := p.conn.Close(); err != nil {
		t.Fatal(err)
	}
}

// TestTCPAbortAfterPeerReset checks that Abort is a no-op once lwIP has freed
// the pcb and reported it through the err callback (here: a RST from the
// local app; timer aborts take the same path).
func TestTCPAbortAfterPeerReset(t *testing.T) {
	ts := setupTCP(t)
	p := ts.connect()

	p.send(tcpRST|tcpACK, nil)
	waitForState(t, p.conn, tcpErrored)
	assertReleased(t, p.conn, "after RST")

	p.conn.Abort()
	// Receive on an errored conn must not abort the pcb either.
	if err := p.conn.receiveCheck(); err.(*lwipError).Code != LWIP_ERR_CLSD {
		t.Fatalf("receiveCheck on errored conn returned %v, want LWIP_ERR_CLSD", err)
	}
}

// TestTCPCloseWriteAfterPeerFINReleasesPcb checks the fix without the
// ERR_CLSD detour: once the app has sent FIN, the handler's CloseWrite must
// release the pcb right away instead of leaving the conn in tcpClosing.
func TestTCPCloseWriteAfterPeerFINReleasesPcb(t *testing.T) {
	ts := setupTCP(t)
	p := ts.connect()

	p.send(tcpACK|tcpFIN, nil)
	waitForState(t, p.conn, tcpReceiveClosed)

	if err := p.conn.CloseWrite(); err != nil {
		t.Fatal(err)
	}
	assertReleased(t, p.conn, "after CloseWrite")
	ts.waitForSegment(p.sport, tcpFIN|tcpACK)

	// The app ACKs our FIN; lwIP frees the pcb. Then a late Close or Abort
	// from the handler must not touch it.
	p.serverSeq++
	p.send(tcpACK, nil)
	if err := p.conn.Close(); err != nil {
		t.Fatal(err)
	}
	p.conn.Abort()
}

// TestTCPHandlerCloseWriteFirst covers the other close order: the handler
// finishes writing before the app does. lwIP goes through FIN_WAIT and
// TIME_WAIT, and Go must release the pcb when the app's FIN arrives.
func TestTCPHandlerCloseWriteFirst(t *testing.T) {
	ts := setupTCP(t)
	p := ts.connect()

	if err := p.conn.CloseWrite(); err != nil {
		t.Fatal(err)
	}
	if got := p.conn.stateForTest(); got != tcpWriteClosed {
		t.Fatalf("state after CloseWrite is %d, want tcpWriteClosed (%d)", got, tcpWriteClosed)
	}
	ts.waitForSegment(p.sport, tcpFIN|tcpACK)
	p.serverSeq++

	// The app ACKs our FIN and sends its own.
	p.send(tcpACK|tcpFIN, nil)
	waitForState(t, p.conn, tcpClosed)
	assertReleased(t, p.conn, "after peer FIN")
	p.conn.Abort()
}

// TestStackCloseWithMixedConns checks that LWIPStack.Close copes with a mix
// of live, reset and aborted connections, and releases all of them.
func TestStackCloseWithMixedConns(t *testing.T) {
	ts := setupTCP(t)
	live := ts.connect()
	reset := ts.connect()
	aborted := ts.connect()

	reset.send(tcpRST|tcpACK, nil)
	waitForState(t, reset.conn, tcpErrored)
	aborted.conn.Abort()

	if got := tcpConnCount(); got != 1 {
		t.Fatalf("tcpConns has %d entries before stack Close, want 1", got)
	}
	if err := ts.stack.Close(); err != nil {
		t.Fatal(err)
	}
	ts.waitForSegment(live.sport, tcpRST)
	for _, p := range []*tcpPeer{live, reset, aborted} {
		assertReleased(t, p.conn, "after stack Close")
		p.conn.Abort()
	}
}
