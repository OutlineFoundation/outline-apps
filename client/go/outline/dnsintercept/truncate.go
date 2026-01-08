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

	"golang.getoutline.org/sdk/network"
	"golang.getoutline.org/sdk/network/dnstruncate"
)

type truncatePacketProxy struct {
	network.PacketProxy
	trunc network.PacketProxy
	local netip.AddrPort
}

type truncatePacketReqSender struct {
	network.PacketRequestSender
	trunc network.PacketRequestSender
	local netip.AddrPort
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
func (tpp *truncatePacketProxy) NewSession(resp network.PacketResponseReceiver) (_ network.PacketRequestSender, err error) {
	base, err := tpp.PacketProxy.NewSession(resp)
	if err != nil {
		return nil, err
	}
	trunc, err := tpp.trunc.NewSession(resp)
	if err != nil {
		return nil, err
	}
	return &truncatePacketReqSender{base, trunc, tpp.local}, nil
}

// WriteTo checks if the packet is a DNS query to the local intercept address.
// If so, it truncates the packet. Otherwise, it passes it to the base proxy.
func (req *truncatePacketReqSender) WriteTo(p []byte, destination netip.AddrPort) (int, error) {
	if isEquivalentAddrPort(destination, req.local) {
		return req.trunc.WriteTo(p, destination)
	}
	return req.PacketRequestSender.WriteTo(p, destination)
}

// Close ensures all underlying PacketRequestSenders are closed properly.
func (req *truncatePacketReqSender) Close() (err error) {
	err = req.PacketRequestSender.Close()
	req.trunc.Close()
	return
}
