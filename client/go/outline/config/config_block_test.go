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

	"github.com/stretchr/testify/require"
)

func TestNewBlockStreamDialerSubParser(t *testing.T) {
	subParser := NewBlockStreamDialerSubParser()

	dialer, err := subParser(context.Background(), nil)
	require.NoError(t, err)
	require.NotNil(t, dialer)

	require.Equal(t, ConnTypeBlocked, dialer.ConnType)

	_, err = dialer.Dial(context.Background(), "example.com:1234")
	require.Error(t, err)
	require.ErrorContains(t, err, "blocked by config")
}
