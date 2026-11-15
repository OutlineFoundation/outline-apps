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
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func parseNode(t *testing.T, text string) composer.Node {
	t.Helper()
	node, err := ParseConfigYAML(text)
	require.NoError(t, err)
	return node
}

func TestTypeParserFallback(t *testing.T) {
	ctx := context.WithValue(context.Background(), struct{}{}, "context")
	for _, text := range []string{"", "null", "value", "{}", "[value]"} {
		input := parseNode(t, text)
		calls := 0
		parser := NewTypeParser(func(gotCtx context.Context, got composer.Node) (string, error) {
			calls++
			require.Equal(t, ctx, gotCtx)
			require.Equal(t, input, got)
			return "fallback", nil
		})
		got, err := parser.Parse(ctx, input)
		require.NoError(t, err)
		require.Equal(t, "fallback", got)
		require.Equal(t, 1, calls)
	}
}

func TestTypeParserDispatchReturnsRuntimeObject(t *testing.T) {
	parser := NewTypeParser(func(context.Context, composer.Node) (map[string]string, error) {
		t.Fatal("registered parser must bypass fallback")
		return nil, nil
	})
	parser.RegisterSubParser("example", func(_ context.Context, node composer.Node) (map[string]string, error) {
		var fields map[string]composer.Node
		require.NoError(t, node.Decode(&fields))
		require.Contains(t, fields, ConfigTypeKey, "the original node is retained")
		var config struct{ Value string }
		require.NoError(t, Decode(node, &config))
		return map[string]string{ConfigTypeKey: "runtime-value", "value": config.Value}, nil
	})
	result, err := parser.Parse(context.Background(), parseNode(t, "$type: example\nvalue: configured"))
	require.NoError(t, err)
	require.Equal(t, map[string]string{ConfigTypeKey: "runtime-value", "value": "configured"}, result)
}

func TestTypeParserErrorsPreserveSourceAndClassification(t *testing.T) {
	sentinel := errors.New("failed to build")
	parser := NewTypeParser(func(context.Context, composer.Node) (string, error) { return "", sentinel })
	parser.RegisterSubParser("failure", func(context.Context, composer.Node) (string, error) { return "", sentinel })
	for _, test := range []struct {
		text, path string
		cause      error
	}{
		{"transport: {$type: missing}", `transport["$type"]`, errors.ErrUnsupported},
		{"transport: {$type: failure}", "transport", sentinel},
		{"transport: fallback", "transport", sentinel},
	} {
		var fields map[string]composer.Node
		require.NoError(t, parseNode(t, test.text).Decode(&fields))
		_, err := parser.Parse(context.Background(), fields["transport"])
		require.ErrorIs(t, err, test.cause)
		var located *composer.Error
		require.ErrorAs(t, err, &located)
		require.Equal(t, test.path, located.Path)
		require.Equal(t, 1, located.Line)
	}
	for _, name := range []string{"null", "10", "true", "[]", "{}"} {
		_, err := parser.Parse(context.Background(), parseNode(t, fmt.Sprintf("$type: %s", name)))
		require.ErrorContains(t, err, "parser name must be a string")
		var located *composer.Error
		require.ErrorAs(t, err, &located)
		require.Equal(t, `["$type"]`, located.Path)
	}
}

func TestTypeParserDelegationRetainsAnchorsAndChildError(t *testing.T) {
	parser := NewTypeParser(func(context.Context, composer.Node) (int, error) { return 0, nil })
	parser.RegisterSubParser("number", func(_ context.Context, node composer.Node) (int, error) {
		var config struct{ Value composer.Node }
		if err := Decode(node, &config); err != nil {
			return 0, err
		}
		var value int
		err := config.Value.Decode(&value)
		return value, err
	})
	var fields map[string]composer.Node
	require.NoError(t, parseNode(t, "$defs: &value nope\ntransport: {$type: number, value: *value}").Decode(&fields))
	_, err := parser.Parse(context.Background(), fields["transport"])
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "transport.value", located.Path)
	require.Equal(t, 1, located.Line)
}
