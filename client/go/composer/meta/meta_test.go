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

package meta

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type nodeA struct{ x int }
type info struct{ Hop string }

func TestTable_SetGet(t *testing.T) {
	ctx, table := WithTable(context.Background())
	require.Same(t, table, FromContext(ctx))

	n := &nodeA{}
	table.Set(n, info{Hop: "example.com:443"})
	got, ok := Get[info](table, n)
	require.True(t, ok)
	require.Equal(t, "example.com:443", got.Hop)

	// Identity, not equality: a different pointer misses.
	_, ok = Get[info](table, &nodeA{})
	require.False(t, ok)

	// Wrong type misses.
	_, ok = Get[string](table, n)
	require.False(t, ok)
}

func TestFromContext_Absent(t *testing.T) {
	require.Nil(t, FromContext(context.Background()))
	_, ok := Get[info](nil, &nodeA{})
	require.False(t, ok)
}

func TestTables_ArePerContext(t *testing.T) {
	_, t1 := WithTable(context.Background())
	_, t2 := WithTable(context.Background())
	n := &nodeA{}
	t1.Set(n, info{Hop: "a"})
	_, ok := Get[info](t2, n)
	require.False(t, ok)
}
