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
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

func TestFirstSupportedPreservesChildNodes(t *testing.T) {
	root := testNode(t, `shared: &supported {value: accepted}
transport:
  options:
    - unavailable
    - *supported
`)
	var fields map[string]composer.Node
	require.NoError(t, root.Decode(&fields))
	var paths []string
	parse := func(ctx context.Context, node composer.Node) (string, error) {
		paths = append(paths, node.Path())
		if node.Kind() == composer.KindScalar {
			return "", node.WrapError(errors.ErrUnsupported)
		}
		var config struct{ Value string }
		err := (composer.Decoder{CoerceScalars: true}).Decode(node, &config)
		return config.Value, err
	}

	value, err := NewFirstSupportedSubParser(parse)(context.Background(), fields["transport"])
	require.NoError(t, err)
	require.Equal(t, "accepted", value)
	require.Equal(t, []string{"transport.options[0]", "transport.options[1]"}, paths)
}

func TestFirstSupportedStopsAtMalformedOption(t *testing.T) {
	node := testNode(t, "options: [true, accepted]")
	calls := 0
	parse := func(ctx context.Context, node composer.Node) (string, error) {
		calls++
		var value string
		err := node.Decode(&value)
		return value, err
	}
	_, err := NewFirstSupportedSubParser(parse)(context.Background(), node)
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "options[0]", located.Path)
	require.Equal(t, 1, located.Line)
	require.Equal(t, 1, calls)
}
