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

package composer_test

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func parseNode(t *testing.T, text string) composer.Node {
	t.Helper()
	node, err := composer.ParseYAML([]byte(text))
	require.NoError(t, err)
	return node
}

func fields(t *testing.T, node composer.Node) map[string]composer.Node {
	t.Helper()
	var result map[string]composer.Node
	require.NoError(t, node.Decode(&result))
	return result
}

func pointer[T any](value T) *T { return &value }

func TestNodeNestedParsing(t *testing.T) {
	for _, text := range []string{
		"transport:\n  endpoints:\n    - host: example.com\n      port: 443\n",
		`{"transport":{"endpoints":[{"host":"example.com","port":443}]}}`,
	} {
		root := parseNode(t, text)
		require.Equal(t, composer.KindMapping, root.Kind())
		transport := fields(t, root)["transport"]
		var endpoints []composer.Node
		require.NoError(t, fields(t, transport)["endpoints"].Decode(&endpoints))
		require.Len(t, endpoints, 1)
		require.Equal(t, "transport.endpoints[0]", endpoints[0].Path())
		endpoint := fields(t, endpoints[0])
		var host string
		var port uint16
		require.NoError(t, endpoint["host"].Decode(&host))
		require.NoError(t, endpoint["port"].Decode(&port))
		require.Equal(t, "example.com", host)
		require.Equal(t, uint16(443), port)
		var handedOff composer.Node
		require.NoError(t, endpoints[0].Decode(&handedOff))
		require.Equal(t, endpoints[0].Path(), handedOff.Path())
		require.Equal(t, endpoint["host"].Path(), fields(t, handedOff)["host"].Path())
	}
}

func TestNodePresenceAndLiteralKeys(t *testing.T) {
	root := parseNode(t, "null_value: null\nempty:\nzero: 0\n$type: example\npadding?: 32\n\"<<\": literal\n")
	values := fields(t, root)
	for _, key := range []string{"null_value", "empty"} {
		value, found := values[key]
		require.True(t, found)
		require.True(t, value.IsAbsent())
		require.Equal(t, key, value.Path())
	}
	missing, found := values["missing"]
	require.False(t, found)
	require.True(t, missing.IsAbsent())
	require.False(t, values["zero"].IsAbsent())
	for _, key := range []string{"$type", "padding?", "<<"} {
		_, found := values[key]
		require.True(t, found, key)
	}
	for _, text := range []string{"", "# only a comment", "null"} {
		require.Equal(t, composer.KindAbsent, parseNode(t, text).Kind())
	}
}

func TestNodeScalarDecoding(t *testing.T) {
	type port uint16
	type label string
	tests := []struct {
		text string
		out  any
		want any
	}{
		{`"hello"`, new(string), "hello"},
		{"|\n  first\n  second\n", new(string), "first\nsecond\n"},
		{"yes", new(string), "yes"},
		{"true", new(bool), true},
		{"false", pointer(true), false},
		{"0", pointer(9), 0},
		{"-128", new(int8), int8(-128)},
		{"255", new(uint8), uint8(255)},
		{"-9223372036854775808", new(int64), int64(math.MinInt64)},
		{"18446744073709551615", new(uint64), uint64(math.MaxUint64)},
		{"18446744073709551615", new(float64), float64(math.MaxUint64)},
		{"1.5", new(float32), float32(1.5)},
		{"1e2", new(float64), float64(100)},
		{"1E-2", new(float64), float64(0.01)},
		{"18446744073709551616", new(float64), float64(18446744073709551616.0)},
		{`"1e2"`, new(string), "1e2"},
		{"-2", new(float64), float64(-2)},
		{"443", new(port), port(443)},
		{"label", new(label), label("label")},
	}
	for _, test := range tests {
		t.Run(fmt.Sprintf("%s/%T", test.text, test.out), func(t *testing.T) {
			require.NoError(t, parseNode(t, test.text).Decode(test.out))
			require.Equal(t, test.want, reflect.ValueOf(test.out).Elem().Interface())
		})
	}
}

func TestNodeDecodeErrorsLeaveDestinationUnchanged(t *testing.T) {
	tests := []struct {
		text string
		out  any
	}{
		{"128", pointer(int8(7))},
		{"256", pointer(uint8(7))},
		{"-1", pointer(uint64(7))},
		{"9223372036854775808", pointer(int64(7))},
		{"18446744073709551616", pointer(uint64(7))},
		{"-9223372036854775809", pointer(int64(7))},
		{"1e2", pointer(7)},
		{"1e2", pointer("original")},
		{"1.0e999", pointer(float64(7))},
		{"1.0e999", pointer("original")},
		{"3.5e38", pointer(float32(7))},
		{".inf", pointer(float64(7))},
		{".nan", pointer(float64(7))},
		{"1.5", pointer(7)},
		{`"123"`, pointer(7)},
		{"123", pointer("original")},
		{"yes", pointer(true)},
		{"null", pointer(7)},
		{"[1]", pointer(7)},
		{"a: 1", pointer(7)},
	}
	for _, test := range tests {
		t.Run(fmt.Sprintf("%s/%T", test.text, test.out), func(t *testing.T) {
			before := reflect.ValueOf(test.out).Elem().Interface()
			require.Error(t, parseNode(t, test.text).Decode(test.out))
			require.Equal(t, before, reflect.ValueOf(test.out).Elem().Interface())
		})
	}
	for _, out := range []any{nil, 1, (*int)(nil), new(struct{ Value int }), new([]int), new(map[string]int)} {
		require.Error(t, parseNode(t, "1").Decode(out), "%T", out)
	}
	old := fields(t, parseNode(t, "existing: 1"))
	values := old
	require.Error(t, parseNode(t, "new: 2\nbad: *unknown").Decode(&values))
	require.Equal(t, old, values)
	items := []composer.Node{old["existing"]}
	require.Error(t, parseNode(t, "[new, *unknown]").Decode(&items))
	require.Equal(t, []composer.Node{old["existing"]}, items)
}

func TestNodeDelegatedAliases(t *testing.T) {
	root := parseNode(t, "endpoint: *defaults\ndefaults: &defaults\n  host: example.com\n  port: nope\n")
	endpoint := fields(t, root)["endpoint"]
	values := fields(t, endpoint)
	var host string
	require.NoError(t, values["host"].Decode(&host))
	require.Equal(t, "example.com", host)
	var port uint16
	err := values["port"].Decode(&port)
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "endpoint.port", located.Path)
	require.Equal(t, 4, located.Line)
	require.Positive(t, located.Column)
}

func TestNodeErrorWrapping(t *testing.T) {
	node := fields(t, parseNode(t, "port: 0"))["port"]
	cause := errors.New("port must be positive")
	err := node.WrapError(cause)
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.ErrorIs(t, err, cause)
	require.Equal(t, "port", located.Path)
	require.Equal(t, 1, located.Line)
	require.Contains(t, err.Error(), "port")
	require.Contains(t, err.Error(), cause.Error())
	outer := fmt.Errorf("invalid endpoint: %w", err)
	require.Same(t, outer, (composer.Node{}).WrapError(outer))
	require.NoError(t, node.WrapError(nil))
}

func TestNodeViewsAreIndependent(t *testing.T) {
	root := parseNode(t, "items: [first, second]")
	first := fields(t, root)
	delete(first, "items")
	var items []composer.Node
	require.NoError(t, fields(t, root)["items"].Decode(&items))
	require.Equal(t, composer.KindSequence, fields(t, root)["items"].Kind())
	items[0] = composer.Node{}
	require.NoError(t, fields(t, root)["items"].Decode(&items))
	var value string
	require.NoError(t, items[0].Decode(&value))
	require.Equal(t, "first", value)

	var wg sync.WaitGroup
	results := make(chan error, 16)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var view map[string]composer.Node
			results <- root.Decode(&view)
			delete(view, "items")
		}()
	}
	wg.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	_, found := fields(t, root)["items"]
	require.True(t, found)
}

func TestNodeInvalidDocumentsAndMappings(t *testing.T) {
	for _, text := range []string{"a: [1", "a: 1\n---\nb: 2", "!!seq [1]", "!!str 123", "a: &same 1\nb: &same 2"} {
		_, err := composer.ParseYAML([]byte(text))
		require.Error(t, err)
	}
	for _, text := range []string{
		"1: value", "1e2: value", "true: value", "a: 1\na: 2", "a: 1\n\"a\": 2",
		"<<: {a: 1}", "endpoint: *unknown",
	} {
		t.Run(text, func(t *testing.T) {
			node, err := composer.ParseYAML([]byte(text))
			if err == nil {
				var values map[string]composer.Node
				err = node.Decode(&values)
			}
			require.Error(t, err)
		})
	}
}

func TestNodeQuotedNumericKeys(t *testing.T) {
	values := fields(t, parseNode(t, `{"1e2": 1, "18446744073709551616": 2}`))
	require.Len(t, values, 2)
	for key, node := range values {
		require.Equal(t, fmt.Sprintf("[%q]", key), node.Path())
	}
}

func TestNodeBoundsRecursiveTraversal(t *testing.T) {
	node, err := composer.ParseYAML([]byte("&cycle {child: *cycle}"))
	for i := 0; err == nil && i < 1000; i++ {
		var values map[string]composer.Node
		err = node.Decode(&values)
		node = values["child"]
	}
	require.Error(t, err, "recursive aliases must not permit unbounded descent")

	_, err = composer.ParseYAML([]byte(strings.Repeat("[", 300) + "0" + strings.Repeat("]", 300)))
	require.Error(t, err, "excessive syntax nesting must be rejected")
}
