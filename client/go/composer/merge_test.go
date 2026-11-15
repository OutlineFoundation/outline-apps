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
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func TestNodeMergePrecedenceAndSource(t *testing.T) {
	root := parseNode(t, `$defs:
  first: &first {host: first, port: invalid}
  second: &second {host: second, extra: second}
endpoint:
  host: explicit
  <<: [*first, *second]
other:
  <<: [*first, *second]
  extra: explicit
`)
	values := fields(t, root)
	endpoint := fields(t, values["endpoint"])
	require.Len(t, endpoint, 3)
	var text string
	require.NoError(t, endpoint["host"].Decode(&text))
	require.Equal(t, "second", text, "a later merge replaces an earlier explicit field")
	require.NoError(t, endpoint["extra"].Decode(&text))
	require.Equal(t, "second", text)
	other := fields(t, values["other"])
	require.NoError(t, other["host"].Decode(&text))
	require.Equal(t, "second", text, "later merge sources win, preserving existing client configs")
	require.NoError(t, other["extra"].Decode(&text))
	require.Equal(t, "explicit", text, "explicit fields win after a merge too")
	var port uint16
	var located *composer.Error
	require.ErrorAs(t, endpoint["port"].Decode(&port), &located)
	require.Equal(t, "endpoint.port", located.Path)
	require.Equal(t, 2, located.Line, "merged values retain their definition's position")
	delete(endpoint, "host")
	require.Contains(t, fields(t, values["endpoint"]), "host", "merge views are independent")
}

func TestNodeNestedAndLiteralMerges(t *testing.T) {
	values := fields(t, parseNode(t, `"<<": literal
nested:
  <<: {<<: {address: example.com:443}}
`))
	var text string
	require.NoError(t, values["<<"].Decode(&text))
	require.Equal(t, "literal", text)
	address := fields(t, values["nested"])["address"]
	require.NoError(t, address.Decode(&text))
	require.Equal(t, "example.com:443", text)
	require.Equal(t, "nested.address", address.Path())
}

func TestNodeRejectsInvalidAndCyclicMerges(t *testing.T) {
	for _, text := range []string{
		"<<: scalar", "<<: null", "<<: [null]", "<<: [[{}]]",
		"&cycle {<<: *cycle}",
		"a: &a {<<: *b}\nb: &b {<<: *a}\n<<: *a",
	} {
		t.Run(text, func(t *testing.T) {
			node := parseNode(t, text)
			var values map[string]composer.Node
			require.Error(t, node.Decode(&values))
			require.Nil(t, values)
		})
	}
}

func TestNodeMergeExpansionIsBounded(t *testing.T) {
	for _, test := range []struct {
		levels, copies int
		message        string
	}{
		{21, 1, "merge key nesting exceeds"},
		{17, 2, "merge expansion exceeds"},
	} {
		var text strings.Builder
		text.WriteString("a0: &a0 {value: original}\n")
		for i := 1; i <= test.levels; i++ {
			fmt.Fprintf(&text, "a%d: &a%d {<<: [%s]}\n", i, i, strings.TrimSuffix(strings.Repeat(fmt.Sprintf("*a%d,", i-1), test.copies), ","))
		}
		fmt.Fprintf(&text, "result: *a%d\n", test.levels)
		node := fields(t, parseNode(t, text.String()))["result"]
		var values map[string]composer.Node
		require.ErrorContains(t, node.Decode(&values), test.message)
		require.Nil(t, values)
	}
}

func TestNodeWithStringPreservesOrigin(t *testing.T) {
	source := fields(t, parseNode(t, "endpoint: https://example.com:443"))["endpoint"]
	for _, text := range []string{"example.com:443", "123", "1e2", "true", "null", ""} {
		derived := source.WithString(text)
		var value string
		require.NoError(t, derived.Decode(&value))
		require.Equal(t, text, value)
		require.Equal(t, source.Path(), derived.Path())
		var located *composer.Error
		require.ErrorAs(t, derived.WrapError(errors.New("invalid endpoint")), &located)
		require.Equal(t, "endpoint", located.Path)
		require.Equal(t, 1, located.Line)
		require.Equal(t, 11, located.Column)
		var number int
		require.Error(t, derived.Decode(&number), "derived strings must not become numbers")
	}
	var original string
	require.NoError(t, source.Decode(&original))
	require.Equal(t, "https://example.com:443", original)
	require.NoError(t, (composer.Node{}).WithString("default").Decode(&original))
	require.Equal(t, "default", original)
}
