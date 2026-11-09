package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/tcp.h"
#include "lwip/udp.h"
#include "lwip/timeouts.h"
*/
import "C"
import (
	"context"
	"errors"
	"sync"
	"time"
	"unsafe"
)

const CHECK_TIMEOUTS_INTERVAL = 250 // in millisecond
const TCP_POLL_INTERVAL = 8         // poll every 4 seconds

type LWIPStack interface {
	Write([]byte) (int, error)
	Close() error
	RestartTimeouts()
}

// lwIP runs in a single thread, locking is needed in Go runtime.
var lwipMutex = &sync.Mutex{}

type lwipStack struct {
	tpcb *C.struct_tcp_pcb
	upcb *C.struct_udp_pcb

	ctx    context.Context
	cancel context.CancelFunc
}

// NewLWIPStack listens for any incoming connections/packets and registers
// corresponding accept/recv callback functions.
func NewLWIPStack() LWIPStack {
	tcpPCB := C.tcp_new()
	if tcpPCB == nil {
		panic("tcp_new return nil")
	}

	err := C.tcp_bind(tcpPCB, C.IP_ADDR_ANY, 0)
	switch err {
	case C.ERR_OK:
		break
	case C.ERR_VAL:
		panic("invalid PCB state")
	case C.ERR_USE:
		panic("port in use")
	default:
		C.memp_free(C.MEMP_TCP_PCB, unsafe.Pointer(tcpPCB))
		panic("unknown tcp_bind return value")
	}

	tcpPCB = C.tcp_listen_with_backlog(tcpPCB, C.TCP_DEFAULT_LISTEN_BACKLOG)
	if tcpPCB == nil {
		panic("can not allocate tcp pcb")
	}

	setTCPAcceptCallback(tcpPCB)

	udpPCB := C.udp_new()
	if udpPCB == nil {
		panic("could not allocate udp pcb")
	}

	err = C.udp_bind(udpPCB, C.IP_ADDR_ANY, 0)
	if err != C.ERR_OK {
		panic("address already in use")
	}

	setUDPRecvCallback(udpPCB, nil)

	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		for {
			select {
			case <-time.After(CHECK_TIMEOUTS_INTERVAL * time.Millisecond):
				lwipMutex.Lock()
				C.sys_check_timeouts()
				lwipMutex.Unlock()
			case <-ctx.Done():
				return
			}
		}
	}()

	return &lwipStack{
		tpcb:   tcpPCB,
		upcb:   udpPCB,
		ctx:    ctx,
		cancel: cancel,
	}
}

// Write writes IP packets to the stack.
func (s *lwipStack) Write(data []byte) (int, error) {
	select {
	case <-s.ctx.Done():
		return 0, errors.New("stack closed")
	default:
		return input(data)
	}
}

// RestartTimeouts rebases the timeout times to the current time.
//
// This is necessary if sys_check_timeouts() hasn't been called for a long
// time (e.g. while saving energy) to prevent all timer functions of that
// period being called.
func (s *lwipStack) RestartTimeouts() {
	lwipMutex.Lock()
	C.sys_restart_timeouts()
	lwipMutex.Unlock()
}

// Close closes the stack.
//
// Timer events will be canceled and existing connections will be closed.
// Note this function will not free objects allocated in lwIP initialization
// stage, e.g. the loop interface.
func (s *lwipStack) Close() error {
	// Stop firing timer events.
	s.cancel()

	// Abort and close all TCP and UDP connections.
	tcpConns.Range(func(_, c interface{}) bool {
		c.(*tcpConn).Abort()
		return true
	})
	udpConns.Range(func(_, c interface{}) bool {
		// This only closes UDP connections in the core,
		// UDP connections in the handler will wait till
		// timeout, they are not closed immediately for
		// now.
		c.(*udpConn).Close()
		return true
	})

	// Remove callbacks and close listening pcbs.
	lwipMutex.Lock()
	C.tcp_accept(s.tpcb, nil)
	C.udp_recv(s.upcb, nil, nil)
	C.tcp_close(s.tpcb) // FIXME handle error
	C.udp_remove(s.upcb)
	lwipMutex.Unlock()

	return nil
}

func init() {
	// Initialize lwIP.
	//
	// There is a little trick here, a loop interface (127.0.0.1)
	// is created in the initialization stage due to the option
	// `#define LWIP_HAVE_LOOPIF 1` in `lwipopts.h`, so we need
	// not create our own interface.
	//
	// Now the loop interface is just the first element in
	// `C.netif_list`, i.e. `*C.netif_list`.
	lwipInit()

	// Set MTU.
	C.netif_list.mtu = 1500
}
