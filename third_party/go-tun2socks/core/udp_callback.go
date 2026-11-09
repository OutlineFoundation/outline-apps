package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/udp.h"

extern void udpRecvFn(void *arg, struct udp_pcb *pcb, struct pbuf *p, const ip_addr_t *addr, u16_t port, const ip_addr_t *dest_addr, u16_t dest_port);

void
set_udp_recv_callback(struct udp_pcb *pcb, void *recv_arg) {
	udp_recv(pcb, udpRecvFn, recv_arg);
}
*/
import "C"
import (
	"unsafe"
)

func setUDPRecvCallback(pcb *C.struct_udp_pcb, recvArg unsafe.Pointer) {
	C.set_udp_recv_callback(pcb, recvArg)
}
