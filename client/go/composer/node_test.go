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

package composer

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func mustParse(t *testing.T, text string) Node {
	t.Helper()
	n, err := ParseYAML([]byte(text))
	require.NoError(t, err)
	return n
}

func TestParseYAML_Kinds(t *testing.T) {
	require.Equal(t, KindMapping, mustParse(t, "a: 1").Kind())
	require.Equal(t, KindMapping, mustParse(t, "a: 1\nb: 2").Kind())
	require.Equal(t, KindSequence, mustParse(t, "- 1\n- 2").Kind())
	require.Equal(t, KindScalar, mustParse(t, `"hello"`).Kind())
	require.Equal(t, KindAbsent, mustParse(t, "").Kind())
	require.Equal(t, KindAbsent, mustParse(t, "null").Kind())
	require.True(t, Node{}.IsAbsent())
}

func TestParseYAML_Invalid(t *testing.T) {
	_, err := ParseYAML([]byte("a: [1, 2"))
	require.Error(t, err)
}

func TestParseYAML_RejectsDuplicateKeysAndStreams(t *testing.T) {
	_, err := ParseYAML([]byte("a: 1\na: 2"))
	require.ErrorContains(t, err, "already defined")

	_, err = ParseYAML([]byte("a: 1\n---\nb: 2"))
	require.ErrorContains(t, err, "multi-document")
}

func TestDecode_RejectsTags(t *testing.T) {
	var out struct{ A string }
	err := mustParse(t, "a: !!str 5").Decode(&out)
	require.ErrorContains(t, err, "YAML tags are not supported")
}

func TestNode_MappingEntries(t *testing.T) {
	n := mustParse(t, "cipher: aes\nsecret: s3cret")
	entries, err := n.mappingEntries()
	require.NoError(t, err)
	require.Len(t, entries, 2)
	require.Equal(t, "cipher", entries[0].key)
	require.Equal(t, "cipher", entries[0].value.Path())
	require.Equal(t, KindScalar, entries[0].value.Kind())

	// Single-pair mapping.
	n = mustParse(t, "only: 1")
	entries, err = n.mappingEntries()
	require.NoError(t, err)
	require.Len(t, entries, 1)

	// Not a mapping.
	_, err = mustParse(t, "- 1").mappingEntries()
	require.Error(t, err)
}

func TestNode_SequenceItems(t *testing.T) {
	n := mustParse(t, "options:\n  - a: 1\n  - b: 2")
	entries, err := n.mappingEntries()
	require.NoError(t, err)
	items, err := entries[0].value.sequenceItems()
	require.NoError(t, err)
	require.Len(t, items, 2)
	require.Equal(t, "options[1]", items[1].Path())
}

func TestNode_AliasResolution(t *testing.T) {
	n := mustParse(t, "proxy: &p\n  host: example.com\nendpoint: *p")
	entries, err := n.mappingEntries()
	require.NoError(t, err)
	require.Equal(t, KindMapping, entries[0].value.Kind())
	// The alias resolves to the same mapping content.
	require.Equal(t, KindMapping, entries[1].value.Kind())
	sub, err := entries[1].value.mappingEntries()
	require.NoError(t, err)
	require.Equal(t, "host", sub[0].key)
}

func TestNode_AliasUnknown(t *testing.T) {
	n := mustParse(t, "a: *nowhere")
	_, err := n.mappingEntries()
	require.Error(t, err)
	require.Contains(t, err.Error(), "nowhere")
}

func TestNode_AliasCycles(t *testing.T) {
	// goccy rejects an anchor whose value is an alias at parse time, so
	// direct alias-to-alias chains cannot be constructed. The composer
	// maxAliasDepth guard is defense-in-depth behind this.
	_, err := ParseYAML([]byte("a: &x *x"))
	require.Error(t, err)

	// Mutually recursive anchors survive parsing; navigating any finite
	// number of levels works, and Decode's depth/visit budgets bound
	// traversal (see decode tests).
	n := mustParse(t, "a: &x\n  b: *y\nc: &y\n  d: *x")
	entries, err := n.mappingEntries()
	require.NoError(t, err)
	sub, err := entries[0].value.mappingEntries() // a -> {b: *y}
	require.NoError(t, err)
	require.Equal(t, KindMapping, sub[0].value.Kind())
}

func TestError_Format(t *testing.T) {
	err := &Error{Path: "transport.endpoint", Line: 12, Err: errors.New("boom")}
	require.Equal(t, "transport.endpoint (line 12): boom", err.Error())
	require.ErrorContains(t, &Error{Err: errors.New("boom")}, "boom")
	require.ErrorIs(t, err, err.Err)
}

func TestNode_Text(t *testing.T) {
	n := mustParse(t, "plain: 8080\nquoted: \"8080\"\nhex: 0x10\nfloat: 1.50\nflag: true\nblock: |\n  two\n  lines\nlist: [1]\nnothing:")
	entries, err := n.mappingEntries()
	require.NoError(t, err)
	want := map[string]string{"plain": "8080", "quoted": "8080", "hex": "0x10", "float": "1.50", "flag": "true", "block": "two\nlines\n"}
	for _, e := range entries {
		text, err := e.value.Text()
		if expected, ok := want[e.key]; ok {
			require.NoError(t, err, e.key)
			require.Equal(t, expected, text, e.key)
		} else {
			require.Error(t, err, e.key)
		}
	}
}
