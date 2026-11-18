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
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

func TestWebsocketDefaultEndpointRetainsURLLocation(t *testing.T) {
	root := testNode(t, "endpoint:\n  url: wss://example.com/tunnel")
	var fields map[string]composer.Node
	require.NoError(t, root.Decode(&fields))
	parseEndpoint := func(ctx context.Context, node composer.Node) (*Endpoint[transport.StreamConn], error) {
		require.Equal(t, "endpoint.url", node.Path())
		var address string
		require.NoError(t, node.Decode(&address))
		require.Equal(t, "example.com:443", address)
		return nil, node.WrapError(context.Canceled)
	}
	_, err := NewWebsocketStreamEndpointSubParser(parseEndpoint)(context.Background(), fields["endpoint"])
	require.ErrorIs(t, err, context.Canceled)
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "endpoint.url", located.Path)
	require.Equal(t, 2, located.Line)
}
