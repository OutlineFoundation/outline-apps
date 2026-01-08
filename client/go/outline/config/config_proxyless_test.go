// Copyright 2025 The Outline Authors
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

package config

import (
	"context"
	"testing"

	"localhost/client/go/configyaml"
	"github.com/stretchr/testify/require"
)

func TestParseProxyless(t *testing.T) {
	provider := newTestTransportProvider()

	node, err := configyaml.ParseConfigYAML(`$type: basic-access`)
	require.NoError(t, err)

	transportPair, err := provider.Parse(context.Background(), node)
	require.NoError(t, err)
	require.NotNil(t, transportPair)
	require.NotNil(t, transportPair.StreamDialer)
	require.NotNil(t, transportPair.PacketProxy)
	require.Equal(t, ConnTypeDirect, transportPair.StreamDialer.ConnType)
	require.Equal(t, ConnTypeDirect, transportPair.PacketProxy.ConnType)
}
