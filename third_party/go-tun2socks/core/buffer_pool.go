package core

import (
	"sync"
)

var pool *sync.Pool

const BufSize = 2 * 1024

func SetBufferPool(p *sync.Pool) {
	pool = p
}

func NewBytes(size int) []byte {
	if size <= BufSize {
		return pool.Get().([]byte)
	} else {
		return make([]byte, size)
	}
}

func FreeBytes(b []byte) {
	if len(b) >= BufSize {
		pool.Put(b)
	}
}

func init() {
	SetBufferPool(&sync.Pool{
		New: func() interface{} {
			return make([]byte, BufSize)
		},
	})
}
