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
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/netip"
	"time"

	"localhost/client/go/outline/connectivity"
	"localhost/client/go/outline/dnsmux"

	"golang.getoutline.org/sdk/network/dnsintercept"
	"golang.getoutline.org/sdk/network/dnstruncate"
	"golang.getoutline.org/sdk/network/packetrelay"
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

// How long the shared upstream DNS association stays open without queries.
const dnsUpstreamIdleTimeout = 30 * time.Second

// wrapTransportPairWithOutlineDNS intercepts DNS over TCP and UDP at a link-local address and forwards them to the remote resolver.
//
// It also checks for UDP connectivity.
//   - If UDP is available, it forwards DNS queries to the specified resolverAddr.
//   - If UDP is blocked, it sends back a truncated DNS response.
//     This forces the OS to retry the DNS query over TCP.
func wrapTransportPairWithOutlineDNS(sd *Dialer[transport.StreamConn], pl *PacketListener) (*TransportPair, error) {
	// Randomly selects a DNS resolver for the VPN session
	remoteDNS := outlineDNSResolvers[rand.IntN(len(outlineDNSResolvers))]

	// Intercept DNS for StreamDialer: remap TCP connections to linkLocalDNS → remoteDNS.
	sdForward := func(ctx context.Context, addr string) (transport.StreamConn, error) {
		if dst, err := netip.ParseAddrPort(addr); err == nil && dst.Addr().Unmap() == linkLocalDNS.Addr() && dst.Port() == linkLocalDNS.Port() {
			addr = remoteDNS.String()
		}
		return sd.Dial(ctx, addr)
	}

	baseListener, err := packetrelay.NewPacketRelayFromPacketListener(pl.PacketListener, 30*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to create base PacketRelay: %w", err)
	}
	// Forward relay: intercept DNS at link-local address, forward to remote resolver.
	// The interceptor opens one association per DNS packet. Backing each of them with its own
	// socket makes every query, and every retransmission, a new UDP flow to the proxy, which trips
	// per-destination flow limits in NAT gateways and leaves name resolution broken while the VPN
	// is up. So we multiplex all queries over a single long-lived association instead, and fall
	// back to DNS-over-TCP when UDP does not answer.
	dnsListener, err := packetrelay.NewPacketRelayFromPacketListener(pl.PacketListener, dnsUpstreamIdleTimeout)
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS PacketRelay: %w", err)
	}
	dnsMux, err := dnsmux.NewRelay(dnsListener, dnsmux.Config{})
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS multiplexing relay: %w", err)
	}
	relayForward := dnsintercept.NewInterceptDNSPacketRelay(dnsMux, baseListener, linkLocalDNS, remoteDNS)
	// Truncate relay: intercept DNS at link-local address, return truncated response (forces TCP retry).
	// Non-DNS traffic passes through to baseListener.
	dnsTruncRelay, err := dnstruncate.NewPacketRelay()
	if err != nil {
		return nil, fmt.Errorf("failed to create DNS truncate relay: %w", err)
	}
	relayTrunc := dnsintercept.NewInterceptDNSPacketRelay(dnsTruncRelay, baseListener, linkLocalDNS, remoteDNS)
	// Delegate relay starts with truncate (UDP unverified), switches to forward when UDP is healthy.
	relayMain, err := packetrelay.NewDelegatePacketRelay(relayTrunc)
	if err != nil {
		return nil, fmt.Errorf("failed to create delegate PacketRelay: %w", err)
	}

	onNetworkChanged := func() {
		// The upstream DNS association is bound to the old network.
		dnsMux.Reset()
		go func() {
			if err := connectivity.CheckUDPConnectivity(pl); err == nil {
				slog.Info("remote device UDP is healthy")
				relayMain.SetRelay(relayForward)
			} else {
				slog.Warn("remote device UDP is not healthy", "err", err)
				relayMain.SetRelay(relayTrunc)
			}
		}()
	}

	return &TransportPair{
		&Dialer[transport.StreamConn]{sd.ConnectionProviderInfo, sdForward},
		&PacketRelay{pl.ConnectionProviderInfo, relayMain, onNetworkChanged},
	}, nil
}
