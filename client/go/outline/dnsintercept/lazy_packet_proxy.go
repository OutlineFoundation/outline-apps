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

package dnsintercept

import (
	"net"
	"net/netip"
	"sync"

	"golang.getoutline.org/sdk/network"
)

// lazyPacketProxy is a PacketProxy that creates sessions on demand on first WriteTo.
type lazyPacketProxy struct {
	baseProxy network.PacketProxy
}

type lazyPacketProxyRequestSender struct {
	mu             sync.Mutex
	newSessionFunc func() (network.PacketRequestSender, error)
	sender         network.PacketRequestSender
	isClosed       bool
}

func (p *lazyPacketProxy) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	return &lazyPacketProxyRequestSender{
		newSessionFunc: func() (network.PacketRequestSender, error) {
			return p.baseProxy.NewSession(resp)
		},
	}, nil
}

func (s *lazyPacketProxyRequestSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isClosed {
		return 0, net.ErrClosed
	}

	if s.sender == nil {
		sender, err := s.newSessionFunc()
		if err != nil {
			return 0, err
		}
		s.sender = sender
	}
	return s.sender.WriteTo(p, destination)
}

func (s *lazyPacketProxyRequestSender) Close() error {
	s.mu.Lock()

	if s.isClosed {
		s.mu.Unlock()
		return net.ErrClosed
	}
	s.isClosed = true

	sender := s.sender
	s.sender = nil

	s.mu.Unlock()

	// We close the underlying senders outside the lock, in case they are slow or try to write somehow.
	if sender != nil {
		return sender.Close()
	}
	return nil
}
