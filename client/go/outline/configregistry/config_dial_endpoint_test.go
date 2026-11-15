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

package configregistry

import (
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func TestEndpointAddressErrorLocation(t *testing.T) {
	tests := []struct {
		name string
		yaml string
		path string
		line int
	}{
		{"scalar", "endpoint: example.com:0", "endpoint", 1},
		{"structured", "endpoint:\n  address: example.com:0", "endpoint.address", 2},
		{"alias", "shared: &address example.com:0\nendpoint: *address", "endpoint", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			node := testNode(t, tt.yaml)
			var fields map[string]composer.Node
			require.NoError(t, node.Decode(&fields))
			_, err := parseEndpointConfig(fields["endpoint"])
			require.ErrorContains(t, err, "port must not be zero")
			var located *composer.Error
			require.ErrorAs(t, err, &located)
			require.Equal(t, tt.path, located.Path)
			require.Equal(t, tt.line, located.Line)
		})
	}
}
