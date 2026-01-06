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

package configyaml

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/goccy/go-yaml"
)

// ConfigTypeKey is the config key used to specify the type of the config in order to select the corresponding parser.
const ConfigTypeKey = "$type"

// ConfigNode represents an intermediate config node. It's typically one of the types supported by YAML (list, map, scalar)
// but it can be arbitrary objects returned by parsers as well.
type ConfigNode any

// ParseFunc takes a [ConfigNode] and returns an object of the given type.
type ParseFunc[OutputType any] func(ctx context.Context, input ConfigNode) (OutputType, error)

// ParseConfigYAML takes a YAML config string and returns it as an object that the type parsers can use.
func ParseConfigYAML(configText string) (ConfigNode, error) {
	var node any
	if err := yaml.Unmarshal([]byte(configText), &node); err != nil {
		return nil, err
	}
	return node, nil
}

// MapToAny marshalls a map into a struct. It's a helper for parsers that want to
// map config maps into their config structures.
func MapToAny(in map[string]any, out any) error {
	newMap := make(map[string]any)
	for k, v := range in {
		if len(k) > 0 && k[0] == '$' {
			// Skip $ keys
			continue
		}
		newMap[k] = v
	}
	// Use JSON marshaling from the standard library because the YAML library is buggy.
	// See https://github.com/OutlineFoundation/outline-apps/issues/2576.
	// JSON is a subset of YAML, so that's valid YAML.
	yamlText, err := json.Marshal(newMap)
	if err != nil {
		return fmt.Errorf("error marshaling to YAML: %w", err)
	}
	decoder := yaml.NewDecoder(bytes.NewReader(yamlText), yaml.DisallowUnknownField())
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("error decoding YAML: %w", err)
	}
	return nil
}

// TypeParser creates objects of the given type T from an input config.
// You can register type-specific sub-parsers that get called when marked in the config.
// The default value is not valid. Use [NewTypeParser] instead.
type TypeParser[T any] struct {
	fallbackHandler ParseFunc[T]
	subparsers      map[string]func(context.Context, map[string]any) (T, error)
}

var _ ParseFunc[any] = (*TypeParser[any])(nil).Parse

// NewTypeParser creates a [TypeParser] that calls the fallbackHandler if there's no parser specified in the config.
func NewTypeParser[T any](fallbackHandler func(context.Context, ConfigNode) (T, error)) *TypeParser[T] {
	return &TypeParser[T]{
		fallbackHandler: fallbackHandler,
		subparsers:      make(map[string]func(context.Context, map[string]any) (T, error)),
	}
}

// Parse implements [ParseFunc] for the type T.
func (p *TypeParser[T]) Parse(ctx context.Context, config ConfigNode) (T, error) {
	var zero T

	// Iterate while the input is a function call.
	for {
		inMap, ok := config.(map[string]any)
		if !ok {
			break
		}
		parserNameAny, ok := inMap[ConfigTypeKey]
		if !ok {
			break
		}
		parserName, ok := parserNameAny.(string)
		if !ok {
			return zero, fmt.Errorf("parser name must be a string, found \"%T\"", parserNameAny)
		}
		parser, ok := p.subparsers[parserName]
		if !ok {
			return zero, fmt.Errorf("parser \"%v\" for type %T is not available: %w", parserName, zero, errors.ErrUnsupported)
		}

		// $type is embedded in the value: {$type: ..., ...}.
		// Need to copy value and remove the type directive.
		inputCopy := make(map[string]any, len(inMap))
		for k, v := range inMap {
			if k == ConfigTypeKey {
				continue
			}
			inputCopy[k] = v
		}

		var err error
		config, err = parser(ctx, inputCopy)
		if err != nil {
			return zero, fmt.Errorf("parser \"%v\" failed: %w", parserName, err)
		}
	}

	typed, ok := config.(T)
	if ok {
		return typed, nil
	}

	// Input is an intermediate type. We need a fallback handler.
	return p.fallbackHandler(ctx, config)
}

// RegisterSubParser registers the given subparser function with the given name for the type T.
// Note that a subparser always take a map[string]any, not [ConfigNode], since we must have a map[string]any in
// order to set the value for the ConfigParserKey.
func (p *TypeParser[T]) RegisterSubParser(name string, function func(context.Context, map[string]any) (T, error)) {
	p.subparsers[name] = function
}
