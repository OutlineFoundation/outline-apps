package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/tcp.h"
*/
import "C"
import (
	"errors"
	"fmt"
	"unsafe"
)

// These exported callback functions must be placed in a seperated file.
//
// See also:
// https://github.com/golang/go/issues/20639
// https://golang.org/cmd/cgo/#hdr-C_references_to_Go

//export tcpAcceptFn
func tcpAcceptFn(arg unsafe.Pointer, newpcb *C.struct_tcp_pcb, err C.err_t) C.err_t {
	if err != C.ERR_OK {
		return err
	}

	if tcpConnHandler == nil {
		panic("must register a TCP connection handler")
	}

	if _, nerr := newTCPConn(newpcb, tcpConnHandler); nerr != nil {
		switch nerr.(*lwipError).Code {
		case LWIP_ERR_ABRT:
			return C.ERR_ABRT
		case LWIP_ERR_OK:
			return C.ERR_OK
		default:
			return C.ERR_CONN
		}
	}

	return C.ERR_OK
}

//export tcpRecvFn
func tcpRecvFn(arg unsafe.Pointer, tpcb *C.struct_tcp_pcb, p *C.struct_pbuf, err C.err_t) C.err_t {
	if err != C.ERR_OK && err != C.ERR_ABRT {
		return err
	}

	// Only free the pbuf when returning ERR_OK or ERR_ABRT,
	// otherwise must not free the pbuf.
	shouldFreePbuf := true
	defer func() {
		if p != nil && shouldFreePbuf {
			C.pbuf_free(p)
		}
	}()

	conn, ok := tcpConns.Load(getConnKeyVal(arg))
	if !ok {
		// The connection does not exists.
		C.tcp_abort(tpcb)
		return C.ERR_ABRT
	}

	if p == nil {
		// Peer closed, EOF.
		err := conn.(TCPConn).LocalClosed()
		switch err.(*lwipError).Code {
		case LWIP_ERR_ABRT:
			return C.ERR_ABRT
		case LWIP_ERR_OK:
			return C.ERR_OK
		default:
			panic("unexpected error")
		}
	}

	var buf []byte
	var totlen = int(p.tot_len)
	if p.tot_len == p.len {
		buf = (*[1 << 30]byte)(unsafe.Pointer(p.payload))[:totlen:totlen]
	} else {
		buf = NewBytes(totlen)
		defer FreeBytes(buf)
		C.pbuf_copy_partial(p, unsafe.Pointer(&buf[0]), p.tot_len, 0)
	}

	rerr := conn.(TCPConn).Receive(buf[:totlen])
	if rerr != nil {
		switch rerr.(*lwipError).Code {
		case LWIP_ERR_ABRT:
			return C.ERR_ABRT
		case LWIP_ERR_OK:
			return C.ERR_OK
		case LWIP_ERR_CONN:
			shouldFreePbuf = false
			// Tell lwip we can't receive data at the moment,
			// lwip will store it and try again later.
			return C.ERR_CONN
		case LWIP_ERR_CLSD:
			// lwip won't handle ERR_CLSD error for us, manually
			// shuts down the rx side.
			C.tcp_recved(tpcb, p.tot_len)
			C.tcp_shutdown(tpcb, 1, 0)
			return C.ERR_OK
		default:
			panic("unexpected error")
		}
	}

	return C.ERR_OK
}

//export tcpSentFn
func tcpSentFn(arg unsafe.Pointer, tpcb *C.struct_tcp_pcb, len C.u16_t) C.err_t {
	if conn, ok := tcpConns.Load(getConnKeyVal(arg)); ok {
		err := conn.(TCPConn).Sent(uint16(len))
		switch err.(*lwipError).Code {
		case LWIP_ERR_ABRT:
			return C.ERR_ABRT
		case LWIP_ERR_OK:
			return C.ERR_OK
		default:
			panic("unexpected error")
		}
	} else {
		C.tcp_abort(tpcb)
		return C.ERR_ABRT
	}
}

//export tcpErrFn
func tcpErrFn(arg unsafe.Pointer, err C.err_t) {
	if conn, ok := tcpConns.Load(getConnKeyVal(arg)); ok {
		switch err {
		case C.ERR_ABRT:
			// Aborted through tcp_abort or by a TCP timer
			conn.(TCPConn).Err(errors.New("connection aborted"))
		case C.ERR_RST:
			// The connection was reset by the remote host
			conn.(TCPConn).Err(errors.New("connection reseted"))
		default:
			conn.(TCPConn).Err(errors.New(fmt.Sprintf("lwip error code %v", int(err))))
		}
	}
}

//export tcpPollFn
func tcpPollFn(arg unsafe.Pointer, tpcb *C.struct_tcp_pcb) C.err_t {
	if conn, ok := tcpConns.Load(getConnKeyVal(arg)); ok {
		err := conn.(TCPConn).Poll()
		switch err.(*lwipError).Code {
		case LWIP_ERR_ABRT:
			return C.ERR_ABRT
		case LWIP_ERR_OK:
			return C.ERR_OK
		default:
			panic("unexpected error")
		}
	} else {
		C.tcp_abort(tpcb)
		return C.ERR_ABRT
	}
}
