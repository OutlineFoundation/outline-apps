// Copyright 2024 The Outline Authors
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

package outline

import (
	"net"
	"syscall"

	"golang.getoutline.org/sdk/transport"
)

// newFWMarkProtectedTCPDialer creates a base TCP dialer for [Client]
// protected by the specified firewall mark.
func newFWMarkProtectedTCPDialer(fwmark uint32) transport.StreamDialer {
	return &transport.TCPDialer{
		Dialer: net.Dialer{
			KeepAlive: -1,
			Control: func(network, address string, c syscall.RawConn) error {
				return c.Control(func(fd uintptr) {
					syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, int(fwmark))
				})
			},
		},
	}
}

// newFWMarkProtectedUDPDialer creates a new UDP dialer for [Client]
// protected by the specified firewall mark.
func newFWMarkProtectedUDPDialer(fwmark uint32) transport.PacketDialer {
	return &transport.UDPDialer{
		Dialer: net.Dialer{
			Control: func(network, address string, c syscall.RawConn) error {
				return c.Control(func(fd uintptr) {
					syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_MARK, int(fwmark))
				})
			},
		},
	}
}
