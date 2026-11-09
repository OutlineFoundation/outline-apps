package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/tcp.h"
*/
import "C"
import (
	"unsafe"
)

//export output
func output(p *C.struct_pbuf) C.err_t {
	// In most case, all data are in the same pbuf struct, data copying can be avoid by
	// backing Go slice with C array. Buf if there are multiple pbuf structs holding the
	// data, we must copy data for sending them in one pass.
	totlen := int(p.tot_len)
	if p.tot_len == p.len {
		buf := (*[1 << 30]byte)(unsafe.Pointer(p.payload))[:totlen:totlen]
		OutputFn(buf[:totlen])
	} else {
		buf := NewBytes(totlen)
		C.pbuf_copy_partial(p, unsafe.Pointer(&buf[0]), p.tot_len, 0) // data copy here!
		OutputFn(buf[:totlen])
		FreeBytes(buf)
	}
	return C.ERR_OK
}
