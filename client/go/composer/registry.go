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
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"sync/atomic"
)

// DefaultName is the registration name of the parser that handles values
// without a $type: absent values, scalar shorthand, and legacy mappings.
const DefaultName = ""

// FirstSupportedName is the $type that [NewRegistry] registers
// [FirstSupported] under.
const FirstSupportedName = "first-supported"

// Parser interprets node and returns a T, using registry to parse nested
// values.
//
// Always parse nested values with the supplied registry, never one captured
// earlier, so that overlays and interceptors installed by the caller of
// [Parse] apply to the whole config. Forward ctx to nested calls: it carries
// cancellation and the limits that bound one parse operation.
type Parser[T any] func(ctx context.Context, registry Registry, node Node) (T, error)

// Registry looks up parsers by their exact Go result type and $type name.
// Use [Parse] or [Lookup] for typed access.
//
// The methods use any to hold Parser[T] values of different result types.
// Go methods cannot declare type parameters, so the generic [Register],
// [Lookup], and [Parse] functions provide the typed API.
type Registry interface {
	// Lookup returns the parser registered for resultType and name, with ok
	// reporting whether the entry exists. [DefaultName] selects the parser for
	// values without a $type. A present nil parser disables the entry. A non-nil
	// parser must be a Parser[T] where T is exactly resultType. The one
	// exception is the result type [Combinator], whose entries are Combinator
	// values.
	Lookup(resultType reflect.Type, name string) (parser any, ok bool)
}

// MutableRegistry adds registration to [Registry]. Use [Register] for type
// safety. Finish registering before parsing; to vary parsers for one parse,
// layer an [Overlay] or [Intercept] over a shared registry instead of
// mutating it.
type MutableRegistry interface {
	Registry
	// Register sets the parser for resultType and name, replacing any existing
	// entry. A nil parser disables the entry. A non-nil parser must be a
	// Parser[T] where T is exactly resultType; Register panics otherwise.
	Register(resultType reflect.Type, name string, parser any)
}

type parserKey struct {
	resultType reflect.Type
	name       string
}

type registry struct {
	mu      sync.RWMutex
	parsers map[parserKey]any
}

// NewEmptyRegistry creates a registry with no entries.
func NewEmptyRegistry() MutableRegistry {
	return &registry{parsers: make(map[parserKey]any)}
}

// NewRegistry creates a registry holding the config types that are part of
// the format itself: [FirstSupported], under [FirstSupportedName].
func NewRegistry() MutableRegistry {
	r := NewEmptyRegistry()
	RegisterCombinator(r, FirstSupportedName, FirstSupported)
	return r
}

// Combinator is a config type that exists for every result type. It does not
// produce a value itself: it chooses nodes and has them parsed as whatever
// type was asked for at its place in the config.
//
// A combinator calls parse with each node it wants parsed, and returns nil
// once a call has succeeded; the value of the last successful call is the
// result. It reads its own fields from node, and may use registry and ctx
// like any [Parser].
type Combinator func(ctx context.Context, registry Registry, node Node, parse func(context.Context, Node) error) error

var combinatorType = reflect.TypeFor[Combinator]()

// RegisterCombinator registers combinator for `$type: name` in every result
// type. A parser registered for one result type under the same name takes
// precedence for that type. A nil combinator disables the entry.
func RegisterCombinator(r MutableRegistry, name string, combinator Combinator) {
	if combinator == nil {
		r.Register(combinatorType, name, nil)
		return
	}
	r.Register(combinatorType, name, combinator)
}

func (r *registry) Lookup(resultType reflect.Type, name string) (any, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	parser, ok := r.parsers[parserKey{resultType, name}]
	return parser, ok
}

func (r *registry) Register(resultType reflect.Type, name string, parser any) {
	if resultType == nil {
		panic("composer: parser result type is nil")
	}
	if parser != nil {
		_, isCombinator := parser.(Combinator)
		if resultType == combinatorType && !isCombinator || resultType != combinatorType && parserResultType(parser) != resultType {
			panic(fmt.Sprintf("composer: parser for %v has type %T", resultType, parser))
		}
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.parsers[parserKey{resultType, name}] = parser
}

var parserShape = reflect.TypeFor[Parser[any]]()

// parserResultType returns T if parser is a Parser[T], or nil otherwise.
func parserResultType(parser any) reflect.Type {
	t := reflect.TypeOf(parser)
	if t.Kind() != reflect.Func || t.NumIn() != parserShape.NumIn() || t.NumOut() != parserShape.NumOut() {
		return nil
	}
	for i := range t.NumIn() {
		if t.In(i) != parserShape.In(i) {
			return nil
		}
	}
	if t.Out(1) != parserShape.Out(1) {
		return nil
	}
	return t.Out(0)
}

// Register registers parser for values of type T with `$type: name`. Use an
// interface type argument to register an implementation of that interface.
// [DefaultName] registers the parser for values without a $type. A nil parser
// disables the entry.
func Register[T any](r MutableRegistry, name string, parser Parser[T]) {
	if parser == nil {
		r.Register(reflect.TypeFor[T](), name, nil)
		return
	}
	r.Register(reflect.TypeFor[T](), name, parser)
}

// Lookup returns the parser registered for T and name without invoking it,
// for example so a replacement can delegate to the parser it replaces. A
// missing or disabled entry returns an error matching [errors.ErrUnsupported].
func Lookup[T any](r Registry, name string) (Parser[T], error) {
	resultType := reflect.TypeFor[T]()
	if r == nil {
		return nil, fmt.Errorf("composer: nil registry looking up %v %q", resultType, name)
	}
	entry, ok := r.Lookup(resultType, name)
	if !ok || entry == nil {
		return nil, unsupportedError(resultType, name)
	}
	parser, ok := entry.(Parser[T])
	if !ok {
		// Accept the unnamed function type too, so Registry implementations
		// need not convert what they return.
		fn, isFunc := entry.(func(context.Context, Registry, Node) (T, error))
		if !isFunc {
			return nil, fmt.Errorf("composer: %v %q has incompatible parser type %T", resultType, name, entry)
		}
		parser = fn
	}
	if parser == nil {
		return nil, unsupportedError(resultType, name)
	}
	return parser, nil
}

func unsupportedError(resultType reflect.Type, name string) error {
	if name == DefaultName {
		return fmt.Errorf("%v needs a %s: %w", resultType, TypeKey, errors.ErrUnsupported)
	}
	return fmt.Errorf("%s %q is not supported for %v: %w", TypeKey, name, resultType, errors.ErrUnsupported)
}

// Limits on one top-level Parse operation, including every nested Parse. They
// bound the work a small config can demand through aliases and nested
// first-supported options.
const (
	maxParseDepth = 100
	maxParseCalls = 10_000
)

type parseBudgetKey struct{}

type parseBudget struct {
	calls *atomic.Int64
	depth int
}

// Parse returns the T described by node. A mapping with a $type is handled by
// the parser registered under that name; any other value is handled by the
// [DefaultName] parser. Parsers receive r, so the same registry serves the
// whole config.
//
// A $type with no parser for T may name a [Combinator], which applies to
// every result type.
//
// A $type or result type with no parser returns an error matching
// [errors.ErrUnsupported]. Errors carry the location of the node being
// parsed; see [Error].
func Parse[T any](ctx context.Context, r Registry, node Node) (T, error) {
	var zero T
	budget, _ := ctx.Value(parseBudgetKey{}).(parseBudget)
	if budget.calls == nil {
		budget.calls = new(atomic.Int64)
	}
	budget.depth++
	if budget.depth > maxParseDepth {
		return zero, node.errorf("config nesting exceeds %d levels", maxParseDepth)
	}
	if budget.calls.Add(1) > maxParseCalls {
		return zero, node.errorf("config exceeds %d parsed values", maxParseCalls)
	}
	ctx = context.WithValue(ctx, parseBudgetKey{}, budget)

	name, _, err := node.typeName()
	if err != nil {
		return zero, err
	}
	parser, err := Lookup[T](r, name)
	if err != nil {
		combinator := lookupCombinator[T](r, name)
		if combinator == nil {
			return zero, node.wrapErr(err)
		}
		parser = combinator
	}
	value, err := parser(ctx, r, node)
	if err != nil {
		return zero, node.locate(err)
	}
	return value, nil
}

// locate adds the node's location to err unless a nested node already did.
func (n Node) locate(err error) error {
	var located *Error
	if errors.As(err, &located) {
		return err
	}
	return n.wrapErr(err)
}

// lookupCombinator returns the combinator registered under name as a parser
// of T, or nil if there is none or T has its own entry for name.
func lookupCombinator[T any](r Registry, name string) Parser[T] {
	if r == nil || name == DefaultName {
		return nil
	}
	if _, own := r.Lookup(reflect.TypeFor[T](), name); own {
		return nil // A disabled entry for T also hides the combinator.
	}
	entry, _ := r.Lookup(combinatorType, name)
	combinator, _ := entry.(Combinator)
	if combinator == nil {
		return nil
	}
	return func(ctx context.Context, r Registry, node Node) (T, error) {
		var value T
		parsed := false
		err := combinator(ctx, r, node, func(ctx context.Context, chosen Node) error {
			v, err := Parse[T](ctx, r, chosen)
			if err == nil {
				value, parsed = v, true
			}
			return err
		})
		if err != nil {
			var zero T
			return zero, err
		}
		if !parsed {
			var zero T
			return zero, fmt.Errorf("composer: %s %q selected no value", TypeKey, name)
		}
		return value, nil
	}
}

// FirstSupported is the combinator that negotiates between client versions.
// It takes a list of options and selects the first one this client supports,
// skipping options whose error matches [errors.ErrUnsupported] at any depth.
// Any other error ends the parse. If every option is skipped, the error
// matches [errors.ErrUnsupported] and reports why each option was skipped.
func FirstSupported(ctx context.Context, _ Registry, node Node, parse func(context.Context, Node) error) error {
	var config struct {
		Options []Node
	}
	if err := node.Decode(&config); err != nil {
		return err
	}
	if len(config.Options) == 0 {
		return node.errorf("empty list of options")
	}
	var skipped []error
	for _, option := range config.Options {
		err := parse(ctx, option)
		if err == nil {
			return nil
		}
		if !errors.Is(err, errors.ErrUnsupported) {
			return err
		}
		skipped = append(skipped, err)
	}
	return node.wrapErr(fmt.Errorf("no supported option: %w", errors.Join(skipped...)))
}

type overlay struct {
	top, bottom Registry
}

// Overlay returns a registry that looks entries up in top before bottom. An
// entry present in top, including a disabled one, hides the bottom entry.
// Neither registry is modified, so one shared registry can serve parses that
// each need different entries.
func Overlay(top, bottom Registry) Registry {
	return overlay{top, bottom}
}

func (o overlay) Lookup(resultType reflect.Type, name string) (any, bool) {
	if parser, ok := o.top.Lookup(resultType, name); ok {
		return parser, true
	}
	return o.bottom.Lookup(resultType, name)
}

type interceptor[T any] struct {
	base Registry
	wrap func(name string, next Parser[T]) Parser[T]
}

// Intercept returns a registry in which every parser for T found in base is
// replaced by wrap(name, parser). Entries for other result types, and missing
// or disabled entries, are returned unchanged.
//
// The wrapper sees each value of type T parsed anywhere in a config, because
// parsers use the registry they are given for nested values. The wrapper
// should pass the registry it receives on to next.
func Intercept[T any](base Registry, wrap func(name string, next Parser[T]) Parser[T]) Registry {
	return interceptor[T]{base, wrap}
}

func (i interceptor[T]) Lookup(resultType reflect.Type, name string) (any, bool) {
	entry, ok := i.base.Lookup(resultType, name)
	if !ok || entry == nil || resultType != reflect.TypeFor[T]() {
		return entry, ok
	}
	next, err := Lookup[T](i.base, name)
	if err != nil {
		return entry, ok
	}
	return i.wrap(name, next), true
}

// As adapts a parser of the concrete type C into a parser of T, an interface
// that C implements, so it can be registered under T. It panics if C is not
// assignable to T, which happens when the registry is being set up.
func As[T, C any](parse Parser[C]) Parser[T] {
	if !reflect.TypeFor[C]().AssignableTo(reflect.TypeFor[T]()) {
		panic(fmt.Sprintf("composer: %v is not assignable to %v", reflect.TypeFor[C](), reflect.TypeFor[T]()))
	}
	return func(ctx context.Context, registry Registry, node Node) (T, error) {
		value, err := parse(ctx, registry, node)
		if err != nil {
			var zero T
			return zero, err
		}
		return any(value).(T), nil
	}
}
