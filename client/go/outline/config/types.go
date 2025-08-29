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

package config

import (
	"context"
	"net"

	"github.com/Jigsaw-Code/outline-sdk/transport"
)

// ConnType is the type of the connections returned by Dialers and Endpoints.
// Useful for knowing if it's tunneled or direct.
type ConnType int

const (
	ConnTypeDirect ConnType = iota
	ConnTypeTunneled
	ConnTypePartial
)

// ConnProviderConfig represents a dialer or endpoint that can create connections.
type ConnectionProviderInfo struct {
	// The type of the connections that are provided
	ConnType ConnType
	// The address of the first hop.
	FirstHop string
}

// PacketListener is a [transport.PacketListener] with embedded ConnectionProviderInfo.
type PacketListener struct {
	ConnectionProviderInfo
	transport.PacketListener
}

// DialFunc is a generic dialing function that can return any type of connction given a context and address.
type DialFunc[ConnType any] func(ctx context.Context, address string) (ConnType, error)

// Dialer has a generic Dial function and embedded ConnectionProviderInfo.
// Useful to represent and share logic between Stream and Packet Dialers.
type Dialer[ConnType any] struct {
	ConnectionProviderInfo
	Dial DialFunc[ConnType]
}

// ConnectFunc is a generic connect function that can return any type of connction given a context.
type ConnectFunc[ConnType any] func(ctx context.Context) (ConnType, error)

// Endpoint has a generic Connect function and embedded ConnectionProviderInfo.
// Useful to represent and share logic between Stream and Packet Endpoints.
type Endpoint[ConnType any] struct {
	ConnectionProviderInfo
	Connect ConnectFunc[ConnType]
}

// TransportPair provides a StreamDialer and PacketListener, to use as the transport in a Tun2Socks VPN.
type TransportPair struct {
	StreamDialer   *Dialer[transport.StreamConn]
	PacketListener *PacketListener
}

var _ transport.StreamDialer = (*TransportPair)(nil)
var _ transport.PacketListener = (*TransportPair)(nil)

func (t *TransportPair) DialStream(ctx context.Context, address string) (transport.StreamConn, error) {
	return t.StreamDialer.Dial(ctx, address)
}

func (t *TransportPair) ListenPacket(ctx context.Context) (net.PacketConn, error) {
	return t.PacketListener.ListenPacket(ctx)
}
