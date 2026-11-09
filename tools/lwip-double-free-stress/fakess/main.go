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

// fakess is a throwaway Shadowsocks TCP server for the lwIP double free stress
// test. It never forwards the stress traffic anywhere: the target port the
// client asks for selects how the "target" misbehaves, so every run is
// self-contained and repeatable. Any other target is relayed for real, which
// keeps the app's connectivity check working.
//
// SIGUSR1 makes it stop listening for -refuse (default 700ms), so the client's
// dials to the proxy fail with "connection refused" for that window.
package main

import (
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"golang.getoutline.org/sdk/transport/shadowsocks"
)

// Target ports and what the fake target does on each.
const (
	portEcho         = 7001 // reads until EOF, answers 1KB, closes.
	portFloodReset   = 7002 // floods the client, discards uploads, RSTs after -reset.
	portResetOnData  = 7003 // RSTs as soon as the first upload byte arrives.
	portCloseEarly   = 7004 // closes gracefully after 200ms while the client uploads.
	portFloodForever = 7005 // floods until the client goes away.
	portBlackhole    = 7006 // accepts and stays silent.
	portCloseAt      = 7008 // sends one byte, then closes gracefully after -closeat.
)

var (
	resetAfter  = flag.Duration("reset", 400*time.Millisecond, "when the flood+reset target sends its RST")
	closeAt     = flag.Duration("closeat", 300*time.Millisecond, "when the close-at target closes its side")
	noRelay     = flag.Bool("norelay", false, "refuse non-stress targets (needed when running on the device, where a relayed dial would loop back into the VPN)")
	refuseFor   = flag.Duration("refuse", 700*time.Millisecond, "how long to stop listening on SIGUSR1")
	connCount   atomic.Int64
	stressCount atomic.Int64
)

func readTarget(r io.Reader) (host string, port int, err error) {
	var atyp [1]byte
	if _, err = io.ReadFull(r, atyp[:]); err != nil {
		return
	}
	var addr []byte
	switch atyp[0] {
	case 1:
		addr = make([]byte, 4)
	case 4:
		addr = make([]byte, 16)
	case 3:
		var l [1]byte
		if _, err = io.ReadFull(r, l[:]); err != nil {
			return
		}
		addr = make([]byte, l[0])
	default:
		return "", 0, fmt.Errorf("bad address type %d", atyp[0])
	}
	if _, err = io.ReadFull(r, addr); err != nil {
		return
	}
	var p [2]byte
	if _, err = io.ReadFull(r, p[:]); err != nil {
		return
	}
	if atyp[0] == 3 {
		host = string(addr)
	} else {
		host = net.IP(addr).String()
	}
	return host, int(binary.BigEndian.Uint16(p[:])), nil
}

func reset(c *net.TCPConn) {
	c.SetLinger(0)
	c.Close()
}

func flood(w io.Writer, until time.Time, c *net.TCPConn) {
	buf := make([]byte, 16*1024)
	if !until.IsZero() {
		c.SetWriteDeadline(until)
	}
	for {
		if _, err := w.Write(buf); err != nil {
			return
		}
	}
}

func handle(c *net.TCPConn, key *shadowsocks.EncryptionKey) {
	defer c.Close()
	connCount.Add(1)
	r := shadowsocks.NewReader(c, key)
	host, port, err := readTarget(r)
	if err != nil {
		return
	}
	w := shadowsocks.NewWriter(c, key)

	switch port {
	case portEcho:
		stressCount.Add(1)
		io.Copy(io.Discard, r)
		w.Write(make([]byte, 1024))
	case portFloodReset:
		stressCount.Add(1)
		go io.Copy(io.Discard, r)
		deadline := time.Now().Add(*resetAfter)
		flood(w, deadline, c)
		time.Sleep(time.Until(deadline))
		reset(c)
	case portResetOnData:
		stressCount.Add(1)
		var b [1]byte
		r.Read(b[:])
		reset(c)
	case portCloseEarly:
		stressCount.Add(1)
		w.Write(make([]byte, 512))
		time.Sleep(200 * time.Millisecond)
	case portFloodForever:
		stressCount.Add(1)
		go io.Copy(io.Discard, r)
		flood(w, time.Time{}, c)
	case portBlackhole:
		stressCount.Add(1)
		io.Copy(io.Discard, r)
	case portCloseAt:
		stressCount.Add(1)
		start := time.Now()
		w.Write([]byte{1})
		go io.Copy(io.Discard, r)
		time.Sleep(time.Until(start.Add(*closeAt)))
	default:
		if *noRelay {
			return
		}
		// Real relay, for the app's connectivity check and stray device traffic.
		t, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprint(port)), 5*time.Second)
		if err != nil {
			return
		}
		defer t.Close()
		go func() { io.Copy(t, r); t.(*net.TCPConn).CloseWrite() }()
		io.Copy(w, t)
	}
}

func main() {
	addr := flag.String("addr", "127.0.0.1:19999", "listen address")
	secret := flag.String("secret", "outline-e2e-tunnel", "Shadowsocks secret (chacha20-ietf-poly1305)")
	flag.Parse()
	key, err := shadowsocks.NewEncryptionKey(shadowsocks.CHACHA20IETFPOLY1305, *secret)
	if err != nil {
		log.Fatal(err)
	}

	usr1 := make(chan os.Signal, 1)
	signal.Notify(usr1, syscall.SIGUSR1)
	go func() {
		for range time.Tick(5 * time.Second) {
			log.Printf("connections=%d stress=%d", connCount.Load(), stressCount.Load())
		}
	}()

	for {
		l, err := net.Listen("tcp", *addr)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("listening on %s", *addr)
		go func() {
			<-usr1
			log.Printf("SIGUSR1: refusing connections for %s", *refuseFor)
			l.Close()
		}()
		for {
			c, err := l.Accept()
			if err != nil {
				if !errors.Is(err, net.ErrClosed) {
					log.Printf("accept: %v", err)
				}
				break
			}
			go handle(c.(*net.TCPConn), key)
		}
		time.Sleep(*refuseFor)
	}
}
