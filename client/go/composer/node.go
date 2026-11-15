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
	"strconv"

	"github.com/goccy/go-yaml/ast"
	"github.com/goccy/go-yaml/parser"
	"github.com/goccy/go-yaml/token"
)

const (
	maxNodeDepth     = 100
	maxDocumentNodes = 100_000
	maxAliasDepth    = 20
	maxMergeDepth    = 20
	maxMergeNodes    = 100_000
)

// Kind describes the shape of a configuration node.
type Kind int

const (
	KindAbsent   Kind = iota // A missing node or explicit null.
	KindScalar               // A string, boolean, or number.
	KindMapping              // A mapping with string keys.
	KindSequence             // A list of nodes.
)

func (k Kind) String() string {
	switch k {
	case KindAbsent:
		return "absent"
	case KindScalar:
		return "scalar"
	case KindMapping:
		return "mapping"
	case KindSequence:
		return "sequence"
	default:
		return fmt.Sprintf("Kind(%d)", k)
	}
}

// Error annotates a parsing or validation error with its configuration path
// and one-based source coordinates. Zero coordinates mean no source is available.
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
		loc += fmt.Sprintf(" (line %d, column %d)", e.Line, e.Column)
	}
	return fmt.Sprintf("%s: %v", loc, e.Err)
}

// Unwrap returns the cause, preserving errors.Is and errors.As checks.
func (e *Error) Unwrap() error { return e.Err }

// Node is an immutable view of a configuration value. It retains the document's
// anchors when passed to another parser. Its zero value is absent.
//
// Nodes may be read concurrently. Decode returns new map and slice containers;
// modifying them does not modify the source document.
type Node struct {
	ast     ast.Node
	anchors map[string]ast.Node
	path    string
	depth   int
}

// ParseYAML parses one YAML document (including JSON) into a Node. An empty
// document yields an absent node. The underlying YAML representation stays
// private; callers use Decode to read values and obtain child Nodes.
//
// The document scan is limited to 100,000 values and 100 levels. Child access
// also limits descent to 100 levels, including descent through aliases.
// Merge expansion is limited to 20 levels and 100,000 visited values.
// These limits bound individual operations, not arbitrary loops in callers.
// Syntax errors retain the YAML parser's source diagnostics.
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
	root := Node{ast: file.Docs[0].Body, anchors: make(map[string]ast.Node)}
	visited := 0
	if err := root.collectAnchors(0, &visited); err != nil {
		return Node{}, err
	}
	return root.deref()
}

// collectAnchors scans syntax, without following aliases. Keeping one document
// index lets delegated subtrees refer to anchors outside those subtrees.
func (n Node) collectAnchors(depth int, visited *int) error {
	if depth > maxNodeDepth {
		return n.errorf("document nesting exceeds %d levels", maxNodeDepth)
	}
	*visited += 1
	if *visited > maxDocumentNodes {
		return n.errorf("document exceeds %d values", maxDocumentNodes)
	}
	scan := func(value ast.Node, path string) error {
		return (Node{ast: value, anchors: n.anchors, path: path}).collectAnchors(depth+1, visited)
	}
	switch t := n.ast.(type) {
	case *ast.TagNode:
		return n.errorf("explicit YAML tags are not supported")
	case *ast.AnchorNode:
		name := t.Name.GetToken().Value
		if _, exists := n.anchors[name]; exists {
			return n.errorf("duplicate anchor %q", name)
		}
		n.anchors[name] = t.Value
		return scan(t.Value, n.path)
	case *ast.MappingNode:
		for _, entry := range t.Values {
			if err := scan(entry.Value, joinPath(n.path, entry.Key.GetToken().Value)); err != nil {
				return err
			}
		}
	case *ast.SequenceNode:
		for i, value := range t.Values {
			if err := scan(value, fmt.Sprintf("%s[%d]", n.path, i)); err != nil {
				return err
			}
		}
	}
	return nil
}

// Kind returns the node's shape. Null is treated as absent; use a decoded map's
// lookup boolean to distinguish a missing field from a present null.
func (n Node) Kind() Kind {
	switch n.ast.(type) {
	case nil, *ast.NullNode:
		return KindAbsent
	case *ast.MappingNode:
		return KindMapping
	case *ast.SequenceNode:
		return KindSequence
	default:
		return KindScalar
	}
}

// IsAbsent reports whether the node is missing or explicitly null.
func (n Node) IsAbsent() bool { return n.Kind() == KindAbsent }

// Path returns the node's path, such as "transport.options[1].endpoint".
// The document root has an empty path. Keys that are not identifiers use
// bracketed, quoted notation. Aliases use the path where they are accessed.
func (n Node) Path() string { return n.path }

// WithString returns a string node derived from n, retaining its source
// location and access path. It is useful when a parser extracts an endpoint
// from a URL and delegates it to another parser. The original node is unchanged.
func (n Node) WithString(value string) Node {
	var position *token.Position
	if n.ast != nil && n.ast.GetToken() != nil {
		position = n.ast.GetToken().Position
	}
	n.ast = ast.String(token.DoubleQuote(value, value, position))
	return n
}

// WrapError adds this node's path and source position to err. It returns nil
// for nil, and leaves errors already containing a composer.Error unchanged so
// the more specific child location is retained. Aliases use the definition's
// source position and the access path.
func (n Node) WrapError(err error) error {
	if err == nil {
		return nil
	}
	var located *Error
	if errors.As(err, &located) {
		return err
	}
	e := &Error{Path: n.path, Err: err}
	if n.ast != nil {
		if tok := n.ast.GetToken(); tok != nil && tok.Position != nil {
			e.Line, e.Column = tok.Position.Line, tok.Position.Column
		}
	}
	return e
}

func (n Node) errorf(format string, args ...any) error {
	return n.WrapError(fmt.Errorf(format, args...))
}

func (n Node) deref() (Node, error) {
	for depth := 0; ; depth++ {
		if depth > maxAliasDepth {
			return Node{}, n.errorf("alias nesting exceeds %d levels", maxAliasDepth)
		}
		switch t := n.ast.(type) {
		case *ast.AnchorNode:
			n.ast = t.Value
		case *ast.AliasNode:
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

func (n Node) child(value ast.Node, path string) (Node, error) {
	child := Node{ast: value, anchors: n.anchors, path: path, depth: n.depth + 1}
	if child.depth > maxNodeDepth {
		return Node{}, child.errorf("node nesting exceeds %d levels", maxNodeDepth)
	}
	return child.deref()
}

func (n Node) mapping() (map[string]Node, error) {
	return n.mappingWithMerges(0, &mergeState{active: make(map[*ast.MappingNode]bool)})
}

// A shared budget bounds repeated aliases, including acyclic merge graphs
// whose expansion is much larger than the source document.
type mergeState struct {
	visited int
	active  map[*ast.MappingNode]bool
}

func (s *mergeState) visit(n Node, count int) error {
	if count > maxMergeNodes-s.visited {
		return n.errorf("merge expansion exceeds %d values", maxMergeNodes)
	}
	s.visited += count
	return nil
}

func (n Node) mappingWithMerges(depth int, state *mergeState) (map[string]Node, error) {
	if depth > maxMergeDepth {
		return nil, n.errorf("merge key nesting exceeds %d levels", maxMergeDepth)
	}
	mapping, ok := n.ast.(*ast.MappingNode)
	if !ok {
		return nil, n.errorf("expected a mapping, found %s", n.Kind())
	}
	if state.active[mapping] {
		return nil, n.errorf("cyclic YAML merge")
	}
	state.active[mapping] = true
	defer delete(state.active, mapping)
	if err := state.visit(n, 1+len(mapping.Values)); err != nil {
		return nil, err
	}
	explicit := make(map[string]bool, len(mapping.Values))
	out := make(map[string]Node, len(mapping.Values))
	for _, entry := range mapping.Values {
		keyNode := Node{ast: entry.Key, path: n.path}
		if _, isMerge := entry.Key.(*ast.MergeKeyNode); isMerge {
			source, err := n.child(entry.Value, n.path)
			if err != nil {
				return nil, err
			}
			sources := []Node{source}
			if source.Kind() == KindSequence {
				sources, err = source.sequence()
				if err != nil {
					return nil, err
				}
				if err := state.visit(source, len(sources)); err != nil {
					return nil, err
				}
			}
			// Later mappings take precedence, matching the existing config
			// decoder. This differs from the YAML merge-key specification.
			for _, source := range sources {
				fields, err := source.mappingWithMerges(depth+1, state)
				if err != nil {
					return nil, err
				}
				for key, child := range fields {
					child.path = joinPath(n.path, key)
					out[key] = child
				}
			}
			continue
		}
		key, ok := entry.Key.(*ast.StringNode)
		_, numeric := keyNode.plainJSONNumber()
		if !ok || numeric {
			return nil, keyNode.errorf("mapping key must be a string")
		}
		if _, exists := explicit[key.Value]; exists {
			return nil, keyNode.errorf("duplicate mapping key %q", key.Value)
		}
		child, err := n.child(entry.Value, joinPath(n.path, key.Value))
		if err != nil {
			return nil, err
		}
		explicit[key.Value] = true
		out[key.Value] = child
	}
	return out, nil
}

func (n Node) sequence() ([]Node, error) {
	sequence, ok := n.ast.(*ast.SequenceNode)
	if !ok {
		return nil, n.errorf("expected a sequence, found %s", n.Kind())
	}
	out := make([]Node, len(sequence.Values))
	for i, value := range sequence.Values {
		child, err := n.child(value, fmt.Sprintf("%s[%d]", n.path, i))
		if err != nil {
			return nil, err
		}
		out[i] = child
	}
	return out, nil
}

func joinPath(base, key string) string {
	identifier := key != ""
	for i, r := range key {
		if !(r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || i > 0 && r >= '0' && r <= '9') {
			identifier = false
			break
		}
	}
	if !identifier {
		return base + "[" + strconv.Quote(key) + "]"
	}
	if base == "" {
		return key
	}
	return base + "." + key
}
