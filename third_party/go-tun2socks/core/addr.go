package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/tcp.h"
#include <stdlib.h>
*/
import "C"
import (
	"errors"
	"net"
	"strconv"
	"unsafe"
)

// ipaddr_ntoa() is using a global static buffer to return result,
// reentrants are not allowed, caller is required to lock lwipMutex.
func ipAddrNTOA(ipaddr C.struct_ip_addr) string {
	return C.GoString(C.ipaddr_ntoa(&ipaddr))
}

func ipAddrATON(cp string, addr *C.struct_ip_addr) error {
	ccp := C.CString(cp)
	defer C.free(unsafe.Pointer(ccp))
	if r := C.ipaddr_aton(ccp, addr); r == 0 {
		return errors.New("failed to convert IP address")
	} else {
		return nil
	}
}

func ParseTCPAddr(addr string, port uint16) *net.TCPAddr {
	netAddr, err := net.ResolveTCPAddr("tcp", net.JoinHostPort(addr, strconv.Itoa(int(port))))
	if err != nil {
		return nil
	}
	return netAddr
}

func ParseUDPAddr(addr string, port uint16) *net.UDPAddr {
	netAddr, err := net.ResolveUDPAddr("udp", net.JoinHostPort(addr, strconv.Itoa(int(port))))
	if err != nil {
		return nil
	}
	return netAddr
}
