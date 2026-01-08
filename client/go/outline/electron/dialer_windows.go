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

package main

import (
	"encoding/binary"
	"errors"
	"net"
	"syscall"

	"golang.getoutline.org/sdk/transport"
	"golang.org/x/sys/windows"
)

// Define missing Windows constants in ws2ipdef.h
// - https://learn.microsoft.com/en-us/windows/win32/winsock/ipproto-ip-socket-options
const (
	IP_IFLIST     = 28 // value: 32bit DWORD (boolean)
	IP_ADD_IFLIST = 29 // value: 32bit DWORD (IF_INDEX in native byte order)
	IP_UNICAST_IF = 31 // value: 32bit DWORD (IF_INDEX in network byte order)
)

func newBaseDialersWithAdapter(nicIdx int) (transport.StreamDialer, transport.PacketDialer, error) {
	tcp := newTCPDialerWithAdapter(nicIdx)
	udp := newUDPDialerWithAdapter(nicIdx)
	return tcp, udp, nil
}

func newTCPDialerWithAdapter(nicIdx int) transport.StreamDialer {
	nicIdxBigEnd := toBigEndianInt(nicIdx)
	return &transport.TCPDialer{Dialer: net.Dialer{
		KeepAlive: -1,
		Control: func(network, address string, conn syscall.RawConn) error {
			var operr error
			err := conn.Control(func(fd uintptr) {
				// TODO(ipv6): set IPPROTO_IPV6 when IPv6 is enabled
				operr = windows.SetsockoptInt(windows.Handle(fd), syscall.IPPROTO_IP, IP_UNICAST_IF, nicIdxBigEnd)
			})
			return errors.Join(err, operr)
		},
	}}
}

func newUDPDialerWithAdapter(nicIdx int) transport.PacketDialer {
	nicIdxBigEnd := toBigEndianInt(nicIdx)
	return &transport.UDPDialer{Dialer: net.Dialer{
		Control: func(network, address string, conn syscall.RawConn) error {
			var operr1, operr2, operr3 error
			err := conn.Control(func(fd uintptr) {
				// TODO(ipv6): set IPPROTO_IPV6 when IPv6 is enabled
				operr1 = windows.SetsockoptInt(windows.Handle(fd), syscall.IPPROTO_IP, IP_IFLIST, 1)
				operr2 = windows.SetsockoptInt(windows.Handle(fd), syscall.IPPROTO_IP, IP_ADD_IFLIST, nicIdx)
				operr3 = windows.SetsockoptInt(windows.Handle(fd), syscall.IPPROTO_IP, IP_UNICAST_IF, nicIdxBigEnd)
			})
			return errors.Join(err, operr1, operr2, operr3)
		},
	}}
}

func toBigEndianInt(v int) int {
	bigEndianBytes := make([]byte, 4)
	binary.NativeEndian.PutUint32(bigEndianBytes, uint32(v))
	return int(binary.BigEndian.Uint32(bigEndianBytes))
}
