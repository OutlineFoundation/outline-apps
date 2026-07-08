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
	"errors"
	"fmt"

	"github.com/goccy/go-yaml/ast"
	"github.com/goccy/go-yaml/parser"
)

// TypeKey is the reserved mapping key that selects a registered sub-parser.
const TypeKey = "$type"

const maxAliasDepth = 20

// Kind describes the shape of a config Node.
type Kind int

const (
	KindAbsent Kind = iota
	KindScalar
	KindMapping
	KindSequence
)

func (k Kind) String() string {
	switch k {
	case KindAbsent:
		return "absent"
	case KindScalar:
		return "scalar"
	case KindMapping:
		return "map"
	case KindSequence:
		return "list"
	default:
		return fmt.Sprintf("Kind(%d)", int(k))
	}
}

// Error is a config processing error annotated with the config path and
// source position. It unwraps to the underlying error, so sentinel
// checks like errors.Is(err, errors.ErrUnsupported) work through it.
type Error struct {
	Path         string
	Line, Column int
	Err          error
}

func (e *Error) Error() string {
	loc := e.Path
	if loc == "" {
		loc = "config"
	}
	if e.Line > 0 {
		loc = fmt.Sprintf("%s (line %d)", loc, e.Line)
	}
	return fmt.Sprintf("%s: %v", loc, e.Err)
}

func (e *Error) Unwrap() error { return e.Err }

// Node is an immutable handle into a parsed configuration. The zero
// value is an absent node. Node hides the underlying YAML representation
// so it can be replaced without changing parsers.
type Node struct {
	ast     ast.Node
	anchors map[string]ast.Node
	path    string
}

// ParseYAML parses a single-document YAML (or JSON) text into a Node.
// An empty document yields an absent Node.
func ParseYAML(text []byte) (Node, error) {
	file, err := parser.ParseBytes(text, 0)
	if err != nil {
		return Node{}, fmt.Errorf("invalid YAML: %w", err)
	}
	if len(file.Docs) > 1 {
		return Node{}, errors.New("multi-document YAML is not supported")
	}
	if len(file.Docs) == 0 || file.Docs[0].Body == nil {
		return Node{}, nil
	}
	anchors := make(map[string]ast.Node)
	collectAnchors(file.Docs[0].Body, anchors)
	return (Node{ast: file.Docs[0].Body, anchors: anchors}).deref()
}

// collectAnchors indexes every anchor definition in the document, so
// aliases resolve regardless of where the referencing subtree ends up.
func collectAnchors(n ast.Node, anchors map[string]ast.Node) {
	switch t := n.(type) {
	case *ast.AnchorNode:
		anchors[t.Name.GetToken().Value] = t.Value
		collectAnchors(t.Value, anchors)
	case *ast.MappingNode:
		for _, kv := range t.Values {
			collectAnchors(kv.Value, anchors)
		}
	case *ast.MappingValueNode:
		collectAnchors(t.Value, anchors)
	case *ast.SequenceNode:
		for _, v := range t.Values {
			collectAnchors(v, anchors)
		}
	}
}

// Kind returns the shape of the node. Explicit null counts as absent.
func (n Node) Kind() Kind {
	switch n.ast.(type) {
	case nil, *ast.NullNode:
		return KindAbsent
	case *ast.MappingNode, *ast.MappingValueNode:
		return KindMapping
	case *ast.SequenceNode:
		return KindSequence
	default:
		return KindScalar
	}
}

// IsAbsent reports whether the node is missing or explicitly null.
func (n Node) IsAbsent() bool { return n.Kind() == KindAbsent }

// Path returns the location of this node in the config, e.g.
// "transport.endpoint.options[1]". The root path is "".
func (n Node) Path() string { return n.path }

// deref unwraps anchor definitions and resolves alias references so
// that n.ast is always a mapping, sequence, scalar, or null.
func (n Node) deref() (Node, error) {
	for depth := 0; ; {
		switch t := n.ast.(type) {
		case *ast.AnchorNode:
			n.ast = t.Value
		case *ast.AliasNode:
			depth++
			if depth > maxAliasDepth {
				return Node{}, n.errorf("alias nesting exceeds %d levels", maxAliasDepth)
			}
			name := t.Value.GetToken().Value
			target, ok := n.anchors[name]
			if !ok {
				return Node{}, n.errorf("unknown anchor %q", name)
			}
			n.ast = target
		default:
			return n, nil
		}
	}
}

func (n Node) childNode(a ast.Node, path string) (Node, error) {
	return (Node{ast: a, anchors: n.anchors, path: path}).deref()
}

func joinPath(base, key string) string {
	if base == "" {
		return key
	}
	return base + "." + key
}

type mapEntry struct {
	key   string
	value Node
}

// mappingEntries returns the key/value pairs of a mapping node in
// document order. The MappingValueNode case is defensive: goccy v1.18
// always produces MappingNode (see goccy_test.go), but older versions
// used MappingValueNode for single-pair mappings.
func (n Node) mappingEntries() ([]mapEntry, error) {
	var kvs []*ast.MappingValueNode
	switch t := n.ast.(type) {
	case *ast.MappingNode:
		kvs = t.Values
	case *ast.MappingValueNode:
		kvs = []*ast.MappingValueNode{t}
	default:
		return nil, n.errorf("expected a map, found %s", n.describe())
	}
	entries := make([]mapEntry, 0, len(kvs))
	for _, kv := range kvs {
		key := kv.Key.GetToken().Value
		child, err := n.childNode(kv.Value, joinPath(n.path, key))
		if err != nil {
			return nil, err
		}
		entries = append(entries, mapEntry{key: key, value: child})
	}
	return entries, nil
}

// sequenceItems returns the elements of a sequence node.
func (n Node) sequenceItems() ([]Node, error) {
	seq, ok := n.ast.(*ast.SequenceNode)
	if !ok {
		return nil, n.errorf("expected a list, found %s", n.describe())
	}
	items := make([]Node, 0, len(seq.Values))
	for i, v := range seq.Values {
		child, err := n.childNode(v, fmt.Sprintf("%s[%d]", n.path, i))
		if err != nil {
			return nil, err
		}
		items = append(items, child)
	}
	return items, nil
}

// typeName returns the value of the $type key of a mapping node.
func (n Node) typeName() (string, bool, error) {
	if n.Kind() != KindMapping {
		return "", false, nil
	}
	entries, err := n.mappingEntries()
	if err != nil {
		return "", false, err
	}
	for _, e := range entries {
		if e.key != TypeKey {
			continue
		}
		var name string
		if err := e.value.Decode(&name); err != nil {
			return "", false, fmt.Errorf("%s must be a string: %w", TypeKey, err)
		}
		return name, true, nil
	}
	return "", false, nil
}

func (n Node) errorf(format string, args ...any) error {
	return n.wrapErr(fmt.Errorf(format, args...))
}

func (n Node) wrapErr(err error) error {
	e := &Error{Path: n.path, Err: err}
	if n.ast != nil {
		if tok := n.ast.GetToken(); tok != nil && tok.Position != nil {
			e.Line, e.Column = tok.Position.Line, tok.Position.Column
		}
	}
	return e
}
