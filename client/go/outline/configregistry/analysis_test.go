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

package configregistry

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer/netconfig"
)

func directConfigs() (*netconfig.DirectStreamDialerConfig, *netconfig.DirectPacketDialerConfig, *netconfig.DirectPacketListenerConfig) {
	return netconfig.NewDirectStreamDialerConfig(nil),
		netconfig.NewDirectPacketDialerConfig(nil),
		netconfig.NewDirectPacketListenerConfig(nil)
}

// stubResolver stands in for DNS: analysis must never do real lookups in tests.
// It records what it was asked, so memoization is observable.
type stubResolver struct {
	resolved string
	asked    []string
}

func (r *stubResolver) resolve(_ context.Context, address string) (string, error) {
	r.asked = append(r.asked, address)
	return r.resolved, nil
}

func TestConnectionAnalyzerLeaves(t *testing.T) {
	directStream, directPacket, directListener := directConfigs()
	a := ConnectionAnalyzer{}

	info, err := a.streamDialer(context.Background(), directStream)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect}, info)

	info, err = a.packetDialer(context.Background(), directPacket)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect}, info)

	info, err = a.packetListener(context.Background(), directListener)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect}, info)

	block := &netconfig.BlockConfig{}
	info, err = a.streamDialer(context.Background(), block)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeBlocked}, info)
	info, err = a.packetDialer(context.Background(), block)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeBlocked}, info)
}

func TestConnectionAnalyzerStreamDialEndpoint(t *testing.T) {
	directStream, _, _ := directConfigs()

	for _, tc := range []struct {
		name       string
		resolver   *stubResolver
		wantDialed string
	}{
		{"no resolver", nil, "direct.example:443"},
		{"resolver", &stubResolver{resolved: "203.0.113.7:443"}, "203.0.113.7:443"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			endpoint := &netconfig.StreamDialEndpointConfig{
				Address: "direct.example:443",
				Dialer:  directStream,
			}
			a := ConnectionAnalyzer{}
			if tc.resolver != nil {
				a.ResolveDirectAddress = tc.resolver.resolve
			}
			info, err := a.streamEndpoint(context.Background(), endpoint)
			require.NoError(t, err)
			require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect, FirstHop: tc.wantDialed}, info)
			require.Equal(t, tc.wantDialed, endpoint.Address,
				"FirstHop must be the address the endpoint will dial")
		})
	}

	inner := &netconfig.StreamDialEndpointConfig{Address: "proxy.example:1234", Dialer: directStream}
	tunnel := &netconfig.ShadowsocksStreamDialerConfig{Endpoint: inner}
	outer := &netconfig.StreamDialEndpointConfig{Address: "ignored.example:5678", Dialer: tunnel}
	info, err := (ConnectionAnalyzer{
		ResolveDirectAddress: (&stubResolver{resolved: "203.0.113.7:1234"}).resolve,
	}).streamEndpoint(context.Background(), outer)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "203.0.113.7:1234"}, info)
	require.Equal(t, "203.0.113.7:1234", inner.Address, "only the inner direct hop is resolved")
	require.Equal(t, "ignored.example:5678", outer.Address, "a tunneled endpoint's address is left alone")
}

func TestConnectionAnalyzerPacketDialEndpoint(t *testing.T) {
	_, directPacket, _ := directConfigs()
	endpoint := &netconfig.PacketDialEndpointConfig{
		Address: "packet.example:53",
		Dialer:  directPacket,
	}
	resolver := &stubResolver{resolved: "203.0.113.7:53"}
	info, err := (ConnectionAnalyzer{ResolveDirectAddress: resolver.resolve}).packetEndpoint(context.Background(), endpoint)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect, FirstHop: "203.0.113.7:53"}, info)
	require.Equal(t, "203.0.113.7:53", endpoint.Address)
	require.Equal(t, []string{"packet.example:53"}, resolver.asked)

	inner := &netconfig.PacketDialEndpointConfig{Address: "proxy.example:4321", Dialer: directPacket}
	tunnel := &netconfig.ShadowsocksPacketDialerConfig{
		Listener: &netconfig.ShadowsocksPacketListenerConfig{Endpoint: inner},
	}
	outer := &netconfig.PacketDialEndpointConfig{Address: "ignored.example:1234", Dialer: tunnel}
	info, err = (ConnectionAnalyzer{
		ResolveDirectAddress: (&stubResolver{resolved: "203.0.113.7:4321"}).resolve,
	}).packetEndpoint(context.Background(), outer)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "203.0.113.7:4321"}, info)
	require.Equal(t, "ignored.example:1234", outer.Address)
}

func TestConnectionAnalyzerWebsocketAndShadowsocks(t *testing.T) {
	directStream, _, _ := directConfigs()
	dial := &netconfig.StreamDialEndpointConfig{Address: "cdn.example:443", Dialer: directStream}
	websocket := &netconfig.WebsocketEndpointConfig{Endpoint: dial}
	a := ConnectionAnalyzer{}

	streamInfo, err := a.streamEndpoint(context.Background(), websocket)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect, FirstHop: "cdn.example:443"}, streamInfo)
	packetInfo, err := a.packetEndpoint(context.Background(), websocket)
	require.NoError(t, err)
	require.Equal(t, streamInfo, packetInfo)

	streamInfo, err = a.streamDialer(context.Background(), &netconfig.ShadowsocksStreamDialerConfig{Endpoint: websocket})
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "cdn.example:443"}, streamInfo)
}

func TestConnectionAnalyzerShadowsocksPacketForms(t *testing.T) {
	_, directPacket, _ := directConfigs()
	endpoint := &netconfig.PacketDialEndpointConfig{Address: "ss.example:4321", Dialer: directPacket}
	listener := &netconfig.ShadowsocksPacketListenerConfig{Endpoint: endpoint}
	a := ConnectionAnalyzer{}

	listenerInfo, err := a.packetListener(context.Background(), listener)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "ss.example:4321"}, listenerInfo)
	dialerInfo, err := a.packetDialer(context.Background(), &netconfig.ShadowsocksPacketDialerConfig{Listener: listener})
	require.NoError(t, err)
	require.Equal(t, listenerInfo, dialerInfo)
}

func TestConnectionAnalyzerTransportForms(t *testing.T) {
	directStream, directPacket, directListener := directConfigs()
	streamEndpoint := &netconfig.StreamDialEndpointConfig{Address: "tcp.example:1234", Dialer: directStream}
	packetEndpoint := &netconfig.PacketDialEndpointConfig{Address: "udp.example:5678", Dialer: directPacket}
	ssStream := &netconfig.ShadowsocksStreamDialerConfig{Endpoint: streamEndpoint}
	ssPacket := &netconfig.ShadowsocksPacketListenerConfig{Endpoint: packetEndpoint}
	a := ConnectionAnalyzer{}

	info, err := a.AnalyzeTransport(context.Background(), &TCPUDPTransportConfig{TCP: ssStream, UDP: directListener})
	require.NoError(t, err)
	require.Equal(t, TransportPairInfo{
		Stream: ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "tcp.example:1234"},
		Packet: ConnectionProviderInfo{ConnType: ConnTypeDirect},
	}, info)

	info, err = a.AnalyzeTransport(context.Background(), &ShadowsocksTransportConfig{StreamDialer: ssStream, PacketListener: ssPacket})
	require.NoError(t, err)
	require.Equal(t, TransportPairInfo{
		Stream: ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "tcp.example:1234"},
		Packet: ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "udp.example:5678"},
	}, info)

	info, err = a.AnalyzeTransport(context.Background(), &BasicAccessTransportConfig{})
	require.NoError(t, err)
	require.Equal(t, TransportPairInfo{
		Stream: ConnectionProviderInfo{ConnType: ConnTypeDirect},
		Packet: ConnectionProviderInfo{ConnType: ConnTypeDirect},
	}, info)
}

func TestConnectionAnalyzerRepeatedAnalysisIsIdempotent(t *testing.T) {
	directStream, _, directListener := directConfigs()
	endpoint := &netconfig.StreamDialEndpointConfig{Address: "direct.example:443", Dialer: directStream}
	transportConfig := &TCPUDPTransportConfig{TCP: &netconfig.ShadowsocksStreamDialerConfig{Endpoint: endpoint}, UDP: directListener}
	a := ConnectionAnalyzer{ResolveDirectAddress: (&stubResolver{resolved: "203.0.113.7:443"}).resolve}

	first, err := a.AnalyzeTransport(context.Background(), transportConfig)
	require.NoError(t, err)
	firstAddress := endpoint.Address
	second, err := a.AnalyzeTransport(context.Background(), transportConfig)
	require.NoError(t, err)
	require.Equal(t, first, second)
	require.Equal(t, firstAddress, endpoint.Address, "re-resolving an already resolved address is a no-op")
}

// A resolver that fails must leave the endpoint dialing its configured address.
func TestConnectionAnalyzerResolutionFailureKeepsHostname(t *testing.T) {
	directStream, _, _ := directConfigs()
	endpoint := &netconfig.StreamDialEndpointConfig{Address: "direct.example:443", Dialer: directStream}
	a := ConnectionAnalyzer{ResolveDirectAddress: func(context.Context, string) (string, error) {
		return "", errors.New("no such host")
	}}

	info, err := a.streamEndpoint(context.Background(), endpoint)
	require.NoError(t, err, "resolution failure must not fail analysis")
	require.Equal(t, "direct.example:443", info.FirstHop)
	require.Equal(t, "direct.example:443", endpoint.Address)
}

// The stream and packet halves of a transport usually name the same server.
// Resolving each independently could give them different IPs, which would make
// their first hops disagree and get dropped, so one host resolves once.
func TestConnectionAnalyzerResolvesEachHostOnce(t *testing.T) {
	directStream, directPacket, _ := directConfigs()
	streamEndpoint := &netconfig.StreamDialEndpointConfig{Address: "ss.example:4321", Dialer: directStream}
	packetEndpoint := &netconfig.PacketDialEndpointConfig{Address: "ss.example:4321", Dialer: directPacket}
	transportConfig := &TCPUDPTransportConfig{
		TCP: &netconfig.ShadowsocksStreamDialerConfig{Endpoint: streamEndpoint},
		UDP: &netconfig.ShadowsocksPacketListenerConfig{Endpoint: packetEndpoint},
	}
	resolver := &stubResolver{resolved: "203.0.113.7:4321"}

	info, err := (ConnectionAnalyzer{ResolveDirectAddress: resolver.resolve}).
		AnalyzeTransport(context.Background(), transportConfig)
	require.NoError(t, err)
	require.Equal(t, []string{"ss.example:4321"}, resolver.asked, "the host must be resolved once")
	require.Equal(t, info.Stream.FirstHop, info.Packet.FirstHop, "both halves must agree on the first hop")
	require.Equal(t, "203.0.113.7:4321", info.Stream.FirstHop)
}

func TestConnectionAnalyzerRejectsUnknownAndNilConfigs(t *testing.T) {
	a := ConnectionAnalyzer{}

	_, err := a.AnalyzeTransport(context.Background(), nil)
	require.ErrorContains(t, err, "transport <nil>")
	_, err = a.AnalyzeTransport(context.Background(), (*unknownTransportConfig)(nil))
	require.ErrorContains(t, err, "transport *configregistry.unknownTransportConfig")
	_, err = a.AnalyzeTransport(context.Background(), (*TCPUDPTransportConfig)(nil))
	require.ErrorContains(t, err, "nil TCP/UDP transport config")
	_, err = a.AnalyzeTransport(context.Background(), (*ShadowsocksTransportConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks transport config")
	_, err = a.AnalyzeTransport(context.Background(), (*BasicAccessTransportConfig)(nil))
	require.ErrorContains(t, err, "nil basic-access transport config")

	_, err = a.streamDialer(context.Background(), nil)
	require.ErrorContains(t, err, "stream dialer <nil>")
	_, err = a.streamDialer(context.Background(), (*unknownStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "stream dialer *configregistry.unknownStreamDialerConfig")
	_, err = a.streamDialer(context.Background(), (*netconfig.DirectStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "nil direct stream dialer config")
	_, err = a.streamDialer(context.Background(), (*netconfig.BlockConfig)(nil))
	require.ErrorContains(t, err, "nil block stream dialer config")
	_, err = a.streamDialer(context.Background(), (*netconfig.ShadowsocksStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks stream dialer config")
	_, err = a.streamDialer(context.Background(), (*IPTableStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "nil IP table stream dialer config")

	_, err = a.packetDialer(context.Background(), nil)
	require.ErrorContains(t, err, "packet dialer <nil>")
	_, err = a.packetDialer(context.Background(), (*unknownPacketDialerConfig)(nil))
	require.ErrorContains(t, err, "packet dialer *configregistry.unknownPacketDialerConfig")
	_, err = a.streamEndpoint(context.Background(), nil)
	require.ErrorContains(t, err, "stream endpoint <nil>")
	_, err = a.streamEndpoint(context.Background(), (*unknownStreamEndpointConfig)(nil))
	require.ErrorContains(t, err, "stream endpoint *configregistry.unknownStreamEndpointConfig")
	_, err = a.packetEndpoint(context.Background(), nil)
	require.ErrorContains(t, err, "packet endpoint <nil>")
	_, err = a.packetEndpoint(context.Background(), (*unknownPacketEndpointConfig)(nil))
	require.ErrorContains(t, err, "packet endpoint *configregistry.unknownPacketEndpointConfig")
	_, err = a.packetListener(context.Background(), nil)
	require.ErrorContains(t, err, "packet listener <nil>")
	_, err = a.packetListener(context.Background(), (*unknownPacketListenerConfig)(nil))
	require.ErrorContains(t, err, "packet listener *configregistry.unknownPacketListenerConfig")

	_, err = a.packetDialer(context.Background(), (*netconfig.DirectPacketDialerConfig)(nil))
	require.ErrorContains(t, err, "nil direct packet dialer config")
	_, err = a.packetDialer(context.Background(), (*netconfig.BlockConfig)(nil))
	require.ErrorContains(t, err, "nil block packet dialer config")
	_, err = a.packetDialer(context.Background(), (*netconfig.ShadowsocksPacketDialerConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks packet dialer config")
	_, err = a.streamEndpoint(context.Background(), (*netconfig.StreamDialEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil stream dial endpoint config")
	_, err = a.streamEndpoint(context.Background(), (*netconfig.WebsocketEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil WebSocket stream endpoint config")
	_, err = a.packetEndpoint(context.Background(), (*netconfig.PacketDialEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil packet dial endpoint config")
	_, err = a.packetEndpoint(context.Background(), (*netconfig.WebsocketEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil WebSocket packet endpoint config")
	_, err = a.packetListener(context.Background(), (*netconfig.DirectPacketListenerConfig)(nil))
	require.ErrorContains(t, err, "nil direct packet listener config")
	_, err = a.packetListener(context.Background(), (*netconfig.ShadowsocksPacketListenerConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks packet listener config")
}

type unknownTransportConfig struct{}

func (*unknownTransportConfig) NewTransportPair(context.Context) (*TransportPairParts, error) {
	return nil, nil
}

type unknownStreamDialerConfig struct{}

func (*unknownStreamDialerConfig) NewStreamDialer(context.Context) (transport.StreamDialer, error) {
	return nil, nil
}

type unknownPacketDialerConfig struct{}

func (*unknownPacketDialerConfig) NewPacketDialer(context.Context) (transport.PacketDialer, error) {
	return nil, nil
}

type unknownStreamEndpointConfig struct{}

func (*unknownStreamEndpointConfig) NewStreamEndpoint(context.Context) (transport.StreamEndpoint, error) {
	return nil, nil
}

type unknownPacketEndpointConfig struct{}

func (*unknownPacketEndpointConfig) NewPacketEndpoint(context.Context) (transport.PacketEndpoint, error) {
	return nil, nil
}

type unknownPacketListenerConfig struct{}

func (*unknownPacketListenerConfig) NewPacketListener(context.Context) (transport.PacketListener, error) {
	return nil, nil
}
