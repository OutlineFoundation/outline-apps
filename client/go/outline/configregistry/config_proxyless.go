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

	"golang.getoutline.org/sdk/transport"
	"golang.getoutline.org/sdk/transport/tlsfrag"
	"localhost/client/go/configyaml"
)

// minSplit, maxSplit, and randomSplitLength moved to transport_configs.go
// (Task 8), which this legacy parser still shares since both live in
// package configregistry.

type BasicAccessConfig struct {
	// TODO: for now we do not parse any config, once DNS is implemented we will parse it.
}

func NewProxylessTransportPairSubParser(parseSD configyaml.ParseFunc[*Dialer[transport.StreamConn]]) func(ctx context.Context, input map[string]any) (*TransportPair, error) {
	return func(ctx context.Context, input map[string]any) (*TransportPair, error) {
		return parseProxylessTransportPair(ctx, input, parseSD)
	}
}

func parseProxylessTransportPair(ctx context.Context, configMap map[string]any, _ configyaml.ParseFunc[*Dialer[transport.StreamConn]]) (*TransportPair, error) {
	// TODO: use the streamDialers.Parse parser for the DNS config

	var config BasicAccessConfig
	if err := configyaml.MapToAny(configMap, &config); err != nil {
		return nil, fmt.Errorf("invalid config format: %w", err)
	}

	splitLength := randomSplitLength()

	fragSD, err := tlsfrag.NewFixedLenStreamDialer(&transport.TCPDialer{}, splitLength)
	if err != nil {
		return nil, fmt.Errorf("failed to create StreamDialer: %w", err)
	}

	pl := &PacketListener{ConnectionProviderInfo{ConnTypeDirect, ""}, &transport.UDPListener{}}
	sd := &Dialer[transport.StreamConn]{
		ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeDirect},
		Dial:                   fragSD.DialStream,
	}

	return wrapTransportPairWithOutlineDNS(sd, pl)
}
