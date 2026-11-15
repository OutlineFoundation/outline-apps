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

// Package composer provides source-aware nodes for parsing structured
// configuration. ParseYAML accepts a single YAML or JSON document. Node.Decode
// reads scalars or shallow maps and slices whose children remain Nodes.
// Parsers can delegate those children without re-serializing them or losing
// access to the document's anchors.
//
// Nodes are immutable and retain their access paths. WrapError annotates
// component validation errors with a path and source coordinates. Aliases
// report the accessed path and the definition's source position. Traversal is
// bounded, including through recursive aliases; limits apply to individual
// operations, not the total work performed by a caller.
//
// This package currently supports strings, booleans, finite numeric scalars,
// null, sequences, string-keyed mappings, anchors/aliases, and bounded YAML
// merges. Explicit fields override merged fields regardless of their order;
// earlier sources in a merge sequence take precedence. Explicit tags are
// rejected. Node treats other keys literally, including "$type", "$defs", and
// "field?". Higher-level parsers and decoders may interpret those keys.
//
// Decoder reads struct schemas and nested collections while retaining Node
// fields for delegation. Its zero value uses strict scalar conversions;
// CoerceScalars explicitly enables the existing config conversions, and
// AllowUnknownFields permits additional struct fields. Missing fields preserve
// defaults; required/optional field rules are not imposed.
//
// TypeParser[T] dispatches $type names to registered ParseFunc[T] callbacks or
// a fallback. T may be any Go type. Parsers receive the original Node and
// context; parser dependencies are currently supplied at construction time.
//
// Node.MarshalJSON normalizes nodes for storage using the same merge semantics
// and bounded traversal. Application registrations, protocol parsing, metadata,
// and runtime construction remain outside this package.
package composer
