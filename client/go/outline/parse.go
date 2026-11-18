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

package outline

import (
	"encoding/json"
	"fmt"

	"localhost/client/go/composer"
	"localhost/client/go/outline/configregistry"
	"localhost/client/go/outline/platerrors"
)

// providerConfig decodes provider errors. Client configuration is parsed separately
// through Node so nested parsers retain their configuration subtrees.
type providerConfig struct {
	ProviderErrorConfig `yaml:",inline"`
}

// ProviderErrorConfig is config returned by the provider with a custom error to
// show to the user.
type ProviderErrorConfig struct {
	Error *struct {
		Message string
		Details string
	}
}

// ProviderTunnelConfig is the config to fully configure the VPN.
type ProviderTunnelConfig struct {
	ProviderClientConfig `yaml:",inline"`
}

// firstHopAndTunnelConfigJSON must match FirstHopAndTunnelConfigJson in configregistry.ts.
type firstHopAndTunnelConfigJSON struct {
	Client         string                  `json:"client"`
	FirstHop       string                  `json:"firstHop"`
	ConnectionType configregistry.ConnType `json:"connectionType"`
}

func hasKey[K comparable, V any](m map[K]V, key K) bool {
	_, ok := m[key]
	return ok
}

func combinedConnectionType(streamConnType, packetConnType configregistry.ConnType) configregistry.ConnType {
	// When one connection is blocked is always the other connection type
	if streamConnType == configregistry.ConnTypeBlocked {
		return packetConnType
	}
	if packetConnType == configregistry.ConnTypeBlocked {
		return streamConnType
	}

	// Matching connection type
	if streamConnType == packetConnType {
		return streamConnType
	}

	// Connections are non-matching and not blocked
	return configregistry.ConnTypePartial
}

func doParseTunnelConfig(input string) *InvokeMethodResult {
	// Traverse Node for normalization too, so saved configs and validation use
	// the same merge semantics. Retain the original YAML for source diagnostics.
	node, err := composer.ParseYAML([]byte(input))
	if err != nil {
		return &InvokeMethodResult{Error: &platerrors.PlatformError{
			Code: platerrors.InvalidConfig, Message: fmt.Sprintf("failed to parse: %s", err),
		}}
	}
	// Input may be an ss:// link, a transport mapping (including legacy
	// Shadowsocks JSON), or a full client/provider-error mapping.
	var clientConfig any
	var isClientConfig bool
	switch node.Kind() {
	case composer.KindScalar:
		var url string
		if err := node.Decode(&url); err != nil {
			return &InvokeMethodResult{Error: &platerrors.PlatformError{
				Code: platerrors.InvalidConfig, Message: "config must be a URL or mapping",
			}}
		}
		clientConfig = map[string]composer.Node{"transport": node}
	case composer.KindMapping:
		var fields map[string]composer.Node
		if err := node.Decode(&fields); err != nil {
			return &InvokeMethodResult{Error: &platerrors.PlatformError{
				Code: platerrors.InvalidConfig, Message: fmt.Sprintf("failed to parse: %s", err),
			}}
		}
		isClientConfig = hasKey(fields, "transport") || hasKey(fields, "error")
		if isClientConfig {
			clientConfig = node
		} else {
			clientConfig = map[string]composer.Node{"transport": node}
		}
	default:
		return &InvokeMethodResult{Error: &platerrors.PlatformError{
			Code: platerrors.InvalidConfig, Message: "config must be a URL or mapping",
		}}
	}

	// Use JSON marshaling from the standard library because the YAML library is buggy.
	// See https://github.com/OutlineFoundation/outline-apps/issues/2576.
	// JSON is a subset of YAML, so that's valid YAML.
	clientConfigBytes, err := json.Marshal(clientConfig)
	if err != nil {
		return &InvokeMethodResult{
			Error: &platerrors.PlatformError{
				Code:    platerrors.InvalidConfig,
				Message: fmt.Sprintf("failed to normalize config: %s", err),
			},
		}
	}

	if isClientConfig {
		// Provider errors allow extra fields and scalar coercion, preserving the
		// existing envelope behavior while using the shared Composer decoder.
		var providerConfig providerConfig
		decoder := composer.Decoder{CoerceScalars: true, AllowUnknownFields: true}
		if err := decoder.Decode(node, &providerConfig); err != nil {
			return &InvokeMethodResult{Error: &platerrors.PlatformError{
				Code: platerrors.InvalidConfig, Message: fmt.Sprintf("failed to parse: %s", err),
			}}
		}
		if providerConfig.Error != nil {
			platErr := &platerrors.PlatformError{
				Code: platerrors.ProviderError, Message: providerConfig.Error.Message,
			}
			if providerConfig.Error.Details != "" {
				platErr.Details = map[string]any{"details": providerConfig.Error.Details}
			}
			return &InvokeMethodResult{Error: platErr}
		}
	}

	// Validate advanced configs from their original YAML so delegated parsers
	// report source locations. Keep the normalized JSON in the native response.
	clientConfigText := string(clientConfigBytes)
	if isClientConfig {
		clientConfigText = input
	}
	result := (&ClientConfig{
		DataDir: GetBackendConfig().DataDir,
	}).New("", clientConfigText)
	if result.Error != nil {
		return &InvokeMethodResult{
			Error: result.Error,
		}
	}
	response := firstHopAndTunnelConfigJSON{
		Client: string(clientConfigBytes),
	}

	streamFirstHop := result.Client.sd.ConnectionProviderInfo.FirstHop
	packetFirstHop := result.Client.pr.ConnectionProviderInfo.FirstHop
	if streamFirstHop == packetFirstHop {
		response.FirstHop = streamFirstHop
	}

	streamConnType := result.Client.sd.ConnectionProviderInfo.ConnType
	packetConnType := result.Client.pr.ConnectionProviderInfo.ConnType
	response.ConnectionType = combinedConnectionType(streamConnType, packetConnType)

	responseBytes, err := json.Marshal(response)
	if err != nil {
		return &InvokeMethodResult{
			Error: &platerrors.PlatformError{
				Code:    platerrors.InternalError,
				Message: fmt.Sprintf("failed to serialize JSON response: %v", err),
			},
		}
	}

	return &InvokeMethodResult{
		Value: string(responseBytes),
	}
}
