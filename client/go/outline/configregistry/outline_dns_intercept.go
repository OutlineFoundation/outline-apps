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

package configregistry

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/netip"

	"localhost/client/go/outline/connectivity"
	"localhost/client/go/outline/dnsintercept"

	"golang.getoutline.org/sdk/network"
	"golang.getoutline.org/sdk/network/dnstruncate"
	"golang.getoutline.org/sdk/transport"
)

// A list of public DNS resolvers that the VPN can use.
var outlineDNSResolvers = []netip.AddrPort{
	netip.MustParseAddrPort("1.1.1.1:53"),        // Cloudflare
	netip.MustParseAddrPort("9.9.9.9:53"),        // Quad9
	netip.MustParseAddrPort("208.67.222.222:53"), // OpenDNS
	netip.MustParseAddrPort("208.67.220.220:53"), // OpenDNS
}

// A hard-coded link-local address for DNS interception.
//
// TODO: make this configurable via a new VpnConfig
var linkLocalDNS = netip.MustParseAddrPort("169.254.113.53:53")

// wrapTransportPairWithOutlineDNS intercepts DNS over TCP and UDP at a link-local address and forwards them to the remote resolver.
//
// It also checks for UDP connectivity.
//   - If UDP is available, it forwards DNS queries to the specified resolverAddr.
//   - If UDP is blocked, it sends back a truncated DNS response.
//     This forces the OS to retry the DNS query over TCP.
func wrapTransportPairWithOutlineDNS(sd *Dialer[transport.StreamConn], pl *PacketListener) (*TransportPair, error) {
	// Randomly selects a DNS resolver for the VPN session
	remoteDNS := outlineDNSResolvers[rand.IntN(len(outlineDNSResolvers))]

	// Intercept DNS for StreamDialer
	sdForward, err := dnsintercept.NewDNSRedirectStreamDialer(transport.FuncStreamDialer(sd.Dial), linkLocalDNS, remoteDNS)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS redirect StreamDialer: %w", err)
	}

	// Intercept DNS for PacketProxy
	ppBase, err := network.NewPacketProxyFromPacketListener(pl)
	if err != nil {
		return nil, fmt.Errorf("failed to create PacketProxy: %w", err)
	}
	// Forwards DNS packets through ppBase and closes the session after the first response.
	ppForward, err := dnsintercept.NewDNSForwardPacketProxy(ppBase)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS redirect PacketProxy: %w", err)
	}
	// Returns a truncated response for DNS packets to force a retry over TCP.
	ppTrunc, err := dnstruncate.NewPacketProxy()
	if err != nil {
		return nil, fmt.Errorf("failed to create always-truncate DNS PacketProxy: %w", err)
	}
	// Delegate for DNS traffic: selects between forwarding and truncation based on connectivity.
	ppDNS, err := network.NewDelegatePacketProxy(ppTrunc)
	if err != nil {
		return nil, fmt.Errorf("failed to create indirect DNS PacketProxy: %w", err)
	}
	// Interceptor: Forwards everything except DNS to ppBase. DNS is redirected to ppDNS and
	// translated between the link-local and remote addresses.
	ppMain, err := dnsintercept.NewDNSInterceptor(ppBase, ppDNS, linkLocalDNS, remoteDNS)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS interceptor PacketProxy: %w", err)
	}

	onNetworkChanged := func() {
		go func() {
			if err := connectivity.CheckUDPConnectivity(pl); err == nil {
				slog.Info("remote device UDP is healthy")
				ppDNS.SetProxy(ppForward)
			} else {
				slog.Warn("remote device UDP is not healthy", "err", err)
				ppDNS.SetProxy(ppTrunc)
			}
		}()
	}

	return &TransportPair{
		&Dialer[transport.StreamConn]{sd.ConnectionProviderInfo, sdForward.DialStream},
		&PacketProxy{pl.ConnectionProviderInfo, ppMain, onNetworkChanged},
	}, nil
}
