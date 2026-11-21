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
	"errors"
	"fmt"
	"strings"

	"localhost/client/go/composer"
	"localhost/client/go/outline/configregistry"
	"localhost/client/go/outline/platerrors"
)

// firstHopAndTunnelConfigJSON must match FirstHopAndTunnelConfigJson in configregistry.ts.
type firstHopAndTunnelConfigJSON struct {
	Client         string          `json:"client"`
	FirstHop       string          `json:"firstHop"`
	ConnectionType configregistry.ConnType `json:"connectionType"`
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
	input = strings.TrimSpace(input)
	// Input may be one of:
	// - ss:// link
	// - Legacy Shadowsocks JSON (parsed as YAML)
	// - Advanced YAML format
	root, err := composer.ParseYAML([]byte(input))
	if err != nil {
		return parseFailure(err)
	}
	var clientConfigValue any
	switch root.Kind() {
	case composer.KindMapping:
		var keys map[string]composer.Node
		if err := root.Decode(&keys); err != nil {
			return parseFailure(err)
		}
		_, hasTransport := keys["transport"]
		errorNode, hasError := keys["error"]
		if !hasTransport && !hasError {
			// Legacy JSON format. Input is the transport config.
			transportValue, err := plainValue(root)
			if err != nil {
				return parseFailure(err)
			}
			clientConfigValue = map[string]any{"transport": transportValue}
			break
		}
		// New format. Process provider error, if present.
		if !errorNode.IsAbsent() {
			platErr, err := providerError(errorNode)
			if err != nil {
				return parseFailure(err)
			}
			return &InvokeMethodResult{Error: platErr}
		}
		if clientConfigValue, err = plainValue(root); err != nil {
			return parseFailure(err)
		}
	case composer.KindScalar, composer.KindAbsent:
		// Legacy URL format. Input is the transport config.
		text := ""
		if !root.IsAbsent() {
			if text, err = root.Text(); err != nil {
				return parseFailure(err)
			}
		}
		clientConfigValue = map[string]any{"transport": text}
	default:
		return parseFailure(fmt.Errorf("expected a string or a map, found %v", root.Kind()))
	}

	// The client config is stored and handed back to ClientConfig.New when connecting. It is
	// normalized to JSON, with aliases and merge keys expanded, which is valid YAML.
	clientConfigBytes, err := json.Marshal(clientConfigValue)
	if err != nil {
		return &InvokeMethodResult{
			Error: &platerrors.PlatformError{
				Code:    platerrors.InvalidConfig,
				Message: fmt.Sprintf("failed to normalize config: %s", err),
			},
		}
	}

	result := (&ClientConfig{
		DataDir: GetBackendConfig().DataDir,
	}).New("", string(clientConfigBytes))
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

func parseFailure(err error) *InvokeMethodResult {
	return &InvokeMethodResult{
		Error: &platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: fmt.Sprintf("failed to parse: %s", err),
		},
	}
}

// providerError reads the error a provider returns in place of a config, to show to the user.
// Fields other than message and details are ignored.
func providerError(node composer.Node) (*platerrors.PlatformError, error) {
	var fields map[string]composer.Node
	if err := node.Decode(&fields); err != nil {
		return nil, err
	}
	platErr := &platerrors.PlatformError{Code: platerrors.ProviderError}
	if message := fields["message"]; !message.IsAbsent() {
		text, err := message.Text()
		if err != nil {
			return nil, err
		}
		platErr.Message = text
	}
	if details := fields["details"]; !details.IsAbsent() {
		text, err := details.Text()
		if err != nil {
			return nil, err
		}
		if text != "" {
			platErr.Details = map[string]any{"details": text}
		}
	}
	return platErr, nil
}

// Limits for plainValue, matching those of [composer.Node.Decode].
const (
	maxPlainValueDepth = 100
	maxPlainValues     = 100_000
)

var errTooManyValues = errors.New("config has too many values")

// plainValue returns the value of node as the maps, slices, strings, numbers, booleans, and nils
// that encoding/json marshals, with aliases and merge keys expanded.
func plainValue(node composer.Node) (any, error) {
	count := 0
	return plainValueDepth(node, 0, &count)
}

func plainValueDepth(node composer.Node, depth int, count *int) (any, error) {
	*count++
	if *count > maxPlainValues {
		return nil, errTooManyValues
	}
	if depth > maxPlainValueDepth {
		return nil, fmt.Errorf("config nesting exceeds %d levels", maxPlainValueDepth)
	}
	switch node.Kind() {
	case composer.KindAbsent:
		return nil, nil
	case composer.KindMapping:
		var entries map[string]composer.Node
		if err := node.Decode(&entries); err != nil {
			return nil, err
		}
		out := make(map[string]any, len(entries))
		for key, entry := range entries {
			value, err := plainValueDepth(entry, depth+1, count)
			if err != nil {
				return nil, err
			}
			out[key] = value
		}
		return out, nil
	case composer.KindSequence:
		var items []composer.Node
		if err := node.Decode(&items); err != nil {
			return nil, err
		}
		out := make([]any, len(items))
		for i, item := range items {
			value, err := plainValueDepth(item, depth+1, count)
			if err != nil {
				return nil, err
			}
			out[i] = value
		}
		return out, nil
	default:
		return scalarValue(node)
	}
}

// scalarValue returns the typed value of a scalar node. Decode accepts each target type only for
// the matching kind of scalar, so the first that succeeds is the scalar's type.
func scalarValue(node composer.Node) (any, error) {
	var b bool
	if node.Decode(&b) == nil {
		return b, nil
	}
	var i int64
	if node.Decode(&i) == nil {
		return i, nil
	}
	var u uint64
	if node.Decode(&u) == nil {
		return u, nil
	}
	var f float64
	if node.Decode(&f) == nil {
		return f, nil
	}
	var s string
	if err := node.Decode(&s); err != nil {
		return nil, err
	}
	return s, nil
}
