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

func TestConnectionAnalyzerLeaves(t *testing.T) {
	directStream, directPacket, directListener := directConfigs()
	a := ConnectionAnalyzer{}

	info, err := a.streamDialer(directStream)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect}, info)

	info, err = a.packetDialer(directPacket)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect}, info)

	info, err = a.packetListener(directListener)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect}, info)

	block := &netconfig.BlockConfig{}
	info, err = a.streamDialer(block)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeBlocked}, info)
	info, err = a.packetDialer(block)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeBlocked}, info)
}

func TestConnectionAnalyzerStreamDialEndpoint(t *testing.T) {
	directStream, _, _ := directConfigs()

	for _, tc := range []struct {
		name         string
		resolveFirst bool
	}{
		{"disabled", false},
		{"enabled", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			endpoint := &netconfig.StreamDialEndpointConfig{
				Address:             "direct.example:443",
				ResolveAddressFirst: !tc.resolveFirst,
				Dialer:              directStream,
			}
			info, err := (ConnectionAnalyzer{ResolveDirectAddressesFirst: tc.resolveFirst}).streamEndpoint(endpoint)
			require.NoError(t, err)
			require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect, FirstHop: "direct.example:443"}, info)
			require.Equal(t, tc.resolveFirst, endpoint.ResolveAddressFirst)
		})
	}

	inner := &netconfig.StreamDialEndpointConfig{Address: "proxy.example:1234", Dialer: directStream}
	tunnel := &netconfig.ShadowsocksStreamDialerConfig{Endpoint: inner}
	outer := &netconfig.StreamDialEndpointConfig{
		Address:             "ignored.example:5678",
		ResolveAddressFirst: true,
		Dialer:              tunnel,
	}
	info, err := (ConnectionAnalyzer{ResolveDirectAddressesFirst: true}).streamEndpoint(outer)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "proxy.example:1234"}, info)
	require.False(t, outer.ResolveAddressFirst, "analysis must clear a stale direct-resolution flag")
}

func TestConnectionAnalyzerPacketDialEndpoint(t *testing.T) {
	_, directPacket, _ := directConfigs()
	endpoint := &netconfig.PacketDialEndpointConfig{
		Address: "packet.example:53",
		Dialer:  directPacket,
	}
	info, err := (ConnectionAnalyzer{ResolveDirectAddressesFirst: true}).packetEndpoint(endpoint)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect, FirstHop: "packet.example:53"}, info)
	require.True(t, endpoint.ResolveAddressFirst)

	inner := &netconfig.PacketDialEndpointConfig{Address: "proxy.example:4321", Dialer: directPacket}
	tunnel := &netconfig.ShadowsocksPacketDialerConfig{
		Listener: &netconfig.ShadowsocksPacketListenerConfig{Endpoint: inner},
	}
	outer := &netconfig.PacketDialEndpointConfig{
		Address:             "ignored.example:1234",
		ResolveAddressFirst: true,
		Dialer:              tunnel,
	}
	info, err = (ConnectionAnalyzer{ResolveDirectAddressesFirst: true}).packetEndpoint(outer)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "proxy.example:4321"}, info)
	require.False(t, outer.ResolveAddressFirst)
}

func TestConnectionAnalyzerWebsocketAndShadowsocks(t *testing.T) {
	directStream, _, _ := directConfigs()
	dial := &netconfig.StreamDialEndpointConfig{Address: "cdn.example:443", Dialer: directStream}
	websocket := &netconfig.WebsocketEndpointConfig{Endpoint: dial}
	a := ConnectionAnalyzer{}

	streamInfo, err := a.streamEndpoint(websocket)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeDirect, FirstHop: "cdn.example:443"}, streamInfo)
	packetInfo, err := a.packetEndpoint(websocket)
	require.NoError(t, err)
	require.Equal(t, streamInfo, packetInfo)

	streamInfo, err = a.streamDialer(&netconfig.ShadowsocksStreamDialerConfig{Endpoint: websocket})
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "cdn.example:443"}, streamInfo)
}

func TestConnectionAnalyzerShadowsocksPacketForms(t *testing.T) {
	_, directPacket, _ := directConfigs()
	endpoint := &netconfig.PacketDialEndpointConfig{Address: "ss.example:4321", Dialer: directPacket}
	listener := &netconfig.ShadowsocksPacketListenerConfig{Endpoint: endpoint}
	a := ConnectionAnalyzer{}

	listenerInfo, err := a.packetListener(listener)
	require.NoError(t, err)
	require.Equal(t, ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "ss.example:4321"}, listenerInfo)
	dialerInfo, err := a.packetDialer(&netconfig.ShadowsocksPacketDialerConfig{Listener: listener})
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

	info, err := a.AnalyzeTransport(&TCPUDPTransportConfig{TCP: ssStream, UDP: directListener})
	require.NoError(t, err)
	require.Equal(t, TransportPairInfo{
		Stream: ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "tcp.example:1234"},
		Packet: ConnectionProviderInfo{ConnType: ConnTypeDirect},
	}, info)

	info, err = a.AnalyzeTransport(&ShadowsocksTransportConfig{StreamDialer: ssStream, PacketListener: ssPacket})
	require.NoError(t, err)
	require.Equal(t, TransportPairInfo{
		Stream: ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "tcp.example:1234"},
		Packet: ConnectionProviderInfo{ConnType: ConnTypeTunneled, FirstHop: "udp.example:5678"},
	}, info)

	info, err = a.AnalyzeTransport(&BasicAccessTransportConfig{})
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
	a := ConnectionAnalyzer{ResolveDirectAddressesFirst: true}

	first, err := a.AnalyzeTransport(transportConfig)
	require.NoError(t, err)
	firstFlag := endpoint.ResolveAddressFirst
	second, err := a.AnalyzeTransport(transportConfig)
	require.NoError(t, err)
	require.Equal(t, first, second)
	require.Equal(t, firstFlag, endpoint.ResolveAddressFirst)
}

func TestConnectionAnalyzerRejectsUnknownAndNilConfigs(t *testing.T) {
	a := ConnectionAnalyzer{}

	_, err := a.AnalyzeTransport(nil)
	require.ErrorContains(t, err, "transport <nil>")
	_, err = a.AnalyzeTransport((*unknownTransportConfig)(nil))
	require.ErrorContains(t, err, "transport *configregistry.unknownTransportConfig")
	_, err = a.AnalyzeTransport((*TCPUDPTransportConfig)(nil))
	require.ErrorContains(t, err, "nil TCP/UDP transport config")
	_, err = a.AnalyzeTransport((*ShadowsocksTransportConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks transport config")
	_, err = a.AnalyzeTransport((*BasicAccessTransportConfig)(nil))
	require.ErrorContains(t, err, "nil basic-access transport config")

	_, err = a.streamDialer(nil)
	require.ErrorContains(t, err, "stream dialer <nil>")
	_, err = a.streamDialer((*unknownStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "stream dialer *configregistry.unknownStreamDialerConfig")
	_, err = a.streamDialer((*netconfig.DirectStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "nil direct stream dialer config")
	_, err = a.streamDialer((*netconfig.BlockConfig)(nil))
	require.ErrorContains(t, err, "nil block stream dialer config")
	_, err = a.streamDialer((*netconfig.ShadowsocksStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks stream dialer config")
	_, err = a.streamDialer((*IPTableStreamDialerConfig)(nil))
	require.ErrorContains(t, err, "nil IP table stream dialer config")

	_, err = a.packetDialer(nil)
	require.ErrorContains(t, err, "packet dialer <nil>")
	_, err = a.packetDialer((*unknownPacketDialerConfig)(nil))
	require.ErrorContains(t, err, "packet dialer *configregistry.unknownPacketDialerConfig")
	_, err = a.streamEndpoint(nil)
	require.ErrorContains(t, err, "stream endpoint <nil>")
	_, err = a.streamEndpoint((*unknownStreamEndpointConfig)(nil))
	require.ErrorContains(t, err, "stream endpoint *configregistry.unknownStreamEndpointConfig")
	_, err = a.packetEndpoint(nil)
	require.ErrorContains(t, err, "packet endpoint <nil>")
	_, err = a.packetEndpoint((*unknownPacketEndpointConfig)(nil))
	require.ErrorContains(t, err, "packet endpoint *configregistry.unknownPacketEndpointConfig")
	_, err = a.packetListener(nil)
	require.ErrorContains(t, err, "packet listener <nil>")
	_, err = a.packetListener((*unknownPacketListenerConfig)(nil))
	require.ErrorContains(t, err, "packet listener *configregistry.unknownPacketListenerConfig")

	_, err = a.packetDialer((*netconfig.DirectPacketDialerConfig)(nil))
	require.ErrorContains(t, err, "nil direct packet dialer config")
	_, err = a.packetDialer((*netconfig.BlockConfig)(nil))
	require.ErrorContains(t, err, "nil block packet dialer config")
	_, err = a.packetDialer((*netconfig.ShadowsocksPacketDialerConfig)(nil))
	require.ErrorContains(t, err, "nil Shadowsocks packet dialer config")
	_, err = a.streamEndpoint((*netconfig.StreamDialEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil stream dial endpoint config")
	_, err = a.streamEndpoint((*netconfig.WebsocketEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil WebSocket stream endpoint config")
	_, err = a.packetEndpoint((*netconfig.PacketDialEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil packet dial endpoint config")
	_, err = a.packetEndpoint((*netconfig.WebsocketEndpointConfig)(nil))
	require.ErrorContains(t, err, "nil WebSocket packet endpoint config")
	_, err = a.packetListener((*netconfig.DirectPacketListenerConfig)(nil))
	require.ErrorContains(t, err, "nil direct packet listener config")
	_, err = a.packetListener((*netconfig.ShadowsocksPacketListenerConfig)(nil))
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
