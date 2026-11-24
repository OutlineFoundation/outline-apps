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
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func TestNodeMarshalJSON(t *testing.T) {
	node := parseNode(t, `$defs: &base {port: 80, host: inherited}
endpoint:
  port: 443
  <<: [*base, {host: later}]
values: [true, null, 1.5, 18446744073709551616, "123", "SSH-2.0\r\n"]
`)
	data, err := json.Marshal(node)
	require.NoError(t, err)
	require.Equal(t, `{"$defs":{"host":"inherited","port":80},"endpoint":{"host":"inherited","port":443},"values":[true,null,1.5,18446744073709551616,"123","SSH-2.0\r\n"]}`, string(data))
	var fields map[string]composer.Node
	require.NoError(t, node.Decode(&fields))
	wrapped, err := json.Marshal(map[string]composer.Node{"transport": fields["endpoint"]})
	require.NoError(t, err)
	require.Equal(t, `{"transport":{"host":"inherited","port":443}}`, string(wrapped))
}

func TestNodeMarshalJSONScalars(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"", "null"}, {"null", "null"}, {"true", "true"},
		{"0x10", "16"}, {"1e6", "1e6"}, {`"1e6"`, `"1e6"`},
		{"0.00001", "0.00001"}, {"18446744073709551616", "18446744073709551616"},
	} {
		data, err := json.Marshal(parseNode(t, test.source))
		require.NoError(t, err, test.source)
		require.Equal(t, test.want, string(data), test.source)
	}
}

func TestNodeMarshalJSONErrorLocation(t *testing.T) {
	_, err := json.Marshal(parseNode(t, "entry:\n  value: .nan"))
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "entry.value", located.Path)
	require.Equal(t, 2, located.Line)
}

func TestNodeMarshalJSONBoundsExpansion(t *testing.T) {
	node := parseNode(t, "&cycle {child: *cycle}")
	_, err := json.Marshal(node)
	require.ErrorContains(t, err, "node nesting exceeds")

	// A small document can describe more than 100,000 expanded values.
	text := "base: &base [" + strings.Repeat("0,", 100) + "]\nrepeated: [" + strings.Repeat("*base,", 1000) + "]"
	_, err = json.Marshal(parseNode(t, text))
	require.ErrorContains(t, err, "config normalization exceeds")
}
