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
	"net/netip"
)

type IPTable[V any] interface {
	AddPrefix(prefix netip.Prefix, value V) error
	Lookup(ip netip.Addr) V
}

// Compile-time check
var _ IPTable[any] = (*ipTable[any])(nil)

const (
	maxIPv4PrefixLen = 32
	maxIPv6PrefixLen = 128
)

// "V" is typically expected to be a dialer of some kind
type ipTable[V any] struct {
	ipv4Buckets [maxIPv4PrefixLen + 1]map[netip.Addr]V
	ipv6Buckets [maxIPv6PrefixLen + 1]map[netip.Addr]V
}

func NewIPTable[V any]() IPTable[V] {
	return &ipTable[V]{}
}

func addInBuckets[V any](buckets []map[netip.Addr]V, prefix netip.Prefix, dialer V) {
	if buckets[prefix.Bits()] == nil {
		buckets[prefix.Bits()] = make(map[netip.Addr]V)
	}

	buckets[prefix.Bits()][prefix.Masked().Addr()] = dialer
}

func (table *ipTable[V]) AddPrefix(prefix netip.Prefix, dialer V) error {
	if prefix.Addr().Is4() {
		addInBuckets(table.ipv4Buckets[:], prefix, dialer)
	} else {
		addInBuckets(table.ipv6Buckets[:], prefix, dialer)
	}
	return nil
}

func lookupInBuckets[V any](lookupAddress netip.Addr, buckets []map[netip.Addr]V) V {
	for bits := len(buckets) - 1; bits >= 0; bits-- {
		bucket := buckets[bits]
		if bucket == nil {
			continue
		}

		value, exists := bucket[netip.PrefixFrom(lookupAddress, bits).Masked().Addr()]

		if exists {
			return value
		}
	}

	var zeroV V
	return zeroV
}

func (table *ipTable[V]) Lookup(lookupAddress netip.Addr) V {
	if lookupAddress.Is4() {
		return lookupInBuckets(lookupAddress, table.ipv4Buckets[:])
	} else {
		return lookupInBuckets(lookupAddress, table.ipv6Buckets[:])
	}
}
