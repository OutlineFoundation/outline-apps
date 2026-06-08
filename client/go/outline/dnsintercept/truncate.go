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

type dnsTruncatePacketProxy struct {
	network.PacketProxy
	truncate53PP          network.PacketProxy
	resolverLinkLocalAddr netip.AddrPort
}

// dnsTruncatePacketReqSender handles packet routing for truncate sessions.
//
// DNS packets (destined for local) are handled by trunc and never touch the
// base proxy.  The base session is created lazily on the first non-DNS packet,
// avoiding a wasted transport session for DNS-only flows.
type dnsTruncatePacketReqSender struct {
	mu                    sync.Mutex
	baseSender            network.PacketRequestSender    // nil until first non-DNS packet; guarded by mu
	baseProxy             network.PacketProxy            // used to lazily create base
	respReceiver          network.PacketResponseReceiver // passed to base when it is created
	truncate53PP          network.PacketRequestSender    // handles DNS packets locally without a transport session
	resolverLinkLocalAddr netip.AddrPort                 // the DNS address to intercept
}

// NewDNSTruncatePacketProxy creates a PacketProxy to intercept UDP-based DNS packets and force a TCP retry.
//
// It intercepts all packets to `resolverLinkLocalAddr` and returns an immediate truncated response,
// prompting the OS to retry the query over TCP.
//
// All other UDP packets are passed through to the `base` PacketProxy.
func NewDNSTruncatePacketProxy(base network.PacketProxy, resolverLinkLocalAddr netip.AddrPort) (network.PacketProxy, error) {
	if base == nil {
		return nil, errors.New("base PacketProxy must be provided")
	}
	// Returns truncated responses for *all* traffic on port 53.
	truncate53PP, err := dnstruncate.NewPacketProxy()
	if err != nil {
		return nil, fmt.Errorf("failed to create the underlying DNS truncate PacketProxy: %w", err)
	}
	return &dnsTruncatePacketProxy{
		PacketProxy:           base,
		truncate53PP:          truncate53PP,
		resolverLinkLocalAddr: resolverLinkLocalAddr,
	}, nil
}

// NewSession implements PacketProxy.NewSession.
//
// Only the trunc session is created eagerly.  The base session is deferred
// until the first non-DNS packet arrives.
func (tpp *dnsTruncatePacketProxy) NewSession(respReceiver network.PacketResponseReceiver) (_ network.PacketRequestSender, err error) {
	trunc, err := tpp.truncate53PP.NewSession(respReceiver)
	if err != nil {
		return nil, err
	}
	return &dnsTruncatePacketReqSender{
		baseProxy:             tpp.PacketProxy,
		respReceiver:          respReceiver,
		truncate53PP:          trunc,
		resolverLinkLocalAddr: tpp.resolverLinkLocalAddr,
	}, nil
}

// WriteTo checks if the packet is a DNS query to the local intercept address.
// If so, it truncates the packet. Otherwise, it passes it to the base proxy,
// creating the base session on demand if this is the first non-DNS packet.
func (req *dnsTruncatePacketReqSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	if isEquivalentAddrPort(destination, req.resolverLinkLocalAddr) {
		return req.truncate53PP.WriteTo(p, destination)
	}
	req.mu.Lock()
	if req.baseSender == nil {
		base, err := req.baseProxy.NewSession(req.respReceiver)
		if err != nil {
			req.mu.Unlock()
			return 0, err
		}
		req.baseSender = base
	}
	sender := req.baseSender
	req.mu.Unlock()
	return sender.WriteTo(p, destination)
}

// Close ensures all underlying PacketRequestSenders are closed properly.
func (req *dnsTruncatePacketReqSender) Close() (err error) {
	req.mu.Lock()
	defer req.mu.Unlock()
	if req.baseSender != nil {
		err = req.baseSender.Close()
	}
	return errors.Join(err, req.truncate53PP.Close())
}
