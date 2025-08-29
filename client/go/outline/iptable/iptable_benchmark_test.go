// Copyright 2025 The Outline Authors
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

package iptable

import (
	"math/rand"
	"net/netip"
	"testing"
	"time"
)

const (
	numBenchmarkRules    = 10000
	numBenchmarkMatchIPs = 5000
)

func generatePrefixes(count int, seed int64) []netip.Prefix {
	prefixes := make([]netip.Prefix, 0, count)
	rng := rand.New(rand.NewSource(seed))

	for i := 0; i < count; i++ {
		var ip netip.Addr
		var bits int

		if rng.Intn(2) == 0 { // IPv4
			ipBytes := make([]byte, 4)
			rng.Read(ipBytes)
			ip = netip.AddrFrom4([4]byte(ipBytes))
			// Bias towards common lengths, allow others
			switch rng.Intn(5) {
			case 0:
				bits = 8
			case 1:
				bits = 16
			case 2:
				bits = 24
			case 3:
				bits = 32
			default:
				bits = rng.Intn(32-1) + 1 // 1-31
			}
		} else { // IPv6
			ipBytes := make([]byte, 16)
			rng.Read(ipBytes)
			ip, _ = netip.AddrFromSlice(ipBytes)
			switch rng.Intn(5) {
			case 0:
				bits = 32
			case 1:
				bits = 48
			case 2:
				bits = 64
			case 3:
				bits = 128
			default:
				bits = rng.Intn(128-1) + 1 // 1-127
			}
		}

		prefix, err := ip.Prefix(bits)
		if err != nil || !prefix.IsValid() {
			// Skip invalid combinations (e.g., bad length for type)
			i--
			continue
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes
}

func generateAddresses(count int, seed int64) []netip.Addr {
	addrs := make([]netip.Addr, 0, count)
	rng := rand.New(rand.NewSource(seed))

	for i := 0; i < count; i++ {
		var ip netip.Addr

		if rng.Intn(2) == 0 {
			ipBytes := make([]byte, 4)
			rng.Read(ipBytes)
			ip = netip.AddrFrom4([4]byte(ipBytes))
		} else {
			ipBytes := make([]byte, 16)
			rng.Read(ipBytes)
			ip, _ = netip.AddrFromSlice(ipBytes)
		}

		if !ip.IsValid() { // Should be rare with random bytes, but check
			i--
			continue
		}
		addrs = append(addrs, ip)
	}
	return addrs
}

// --- Benchmarks ---

var benchmarkPrefixes = generatePrefixes(numBenchmarkRules, time.Now().UnixNano())
var benchmarkMatchAddrs = generateAddresses(numBenchmarkMatchIPs, time.Now().UnixNano()+1) // Use different seed

// Benchmark adding rules to an empty routing table.
func BenchmarkIPRoutingTable_AddRule_Growing(b *testing.B) {
	table := NewIPTable[string]()
	value := "benchmark_value"

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		prefix := benchmarkPrefixes[i%len(benchmarkPrefixes)]
		err := table.AddPrefix(prefix, value)
		if err != nil {
			b.StopTimer()
			b.Fatalf("AddPrefix failed during growing benchmark: %v", err)
		}
	}
}

var benchVal string
var benchOk bool

// Benchmark matching against a pre-filled router.
func BenchmarkIPRoutingTable_Lookup(b *testing.B) {
	table := NewIPTable[string]()
	value := "benchmark_value"
	defaultV4 := mustParsePrefix("0.0.0.0/0")
	defaultV6 := mustParsePrefix("::/0")
	table.AddPrefix(defaultV4, "default")
	table.AddPrefix(defaultV6, "default")

	for _, prefix := range benchmarkPrefixes {
		err := table.AddPrefix(prefix, value)
		if err != nil {
			b.Fatalf("Setup failed: AddPrefix error: %v", err)
		}
	}

	b.ResetTimer()
	b.ReportAllocs()

	for i := 0; i < b.N; i++ {
		ipToMatch := benchmarkMatchAddrs[i%len(benchmarkMatchAddrs)]

		v := table.Lookup(ipToMatch)

		benchVal = v
	}
}
