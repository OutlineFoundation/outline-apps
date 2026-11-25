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

// Package composer implements the core of Outline Composer, a configuration
// format for composing network strategies.
//
// A configuration is a YAML (or JSON) document. This package reads one into a
// tree of [Node] values and decodes nodes into Go structs:
//
//   - [ParseYAML] returns the root [Node] of a document. A Node is an
//     immutable handle that knows where it is in the document, so errors name
//     the config path and line, and resolves YAML aliases wherever it travels.
//   - [Node.Decode] maps a node onto a plain Go struct. Fields are matched by
//     name with no struct tags, and are required unless typed [Optional].
//   - A struct field of type [Node] receives its value undecoded, for the
//     parser of that value to decode later.
//
// The format is specified in SPEC.md, and the reasons for its design are in
// DESIGN.md. The package has no dependency on the Outline Client, so that it
// can move to the Outline SDK.
package composer
