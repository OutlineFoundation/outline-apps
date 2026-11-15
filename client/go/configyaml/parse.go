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
	"context"
	"errors"
	"fmt"

	"localhost/client/go/composer"
)

// ConfigTypeKey is the config key used to select the corresponding parser.
const ConfigTypeKey = "$type"

// ConfigNode is a configuration value that retains its source and document anchors.
type ConfigNode = composer.Node

// ParseFunc takes a configuration node and returns an object of the given type.
type ParseFunc[OutputType any] func(ctx context.Context, input composer.Node) (OutputType, error)

// ParseConfigYAML parses a YAML or JSON configuration for the type parsers.
func ParseConfigYAML(configText string) (composer.Node, error) {
	return composer.ParseYAML([]byte(configText))
}

// TypeParser creates objects of the given type T from an input config.
// You can register type-specific sub-parsers selected by the config's $type.
// The default value is not valid. Use [NewTypeParser] instead.
type TypeParser[T any] struct {
	fallbackHandler ParseFunc[T]
	subparsers      map[string]ParseFunc[T]
}

var _ ParseFunc[any] = (*TypeParser[any])(nil).Parse

// NewTypeParser creates a parser that calls fallbackHandler when no $type is specified.
func NewTypeParser[T any](fallbackHandler ParseFunc[T]) *TypeParser[T] {
	return &TypeParser[T]{fallbackHandler: fallbackHandler, subparsers: make(map[string]ParseFunc[T])}
}

// Parse implements [ParseFunc] for the type T. Registered parsers receive the
// original node, including $type; [Decode] skips reserved $ keys in a schema.
func (p *TypeParser[T]) Parse(ctx context.Context, config composer.Node) (T, error) {
	var zero T
	if config.Kind() == composer.KindMapping {
		var fields map[string]composer.Node
		if err := config.Decode(&fields); err != nil {
			return zero, err
		}
		if typeNode, found := fields[ConfigTypeKey]; found {
			var name string
			if err := typeNode.Decode(&name); err != nil {
				return zero, fmt.Errorf("parser name must be a string: %w", err)
			}
			parser, found := p.subparsers[name]
			if !found {
				return zero, typeNode.WrapError(fmt.Errorf("parser %q for type %T is not available: %w", name, zero, errors.ErrUnsupported))
			}
			result, err := parser(ctx, config)
			if err != nil {
				return zero, config.WrapError(fmt.Errorf("parser %q failed: %w", name, err))
			}
			return result, nil
		}
	}
	result, err := p.fallbackHandler(ctx, config)
	return result, config.WrapError(err)
}

// RegisterSubParser registers the parser selected by name in the $type field.
func (p *TypeParser[T]) RegisterSubParser(name string, function ParseFunc[T]) {
	p.subparsers[name] = function
}
