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
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func TestDecodeExistingSchema(t *testing.T) {
	type Config struct {
		Field1 string
		Field2 int
	}
	for _, test := range []struct {
		text string
		want Config
	}{
		{"{}", Config{}},
		{"field1: value1", Config{Field1: "value1"}},
		{"field2: 2", Config{Field2: 2}},
		{"field1: value1\nfield2: 2", Config{Field1: "value1", Field2: 2}},
		{"field1: 10", Config{Field1: "10"}},
		{"field1: true", Config{Field1: "true"}},
		{"field1: 1.5", Config{Field1: "1.5"}},
		{"field1: 1000000.0", Config{Field1: "1000000"}},
		{"field1: 1.5e+6", Config{Field1: "1500000"}},
		{"field1: 0.00001", Config{Field1: "1e-05"}},
		{"field1: 0.0000001", Config{Field1: "1e-7"}},
		{"field1: -0.0", Config{Field1: "0"}},
		{"field1: 1e6", Config{Field1: "1e6"}},
		{"field1: 1e+6", Config{Field1: "1e+6"}},
		{"field1: 1e-6", Config{Field1: "1e-6"}},
		{"field1: 18446744073709551616", Config{Field1: "18446744073709551616"}},
		{"$type: example\n$defs: {unused: anything}", Config{}},
	} {
		var got Config
		require.NoError(t, Decode(parseNode(t, test.text), &got), test.text)
		require.Equal(t, test.want, got, test.text)
	}
	defaults := Config{Field1: "default", Field2: 8}
	require.NoError(t, Decode(parseNode(t, "field1: null"), &defaults))
	require.Equal(t, Config{Field1: "default", Field2: 8}, defaults)
	for _, text := range []string{"field2: invalid", "field3: unknown", "Field1: uppercase", "FIELD1: uppercase", "field1: []"} {
		var got Config
		require.Error(t, Decode(parseNode(t, text), &got), text)
	}
}

func TestDecodeSchemaTagsAndNestedCollections(t *testing.T) {
	type Entry struct {
		Name  string `yaml:"label"`
		Value composer.Node
	}
	type Base struct{ Enabled bool }
	var config struct {
		Base    `yaml:",inline"`
		Entries []Entry `yaml:"entries,omitempty"`
		Headers map[string][]string
		Ignored string `yaml:"-"`
		Pointer *Entry
	}
	require.NoError(t, Decode(parseNode(t, `enabled: true
entries:
  - label: first
    value: *shared
headers: {User-Agent: [test, 42, true, null]}
pointer: {label: second}
$defs: &shared {endpoint: example.com:443}
`), &config))
	require.True(t, config.Enabled)
	require.Equal(t, "first", config.Entries[0].Name)
	require.Equal(t, "entries[0].value", config.Entries[0].Value.Path())
	var child struct{ Endpoint string }
	require.NoError(t, Decode(config.Entries[0].Value, &child))
	require.Equal(t, "example.com:443", child.Endpoint)
	require.Equal(t, []string{"test", "42", "true", ""}, config.Headers["User-Agent"])
	require.Equal(t, "second", config.Pointer.Name)
	require.Error(t, Decode(parseNode(t, "ignored: no"), &config))
	require.NoError(t, Decode(parseNode(t, "entries: null\npointer: null"), &config))
	require.Len(t, config.Entries, 1, "null preserves existing defaults")
	require.Nil(t, config.Pointer, "null clears pointer fields as in the existing decoder")
}

func TestDecodeReportsNestedSource(t *testing.T) {
	for _, key := range []string{"port", "unknown", "$unknown"} {
		node := parseNode(t, "entries:\n  - "+key+": invalid")
		var config struct{ Entries []struct{ Port uint16 } }
		err := Decode(node, &config)
		var located *composer.Error
		require.ErrorAs(t, err, &located)
		wantPath := "entries[0]." + key
		if key == "$unknown" {
			wantPath = `entries[0]["$unknown"]`
		}
		require.Equal(t, wantPath, located.Path)
		require.Equal(t, 2, located.Line)
		require.Positive(t, located.Column)
	}
}

func TestDecodeKeepsAbsentNodesAndDoesNotChangeNodeScalarRules(t *testing.T) {
	var config struct {
		Present composer.Node
		Missing composer.Node
	}
	require.NoError(t, Decode(parseNode(t, "present: null"), &config))
	require.True(t, config.Present.IsAbsent())
	require.Equal(t, "present", config.Present.Path())
	require.True(t, config.Missing.IsAbsent())
	require.Empty(t, config.Missing.Path())
	node := parseNode(t, "42")
	var text string
	require.NoError(t, Decode(node, &text))
	require.Equal(t, "42", text)
	require.Error(t, node.Decode(&text))
	for _, target := range []any{nil, 1, (*int)(nil)} {
		require.Error(t, Decode(node, target))
	}
}

func TestDecodeRecursiveAliasIsBounded(t *testing.T) {
	type Recursive struct{ Children []Recursive }
	var config Recursive
	require.Error(t, Decode(parseNode(t, "&cycle {children: [*cycle]}"), &config))
}

func TestDecodeLegacyNumericFields(t *testing.T) {
	type Config struct {
		Port  uint16
		Count int
		Ratio float64
	}
	for _, text := range []string{
		`port: 4321`, `port: "4321"`, `port: 4321.0`, `port: "4.321e3"`,
		`port: 4321.9`, `port: "4321.9"`,
	} {
		var config Config
		require.NoError(t, Decode(parseNode(t, text), &config), text)
		require.Equal(t, uint16(4321), config.Port, text)
	}
	var config Config
	require.NoError(t, Decode(parseNode(t, `count: -3.5
ratio: "1.25"`), &config))
	require.Equal(t, -3, config.Count)
	require.Equal(t, 1.25, config.Ratio)
	for _, text := range []string{
		`port: -1`, `port: "-1"`, `port: 65536`, `port: "65536"`,
		`port: 65536.0`, `port: true`, `port: bad`, `port: .inf`,
		`count: "-1"`, `ratio: "invalid"`,
	} {
		require.Error(t, Decode(parseNode(t, text), &config), text)
	}
}
