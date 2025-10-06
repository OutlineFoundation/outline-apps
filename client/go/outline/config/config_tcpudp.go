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
	"fmt"

	"github.com/Jigsaw-Code/outline-apps/client/go/configyaml"
	"github.com/Jigsaw-Code/outline-sdk/transport"
)

// TCPUDPConfig is the format for the TCPUDP config. It specifies separate TCP and UDP configs
// to create a [TransportPair].
type TCPUDPConfig struct {
	TCP configyaml.ConfigNode
	UDP configyaml.ConfigNode
}

func NewTCPUDPTransportPairSubParser(
	parseSD configyaml.ParseFunc[*Dialer[transport.StreamConn]],
	parsePL configyaml.ParseFunc[*PacketListener]) func(ctx context.Context, input map[string]any) (*TransportPair, error) {
	return func(ctx context.Context, input map[string]any) (*TransportPair, error) {
		return parseTCPUDPTransportPair(ctx, input, parseSD, parsePL)
	}
}

func parseTCPUDPTransportPair(ctx context.Context, configMap map[string]any, parseSD configyaml.ParseFunc[*Dialer[transport.StreamConn]], parsePL configyaml.ParseFunc[*PacketListener]) (*TransportPair, error) {
	var config TCPUDPConfig
	if err := configyaml.MapToAny(configMap, &config); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}

	sd, err := parseSD(ctx, config.TCP)
	if err != nil {
		return nil, fmt.Errorf("failed to parse StreamDialer: %w", err)
	}

	pl, err := parsePL(ctx, config.UDP)
	if err != nil {
		return nil, fmt.Errorf("failed to parse PacketListener: %w", err)
	}

	return wrapTransportPairWithOutlineDNS(sd, pl)
}
