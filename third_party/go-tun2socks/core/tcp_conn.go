package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/tcp.h"
*/
import "C"
import (
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net"
	"sync"
	"time"
	"unsafe"
)

type tcpConnState uint

const (
	// tcpNewConn is the initial state.
	tcpNewConn tcpConnState = iota

	// tcpConnecting indicates the handler is still connecting remote host.
	tcpConnecting

	// tcpConnected indicates the connection has been established, handler
	// may write data to TUN, and read data from TUN.
	tcpConnected

	// tcpWriteClosed indicates the handler has closed the writing side
	// of the connection, no more data will send to TUN, but handler can still
	// read data from TUN.
	tcpWriteClosed

	// tcpReceiveClosed indicates lwIP has received a FIN segment from
	// local peer, the reading side is closed, no more data can be read
	// from TUN, but handler can still write data to TUN.
	tcpReceiveClosed

	// tcpClosing indicates both reading side and writing side are closed,
	// resources deallocation will be triggered at any time in lwIP callbacks.
	tcpClosing

	// tcpAborting indicates the connection is aborting, resources deallocation
	// will be triggered at any time in lwIP callbacks.
	tcpAborting

	// tcpClosed indicates the connection has been closed, resources were freed.
	tcpClosed

	// tcpErrord indicates an fatal error occured on the connection, resources
	// were freed.
	tcpErrored
)

type tcpConn struct {
	sync.Mutex

	pcb           *C.struct_tcp_pcb
	handler       TCPConnHandler
	remoteAddr    *net.TCPAddr
	localAddr     *net.TCPAddr
	connKeyArg    unsafe.Pointer
	connKey       uint32
	canWrite      *sync.Cond // Condition variable to implement TCP backpressure.
	state         tcpConnState
	sndPipeReader *io.PipeReader
	sndPipeWriter *io.PipeWriter
	closeOnce     sync.Once
	closeErr      error
}

func newTCPConn(pcb *C.struct_tcp_pcb, handler TCPConnHandler) (TCPConn, error) {
	connKeyArg := newConnKeyArg()
	connKey := rand.Uint32()
	setConnKeyVal(unsafe.Pointer(connKeyArg), connKey)

	// Pass the key as arg for subsequent tcp callbacks.
	C.tcp_arg(pcb, unsafe.Pointer(connKeyArg))

	// Register callbacks.
	setTCPRecvCallback(pcb)
	setTCPSentCallback(pcb)
	setTCPErrCallback(pcb)
	setTCPPollCallback(pcb, C.u8_t(TCP_POLL_INTERVAL))

	pipeReader, pipeWriter := io.Pipe()
	conn := &tcpConn{
		pcb:           pcb,
		handler:       handler,
		localAddr:     ParseTCPAddr(ipAddrNTOA(pcb.remote_ip), uint16(pcb.remote_port)),
		remoteAddr:    ParseTCPAddr(ipAddrNTOA(pcb.local_ip), uint16(pcb.local_port)),
		connKeyArg:    connKeyArg,
		connKey:       connKey,
		canWrite:      sync.NewCond(&sync.Mutex{}),
		state:         tcpNewConn,
		sndPipeReader: pipeReader,
		sndPipeWriter: pipeWriter,
	}

	// Associate conn with key and save to the global map.
	tcpConns.Store(connKey, conn)

	// Connecting remote host could take some time, do it in another goroutine
	// to prevent blocking the lwip thread.
	conn.Lock()
	conn.state = tcpConnecting
	conn.Unlock()
	go func() {
		err := handler.Handle(TCPConn(conn), conn.remoteAddr)
		if err != nil {
			conn.Abort()
			return
		}

		// Take lwipMutex before inspecting the state: lwIP (which runs under
		// lwipMutex) may close or free the pcb at any time, and once that has
		// happened the conn is no longer in tcpConnecting. Checking the state
		// and then touching pcb without holding lwipMutex throughout would
		// let lwIP free the pcb between the two steps.
		lwipMutex.Lock()
		defer lwipMutex.Unlock()

		conn.Lock()
		if conn.state != tcpConnecting {
			conn.Unlock()
			return
		}
		conn.state = tcpConnected
		conn.Unlock()

		// Still tcpConnecting under lwipMutex means Go still owns the pcb.
		if pcb.refused_data != nil {
			C.tcp_process_refused_data(pcb)
		}
	}()

	return conn, NewLWIPError(LWIP_ERR_OK)
}

func (conn *tcpConn) RemoteAddr() net.Addr {
	return conn.remoteAddr
}

func (conn *tcpConn) LocalAddr() net.Addr {
	return conn.localAddr
}

func (conn *tcpConn) SetDeadline(t time.Time) error {
	return nil
}
func (conn *tcpConn) SetReadDeadline(t time.Time) error {
	return nil
}
func (conn *tcpConn) SetWriteDeadline(t time.Time) error {
	return nil
}

func (conn *tcpConn) receiveCheck() error {
	conn.Lock()
	defer conn.Unlock()

	switch conn.state {
	case tcpConnected:
		fallthrough
	case tcpWriteClosed:
		return nil
	case tcpNewConn:
		fallthrough
	case tcpConnecting:
		return NewLWIPError(LWIP_ERR_CONN)
	case tcpAborting:
		fallthrough
	case tcpClosed:
		fallthrough
	case tcpReceiveClosed:
		fallthrough
	case tcpClosing:
		fallthrough
	case tcpErrored:
		// tcpErrored means lwIP already freed the pcb (see Err), so the
		// pcb must not be aborted again. Report the connection as closed
		// instead; the caller only ever touches the pcb lwIP handed it.
		return NewLWIPError(LWIP_ERR_CLSD)
	default:
		panic("unexpected error")
	}
	return nil
}

func (conn *tcpConn) Receive(data []byte) error {
	if err := conn.receiveCheck(); err != nil {
		return err
	}
	n, err := conn.sndPipeWriter.Write(data)
	if err != nil {
		return NewLWIPError(LWIP_ERR_CLSD)
	}
	C.tcp_recved(conn.pcb, C.u16_t(n))
	return NewLWIPError(LWIP_ERR_OK)
}

func (conn *tcpConn) Read(data []byte) (int, error) {
	conn.Lock()
	if conn.state == tcpReceiveClosed {
		conn.Unlock()
		return 0, io.EOF
	}
	if conn.state >= tcpClosing {
		conn.Unlock()
		return 0, io.ErrClosedPipe
	}
	conn.Unlock()

	// Handler should get EOF.
	n, err := conn.sndPipeReader.Read(data)
	if err == io.ErrClosedPipe {
		err = io.EOF
	}
	return n, err
}

// writeInternal enqueues data to snd_buf, and treats ERR_MEM returned by tcp_write not an error,
// but instead tells the caller that data is not successfully enqueued, and should try
// again another time. By calling this function, the lwIP thread is assumed to be already
// locked by the caller.
func (conn *tcpConn) writeInternal(data []byte) (int, error) {
	err := C.tcp_write(conn.pcb, unsafe.Pointer(&data[0]), C.u16_t(len(data)), C.TCP_WRITE_FLAG_COPY)
	if err == C.ERR_OK {
		C.tcp_output(conn.pcb)
		return len(data), nil
	} else if err == C.ERR_MEM {
		return 0, nil
	}
	return 0, fmt.Errorf("tcp_write failed (%v)", int(err))
}

func (conn *tcpConn) writeCheck() error {
	conn.Lock()
	defer conn.Unlock()

	switch conn.state {
	case tcpConnecting:
		fallthrough
	case tcpConnected:
		fallthrough
	case tcpReceiveClosed:
		return nil
	case tcpWriteClosed:
		fallthrough
	case tcpClosing:
		fallthrough
	case tcpClosed:
		fallthrough
	case tcpErrored:
		fallthrough
	case tcpAborting:
		return io.ErrClosedPipe
	default:
		panic("unexpected error")
	}
	return nil
}

func (conn *tcpConn) Write(data []byte) (int, error) {
	totalWritten := 0

	conn.canWrite.L.Lock()
	defer conn.canWrite.L.Unlock()

	for len(data) > 0 {
		if err := conn.writeCheck(); err != nil {
			return totalWritten, err
		}

		lwipMutex.Lock()
		toWrite := len(data)
		if toWrite > int(conn.pcb.snd_buf) {
			// Write at most the size of the LWIP buffer.
			toWrite = int(conn.pcb.snd_buf)
		}
		if toWrite > 0 {
			written, err := conn.writeInternal(data[0:toWrite])
			totalWritten += written
			if err != nil {
				lwipMutex.Unlock()
				return totalWritten, err
			}
			data = data[written:len(data)]
		}
		lwipMutex.Unlock()
		if len(data) == 0 {
			break // Don't block if all the data has been written.
		}
		conn.canWrite.Wait()
	}

	return totalWritten, nil
}

func (conn *tcpConn) CloseWrite() error {
	// Lock order is lwipMutex, then conn.Mutex: lwIP callbacks run with
	// lwipMutex held and lock the conn inside. Taking lwipMutex first here
	// keeps the state check and the pcb call atomic with respect to lwIP.
	lwipMutex.Lock()
	defer lwipMutex.Unlock()

	conn.Lock()
	defer conn.Unlock()

	if conn.state >= tcpClosing || conn.state == tcpWriteClosed {
		return nil
	}

	if conn.state == tcpReceiveClosed {
		// lwIP already delivered the peer's FIN (the pcb is in CLOSE_WAIT)
		// and the handler is now done writing, so both directions are
		// finished. Hand the pcb back to lwIP right now with a full close.
		//
		// The previous code only sent a FIN here (tcp_shutdown tx) and left
		// the conn in tcpClosing, relying on a later sent/poll callback to
		// run closeInternal. lwIP does not guarantee such a callback: when
		// the peer ACKs our FIN in LAST_ACK, lwIP frees the pcb and, if the
		// receive side was already shut down with TF_RXCLOSED (which the
		// ERR_CLSD path in tcpRecvFn does), it skips the err callback as
		// well. The conn then stayed in tcpConns pointing at freed memory
		// and the next Abort() (e.g. from lwipStack.Close) double freed it.
		conn.state = tcpClosing
		return conn.closeInternal()
	}

	conn.state = tcpWriteClosed
	// FIXME Handle tcp_shutdown error.
	C.tcp_shutdown(conn.pcb, 0, 1)
	return nil
}

func (conn *tcpConn) CloseRead() error {
	return conn.sndPipeReader.Close()
}

func (conn *tcpConn) Sent(len uint16) error {
	// Some packets are acknowledged by local client, check if any pending data to send.
	return conn.checkState()
}

func (conn *tcpConn) checkClosing() error {
	conn.Lock()
	defer conn.Unlock()

	if conn.state == tcpClosing {
		conn.closeInternal()
		return NewLWIPError(LWIP_ERR_OK)
	}
	return nil
}

func (conn *tcpConn) checkAborting() error {
	conn.Lock()
	defer conn.Unlock()

	if conn.state == tcpAborting {
		conn.abortInternal()
		return NewLWIPError(LWIP_ERR_ABRT)
	}
	return nil
}

func (conn *tcpConn) isClosed() bool {
	conn.Lock()
	defer conn.Unlock()

	return conn.state == tcpClosed
}

func (conn *tcpConn) checkState() error {
	if conn.isClosed() {
		return nil
	}

	err := conn.checkClosing()
	if err != nil {
		return err
	}

	err = conn.checkAborting()
	if err != nil {
		return err
	}

	// Signal the writer to try writting.
	conn.canWrite.Broadcast()

	return NewLWIPError(LWIP_ERR_OK)
}

func (conn *tcpConn) Close() error {
	conn.closeOnce.Do(conn.close)
	return conn.closeErr
}

func (conn *tcpConn) close() {
	err := conn.CloseRead()
	if err != nil {
		conn.closeErr = err
	}
	err = conn.CloseWrite()
	if err != nil {
		conn.closeErr = err
	}
}

func (conn *tcpConn) setLocalClosed() error {
	conn.Lock()
	defer conn.Unlock()

	if conn.state >= tcpClosing || conn.state == tcpReceiveClosed {
		return nil
	}

	// Causes the read half of the pipe returns.
	conn.sndPipeWriter.Close()

	if conn.state == tcpWriteClosed {
		conn.state = tcpClosing
	} else {
		conn.state = tcpReceiveClosed
	}
	conn.canWrite.Broadcast()
	return nil
}

// pcbOwned reports whether Go still owns conn.pcb. The caller must hold
// conn.Mutex. release() is the single place that gives the pcb up: it moves
// the state to tcpClosed (Err then moves it on to tcpErrored), so any state
// at or past tcpClosed means lwIP has the pcb and may already have freed it.
func (conn *tcpConn) pcbOwned() bool {
	return conn.state < tcpClosed
}

// Never call this function outside of the lwIP thread. The caller must hold
// conn.Mutex.
func (conn *tcpConn) closeInternal() error {
	if !conn.pcbOwned() {
		// The pcb was already handed back to lwIP; touching it again would
		// be a use after free.
		return nil
	}

	C.tcp_arg(conn.pcb, nil)
	C.tcp_recv(conn.pcb, nil)
	C.tcp_sent(conn.pcb, nil)
	C.tcp_err(conn.pcb, nil)
	C.tcp_poll(conn.pcb, nil, 0)

	conn.release()

	// FIXME Handle error.
	err := C.tcp_close(conn.pcb)
	if err == C.ERR_OK {
		return nil
	} else {
		return errors.New(fmt.Sprintf("close TCP connection failed, lwip error code %d", int(err)))
	}
}

// Never call this function outside of the lwIP thread since it calls
// tcp_abort() and in that case we must return ERR_ABRT to lwIP. The caller
// must hold conn.Mutex.
func (conn *tcpConn) abortInternal() {
	if !conn.pcbOwned() {
		// Already closed, aborted or errored: lwIP owns (and has probably
		// freed) the pcb. Aborting it again is the double free behind the
		// tcp_abort -> tcp_abandon -> tcp_free -> mem_free crash.
		return
	}
	conn.release()
	C.tcp_abort(conn.pcb)
}

func (conn *tcpConn) Abort() {
	lwipMutex.Lock()
	defer lwipMutex.Unlock()
	conn.abortLocked()
}

// abortLocked aborts the connection. The caller must hold lwipMutex, which
// keeps lwIP from closing or freeing the pcb between the state change and
// the tcp_abort call in checkState.
func (conn *tcpConn) abortLocked() {
	conn.Lock()
	// Only move to tcpAborting from live states. tcpClosed and tcpErrored
	// mean the pcb was already handed back to lwIP (see pcbOwned), and
	// checkState is a no-op for them.
	if conn.state < tcpAborting {
		conn.state = tcpAborting
	}
	conn.Unlock()

	conn.checkState()
}

func (conn *tcpConn) Err(err error) {
	conn.Lock()
	defer conn.Unlock()

	conn.release()
	conn.state = tcpErrored
	conn.canWrite.Broadcast()
}

func (conn *tcpConn) LocalClosed() error {
	conn.setLocalClosed()
	return conn.checkState()
}

// release hands the pcb back to lwIP from Go's point of view: it removes the
// conn from tcpConns so no lwIP callback can reach it any more, wakes up any
// reader or writer, and marks the state tcpClosed. Every path that gives the
// pcb to lwIP for freeing (closeInternal, abortInternal, Err) goes through
// here, which makes the state the single source of truth for pcb ownership.
// The caller must hold conn.Mutex.
func (conn *tcpConn) release() {
	if _, found := tcpConns.Load(conn.connKey); found {
		freeConnKeyArg(conn.connKeyArg)
		tcpConns.Delete(conn.connKey)
	}
	conn.sndPipeWriter.Close()
	conn.sndPipeReader.Close()
	conn.state = tcpClosed
}

func (conn *tcpConn) Poll() error {
	return conn.checkState()
}
