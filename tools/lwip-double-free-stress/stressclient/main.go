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

// stressclient runs on the device (adb shell) and opens TCP connections through
// the VPN to the fake targets served by fakess. Each connection follows one of
// several close/abort patterns chosen to exercise the lwIP TCP teardown paths
// in go-tun2socks. The seed makes a run repeatable.
package main

import (
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

var (
	host  = flag.String("host", "8.8.4.4", "public address routed through the VPN; fakess intercepts it")
	conns = flag.Int("conns", 60, "connections to open")
	seed  = flag.Int64("seed", 1, "random seed")
	hold  = flag.Duration("hold", 4*time.Second, "how long the long-lived patterns stay open")
	only  = flag.String("only", "", "run a single pattern by name")

	mode     = flag.String("mode", "mix", "mix: the weighted close patterns; race: simultaneous-close racers plus victims")
	racers   = flag.Int("racers", 3000, "race mode: connections that close at the same moment as the server")
	victims  = flag.Int("victims", 1500, "race mode: idle connections opened during the storm")
	stormFor = flag.Duration("storm", 12*time.Second, "race mode: how long to spread the connections over")
	closeAt  = flag.Duration("closeat", 300*time.Millisecond, "race mode: must match fakess -closeat")
	window   = flag.Duration("window", 10*time.Millisecond, "race mode: the client closes at closeat + [0, window)")

	connected, dialFailed, gotBytes atomic.Int64
)

type pattern struct {
	name   string
	port   int
	weight int
	run    func(c *net.TCPConn, rnd *rand.Rand)
}

func jitter(rnd *rand.Rand, base time.Duration) time.Duration {
	return base + time.Duration(rnd.Int63n(int64(base)/4+1))
}

func drain(c *net.TCPConn, max time.Duration) {
	c.SetReadDeadline(time.Now().Add(max))
	n, _ := io.Copy(io.Discard, c)
	gotBytes.Add(n)
}

var patterns = []pattern{
	// The interleaving described in OutlineFoundation/go-tun2socks#1: the proxy
	// side dies while the app is not reading (so the download half of the relay
	// is parked on TCP backpressure), the app then sends one more data segment,
	// half-closes, and only afterwards drains its receive buffer.
	{"slow-reader-then-fin", 7002, 30, func(c *net.TCPConn, rnd *rand.Rand) {
		c.Write([]byte("hello"))
		time.Sleep(jitter(rnd, 600*time.Millisecond)) // fakess RSTs at 400ms.
		c.Write([]byte("x"))                          // relay's proxy write fails -> CloseRead.
		time.Sleep(jitter(rnd, 200*time.Millisecond))
		c.Write([]byte("y")) // lands on the closed pipe -> lwIP rx shutdown.
		time.Sleep(jitter(rnd, 200*time.Millisecond))
		c.CloseWrite()
		time.Sleep(jitter(rnd, 200*time.Millisecond))
		drain(c, 3*time.Second)
	}},
	// Same, but the app reads normally: the relay's download half sees the RST first.
	{"upload-then-server-reset", 7002, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		go drain(c, 5*time.Second)
		for i := 0; i < 40; i++ {
			if _, err := c.Write(make([]byte, 512)); err != nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		c.Write([]byte("bye"))
		c.CloseWrite()
		time.Sleep(300 * time.Millisecond)
	}},
	{"reset-on-first-data", 7003, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		c.Write([]byte("hello"))
		time.Sleep(jitter(rnd, 150*time.Millisecond))
		c.Write([]byte("x"))
		time.Sleep(jitter(rnd, 100*time.Millisecond))
		c.Write([]byte("y"))
		c.CloseWrite()
		drain(c, 2*time.Second)
	}},
	{"server-closes-early", 7004, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		for i := 0; i < 30; i++ {
			if _, err := c.Write(make([]byte, 256)); err != nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		c.CloseWrite()
		drain(c, 2*time.Second)
	}},
	{"client-abort-mid-download", 7005, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		c.Write([]byte("go"))
		buf := make([]byte, 4096)
		deadline := time.Now().Add(jitter(rnd, 500*time.Millisecond))
		for time.Now().Before(deadline) {
			n, err := c.Read(buf)
			gotBytes.Add(int64(n))
			if err != nil {
				break
			}
		}
		c.SetLinger(0) // RST.
	}},
	{"download-held-open", 7005, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		c.Write([]byte("go"))
		drain(c, *hold) // still downloading when the VPN is torn down.
	}},
	{"idle-held-open", 7006, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		c.Write([]byte("hello"))
		time.Sleep(*hold)
	}},
	{"echo", 7001, 10, func(c *net.TCPConn, rnd *rand.Rand) {
		c.Write(make([]byte, 2048))
		c.CloseWrite()
		drain(c, 3*time.Second)
	}},
}

func dial(port int) (*net.TCPConn, error) {
	d := net.Dialer{Timeout: 5 * time.Second}
	c, err := d.Dial("tcp", net.JoinHostPort(*host, fmt.Sprint(port)))
	if err != nil {
		return nil, err
	}
	return c.(*net.TCPConn), nil
}

// race looks for a use-after-free in the TCP glue's close path.
//
// Racers connect to the close-at target and close (FIN or RST) at the same
// moment the server closes its side, so the relay's CloseWrite and lwIP's own
// handling of the app's FIN/RST run concurrently. If CloseWrite then touches a
// pcb that lwIP already freed and handed to a new connection, that unrelated
// connection gets a FIN it never asked for.
//
// Victims are those unrelated connections: they go to the blackhole target,
// which never sends or closes, so a victim that reads EOF or an error before
// its own deadline has been hit by another connection's close. A hit victim
// then closes, which leaves its pcb in TIME_WAIT with the Go conn still
// registered; lwIP frees it after 2*MSL (120s), and the next stack teardown
// aborts the freed pcb.
func race(rnd *rand.Rand) {
	var wg sync.WaitGroup
	var racerOK, victimOK, victimEOF, victimErr, failed atomic.Int64
	// A few fast downloads keep the lwIP lock busy.
	stop := time.Now().Add(*stormFor + time.Second)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, err := dial(7005)
			if err != nil {
				return
			}
			defer c.Close()
			c.Write([]byte("go"))
			c.SetReadDeadline(stop)
			io.Copy(io.Discard, c)
		}()
	}
	total := *racers + *victims
	gap := *stormFor / time.Duration(total)
	for i := 0; i < total; i++ {
		isVictim := rnd.Intn(total) < *victims
		offset := time.Duration(rnd.Int63n(int64(*window)))
		useRST := rnd.Intn(2) == 0
		wg.Add(1)
		go func() {
			defer wg.Done()
			if isVictim {
				c, err := dial(7006)
				if err != nil {
					failed.Add(1)
					return
				}
				defer c.Close()
				c.Write([]byte("v"))
				deadline := time.Now().Add(3 * time.Second)
				c.SetReadDeadline(deadline)
				var b [16]byte
				n, err := c.Read(b[:])
				switch {
				case time.Now().After(deadline.Add(-50 * time.Millisecond)):
					victimOK.Add(1)
				case err == io.EOF && n == 0:
					victimEOF.Add(1)
				default:
					victimErr.Add(1)
				}
				return
			}
			start := time.Now()
			c, err := dial(7008)
			if err != nil {
				failed.Add(1)
				return
			}
			c.Write([]byte("r"))
			time.Sleep(time.Until(start.Add(*closeAt + offset)))
			if useRST {
				c.SetLinger(0)
			}
			c.Close()
			racerOK.Add(1)
		}()
		time.Sleep(gap)
	}
	wg.Wait()
	fmt.Printf("mode=race seed=%d racers=%d victims_ok=%d victims_unexpected_eof=%d victims_unexpected_err=%d dial_failed=%d\n",
		*seed, racerOK.Load(), victimOK.Load(), victimEOF.Load(), victimErr.Load(), failed.Load())
}

func main() {
	flag.Parse()
	rnd := rand.New(rand.NewSource(*seed))
	if *mode == "race" {
		race(rnd)
		return
	}
	total := 0
	for _, p := range patterns {
		total += p.weight
	}
	counts := map[string]int{}
	var wg sync.WaitGroup
	for i := 0; i < *conns; i++ {
		var p pattern
		pick := rnd.Intn(total)
		for _, q := range patterns {
			if pick < q.weight {
				p = q
				break
			}
			pick -= q.weight
		}
		if *only != "" {
			for _, q := range patterns {
				if q.name == *only {
					p = q
				}
			}
		}
		counts[p.name]++
		connRnd := rand.New(rand.NewSource(rnd.Int63()))
		wg.Add(1)
		go func() {
			defer wg.Done()
			d := net.Dialer{Timeout: 3 * time.Second, Control: func(_, _ string, rc syscall.RawConn) error {
				// A small receive buffer makes the app-side window close quickly.
				return rc.Control(func(fd uintptr) { syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, 4096) })
			}}
			c, err := d.Dial("tcp", net.JoinHostPort(*host, fmt.Sprint(p.port)))
			if err != nil {
				dialFailed.Add(1)
				return
			}
			connected.Add(1)
			defer c.Close()
			p.run(c.(*net.TCPConn), connRnd)
		}()
		time.Sleep(time.Duration(connRnd.Intn(15)) * time.Millisecond)
	}
	wg.Wait()
	fmt.Printf("seed=%d connected=%d dial_failed=%d bytes_received=%d patterns=%v\n",
		*seed, connected.Load(), dialFailed.Load(), gotBytes.Load(), counts)
}
