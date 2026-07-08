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
	"testing"

	"github.com/stretchr/testify/require"
)

func decodeAll[T any](t *testing.T, yamlText string) T {
	t.Helper()
	var out T
	require.NoError(t, mustParse(t, yamlText).Decode(&out))
	return out
}

func TestDecode_Scalars(t *testing.T) {
	require.Equal(t, "hello", decodeAll[string](t, "hello"))
	require.Equal(t, "line1\nline2\n", decodeAll[string](t, "|\n  line1\n  line2\n"))
	require.Equal(t, 443, decodeAll[int](t, "443"))
	require.Equal(t, -7, decodeAll[int](t, "-7"))
	require.Equal(t, uint16(8080), decodeAll[uint16](t, "8080"))
	require.Equal(t, 1.5, decodeAll[float64](t, "1.5"))
	require.Equal(t, 2.0, decodeAll[float64](t, "2"))
	require.Equal(t, true, decodeAll[bool](t, "true"))
}

func TestDecode_ScalarErrors(t *testing.T) {
	var s string
	require.Error(t, mustParse(t, "443").Decode(&s), "no int->string coercion")

	var i int
	require.Error(t, mustParse(t, `"443"`).Decode(&i), "no string->int coercion")

	var i8 int8
	require.Error(t, mustParse(t, "1000").Decode(&i8), "int8 range check")

	var u uint16
	require.Error(t, mustParse(t, "70000").Decode(&u), "uint16 range check")
	require.Error(t, mustParse(t, "-1").Decode(&u), "negative into uint")

	var b bool
	require.Error(t, mustParse(t, "yes").Decode(&b), "only true/false are bool")

	require.Error(t, mustParse(t, "1").Decode(i), "out must be a pointer")

	var missing int
	require.Error(t, mustParse(t, "").Decode(&missing), "absent into required scalar")
}

func TestDecode_NodeTarget(t *testing.T) {
	var n Node
	require.NoError(t, mustParse(t, "a: 1\nb: 2").Decode(&n))
	require.Equal(t, KindMapping, n.Kind())
}

func TestDecode_Optional(t *testing.T) {
	var set Optional[int]
	require.NoError(t, mustParse(t, "7").Decode(&set))
	v, ok := set.Get()
	require.True(t, ok)
	require.Equal(t, 7, v)

	var absent Optional[int]
	require.NoError(t, mustParse(t, "null").Decode(&absent))
	_, ok = absent.Get()
	require.False(t, ok, "explicit null leaves Optional absent")
}

func TestDecode_ErrorHasPathAndLine(t *testing.T) {
	n := mustParse(t, "a: 1\nb: oops")
	entries, err := n.mappingEntries()
	require.NoError(t, err)
	var i int
	err = entries[1].value.Decode(&i)
	require.Error(t, err)
	require.Contains(t, err.Error(), "b")
	require.Contains(t, err.Error(), "line 2")
}
