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

// Package connmeta associates application metadata with parsed config
// objects, keyed by pointer identity — the go/types.Info pattern. A
// Table is created per parse call and carried in the context; parser
// wrappers record metadata as configs are composed, and the app reads
// it back after parsing.
package connmeta

import "context"

type contextKey struct{}

// Table maps config objects (by identity) to metadata values.
// It is not safe for concurrent use; a parse call is single-threaded.
type Table struct {
	m map[any]any
}

// WithTable returns a context carrying a new empty Table.
func WithTable(ctx context.Context) (context.Context, *Table) {
	t := &Table{m: make(map[any]any)}
	return context.WithValue(ctx, contextKey{}, t), t
}

// FromContext returns the Table carried by ctx, or nil.
func FromContext(ctx context.Context) *Table {
	t, _ := ctx.Value(contextKey{}).(*Table)
	return t
}

// Set records metadata for the given config object.
func (t *Table) Set(key any, value any) {
	t.m[key] = value
}

// Get returns the metadata of type V recorded for key.
func Get[V any](t *Table, key any) (V, bool) {
	var zero V
	if t == nil {
		return zero, false
	}
	v, ok := t.m[key].(V)
	if !ok {
		return zero, false
	}
	return v, true
}
