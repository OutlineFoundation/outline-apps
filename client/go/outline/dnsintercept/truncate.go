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

package dnsintercept

import (
	"errors"
	"fmt"
	"net/netip"
	"sync"

	"golang.getoutline.org/sdk/network"
	"golang.getoutline.org/sdk/network/dnstruncate"
)

type truncatePacketProxy struct {
	network.PacketProxy
	trunc network.PacketProxy
	local netip.AddrPort
}

// truncatePacketReqSender handles packet routing for truncate sessions.
//
// DNS packets (destined for local) are handled by trunc and never touch the
// base proxy.  The base session is created lazily on the first non-DNS packet,
// avoiding a wasted transport session for DNS-only flows.
type truncatePacketReqSender struct {
	mu        sync.Mutex
	base      network.PacketRequestSender  // nil until first non-DNS packet; guarded by mu
	baseProxy network.PacketProxy          // used to lazily create base
	resp      network.PacketResponseReceiver // passed to base when it is created
	trunc     network.PacketRequestSender  // handles DNS packets locally without a transport session
	local     netip.AddrPort               // the DNS address to intercept
}

// WrapTruncatePacketProxy creates a PacketProxy to intercept UDP-based DNS packets and force a TCP retry.
//
// It intercepts all packets to `localAddr` and returns an immediate truncated response,
// prompting the OS to retry the query over TCP.
//
// All other UDP packets are passed through to the `base` PacketProxy.
func WrapTruncatePacketProxy(base network.PacketProxy, localAddr netip.AddrPort) (network.PacketProxy, error) {
	if base == nil {
		return nil, errors.New("base PacketProxy must be provided")
	}
	trunc, err := dnstruncate.NewPacketProxy()
	if err != nil {
		return nil, fmt.Errorf("failed to create the underlying DNS truncate PacketProxy")
	}
	return &truncatePacketProxy{
		PacketProxy: base,
		trunc:       trunc,
		local:       localAddr,
	}, nil
}

// NewSession implements PacketProxy.NewSession.
//
// Only the trunc session is created eagerly.  The base session is deferred
// until the first non-DNS packet arrives.
func (tpp *truncatePacketProxy) NewSession(resp network.PacketResponseReceiver) (_ network.PacketRequestSender, err error) {
	trunc, err := tpp.trunc.NewSession(resp)
	if err != nil {
		return nil, err
	}
	return &truncatePacketReqSender{
		baseProxy: tpp.PacketProxy,
		resp:      resp,
		trunc:     trunc,
		local:     tpp.local,
	}, nil
}

// WriteTo checks if the packet is a DNS query to the local intercept address.
// If so, it truncates the packet. Otherwise, it passes it to the base proxy,
// creating the base session on demand if this is the first non-DNS packet.
func (req *truncatePacketReqSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	if isEquivalentAddrPort(destination, req.local) {
		return req.trunc.WriteTo(p, destination)
	}
	req.mu.Lock()
	if req.base == nil {
		base, err := req.baseProxy.NewSession(req.resp)
		if err != nil {
			req.mu.Unlock()
			return 0, err
		}
		req.base = base
	}
	sender := req.base
	req.mu.Unlock()
	return sender.WriteTo(p, destination)
}

// Close ensures all underlying PacketRequestSenders are closed properly.
func (req *truncatePacketReqSender) Close() (err error) {
	req.mu.Lock()
	defer req.mu.Unlock()
	if req.base != nil {
		err = req.base.Close()
	}
	req.trunc.Close()
	return
}
