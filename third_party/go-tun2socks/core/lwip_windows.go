// +build windows

package core

/*
#cgo CFLAGS: -I./c/include
#include "lwip/sys.h"
#include "lwip/init.h"
*/
import "C"

func lwipInit() {
	C.sys_init()  // Initialze sys_arch layer, must be called before anything else.
	C.lwip_init() // Initialze modules.
}
