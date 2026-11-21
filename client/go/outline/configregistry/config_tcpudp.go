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

package configregistry

import (
	"context"
	"fmt"

	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

// TCPUDPConfig is the format for the TCPUDP config. It specifies separate TCP and UDP configs
// to create a [TransportPair].
type TCPUDPConfig struct {
	TCP composer.Optional[composer.Node]
	UDP composer.Optional[composer.Node]
}

func parseTCPUDPTransportPair(ctx context.Context, r composer.Registry, node composer.Node) (*TransportPair, error) {
	var config TCPUDPConfig
	if err := node.Decode(&config); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}

	sd, err := composer.Parse[*Dialer[transport.StreamConn]](ctx, r, config.TCP.Or(composer.Node{}))
	if err != nil {
		return nil, fmt.Errorf("failed to parse StreamDialer: %w", err)
	}

	pl, err := composer.Parse[*PacketListener](ctx, r, config.UDP.Or(composer.Node{}))
	if err != nil {
		return nil, fmt.Errorf("failed to parse PacketListener: %w", err)
	}

	return wrapTransportPairWithOutlineDNS(sd, pl)
}
