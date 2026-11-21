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

package composer_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
)

// A small vocabulary with no networking: a route is a chain of hops ending at
// a gateway.

type route string

type gateway string

func parseVia(ctx context.Context, r composer.Registry, node composer.Node) (route, error) {
	var config struct {
		Hop  string
		Next composer.Optional[composer.Node]
	}
	if err := node.Decode(&config); err != nil {
		return "", err
	}
	nextNode, _ := config.Next.Get()
	next, err := composer.Parse[route](ctx, r, nextNode)
	if err != nil {
		return "", err
	}
	return route(config.Hop) + " > " + next, nil
}

// parseEnd is the default route parser: an omitted route ends at the gateway.
func parseEnd(ctx context.Context, r composer.Registry, node composer.Node) (route, error) {
	if !node.IsAbsent() {
		return "", errors.New("a route needs a $type")
	}
	gw, err := composer.Parse[gateway](ctx, r, composer.Node{})
	if err != nil {
		return "", err
	}
	return route(gw), nil
}

func newRouteRegistry(gw gateway) composer.MutableRegistry {
	r := composer.NewRegistry()
	composer.Register(r, "via", parseVia)
	composer.Register(r, composer.DefaultName, parseEnd)
	composer.Register(r, composer.DefaultName, func(context.Context, composer.Registry, composer.Node) (gateway, error) {
		return gw, nil
	})
	return r
}

func parseYAML(t *testing.T, text string) composer.Node {
	t.Helper()
	node, err := composer.ParseYAML([]byte(text))
	require.NoError(t, err)
	return node
}

func parseRoute(t *testing.T, r composer.Registry, text string) (route, error) {
	t.Helper()
	return composer.Parse[route](context.Background(), r, parseYAML(t, text))
}

const twoHops = "{$type: via, hop: a, next: {$type: via, hop: b}}"

func TestParse_DispatchesOnType(t *testing.T) {
	r := newRouteRegistry("internet")
	got, err := parseRoute(t, r, twoHops)
	require.NoError(t, err)
	require.Equal(t, route("a > b > internet"), got)

	got, err = parseRoute(t, r, "")
	require.NoError(t, err)
	require.Equal(t, route("internet"), got, "a value without a $type uses the default parser")
}

func TestParse_KeyedByResultTypeAndName(t *testing.T) {
	r := newRouteRegistry("internet")
	composer.Register(r, "via", func(context.Context, composer.Registry, composer.Node) (int, error) {
		return 42, nil
	})
	number, err := composer.Parse[int](context.Background(), r, parseYAML(t, "$type: via"))
	require.NoError(t, err)
	require.Equal(t, 42, number, "the same name can be registered for another result type")

	got, err := parseRoute(t, r, "{$type: via, hop: a}")
	require.NoError(t, err)
	require.Equal(t, route("a > internet"), got)
}

func TestParse_Unsupported(t *testing.T) {
	r := newRouteRegistry("internet")

	_, err := parseRoute(t, r, "{$type: via, hop: a, next: {$type: teleport}}")
	require.ErrorIs(t, err, errors.ErrUnsupported, "unknown $type")
	require.ErrorContains(t, err, `$type "teleport" is not supported`)
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "next", located.Path, "the error names the unsupported node")

	_, err = composer.Parse[string](context.Background(), r, parseYAML(t, "$type: via"))
	require.ErrorIs(t, err, errors.ErrUnsupported, "result type with no parsers")

	composer.Register[route](r, "via", nil)
	_, err = parseRoute(t, r, "{$type: via, hop: a}")
	require.ErrorIs(t, err, errors.ErrUnsupported, "disabled entry")
}

func TestParse_ParserErrorsAreLocatedAndNotUnsupported(t *testing.T) {
	r := newRouteRegistry("internet")
	_, err := parseRoute(t, r, "{$type: via, hop: a, next: {$type: via, hop: b, next: nonsense}}")
	require.Error(t, err)
	require.NotErrorIs(t, err, errors.ErrUnsupported)
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, "next.next", located.Path)
	require.Equal(t, 1, located.Line)
}

func TestFirstSupported(t *testing.T) {
	r := newRouteRegistry("internet")

	got, err := parseRoute(t, r, `
$type: first-supported
options:
  - {$type: teleport}
  - {$type: via, hop: a, next: {$type: wormhole}}
  - {$type: via, hop: b}
  - {$type: via, hop: c}
`)
	require.NoError(t, err)
	require.Equal(t, route("b > internet"), got, "skips options unsupported at any depth")

	_, err = parseRoute(t, r, "{$type: first-supported, options: [{$type: teleport}, {$type: wormhole}]}")
	require.ErrorIs(t, err, errors.ErrUnsupported)
	require.ErrorContains(t, err, "teleport")
	require.ErrorContains(t, err, "wormhole", "every skipped option is reported")

	_, err = parseRoute(t, r, "{$type: first-supported, options: [{$type: via}, {$type: via, hop: b}]}")
	require.Error(t, err)
	require.NotErrorIs(t, err, errors.ErrUnsupported, "an invalid option is an error, not a skipped option")

	_, err = parseRoute(t, r, "{$type: first-supported, options: []}")
	require.ErrorContains(t, err, "empty list of options")

	composer.Register(r, composer.FirstSupportedName, func(context.Context, composer.Registry, composer.Node) (route, error) {
		return "overridden", nil
	})
	got, err = parseRoute(t, r, "{$type: first-supported, options: []}")
	require.NoError(t, err)
	require.Equal(t, route("overridden"), got, "an entry for the result type takes precedence over the combinator")
}

// first-supported is an ordinary registry entry: an application can leave it
// out, disable it for one parse, or add combinators of its own.
func TestCombinators_AreRegistryEntries(t *testing.T) {
	const config = "{$type: first-supported, options: [{$type: teleport}, {$type: via, hop: b}]}"

	without := composer.NewEmptyRegistry()
	composer.Register(without, "via", parseVia)
	composer.Register(without, composer.DefaultName, parseEnd)
	_, err := parseRoute(t, without, config)
	require.ErrorIs(t, err, errors.ErrUnsupported, "not registered")

	off := composer.NewEmptyRegistry()
	composer.RegisterCombinator(off, composer.FirstSupportedName, nil)
	_, err = parseRoute(t, composer.Overlay(off, newRouteRegistry("internet")), config)
	require.ErrorIs(t, err, errors.ErrUnsupported, "disabled by an overlay")

	// An application combinator: the last option, whatever the type.
	r := newRouteRegistry("internet")
	composer.RegisterCombinator(r, "last", func(ctx context.Context, _ composer.Registry, node composer.Node, parse func(context.Context, composer.Node) error) error {
		var fields struct{ Options []composer.Node }
		if err := node.Decode(&fields); err != nil {
			return err
		}
		return parse(ctx, fields.Options[len(fields.Options)-1])
	})
	got, err := parseRoute(t, r, "{$type: last, options: [{$type: via, hop: a}, {$type: via, hop: b}]}")
	require.NoError(t, err)
	require.Equal(t, route("b > internet"), got)
	gw, err := composer.Parse[gateway](context.Background(), r, parseYAML(t, "{$type: last, options: [null]}"))
	require.NoError(t, err)
	require.Equal(t, gateway("internet"), gw, "the same entry serves every result type")
}

// An overlay installed after the vocabulary was registered must reach parsers
// at every depth, because each parser uses the registry it is given.
func TestOverlay_ReachesNestedParsers(t *testing.T) {
	shared := newRouteRegistry("internet")

	top := composer.NewEmptyRegistry()
	composer.Register(top, composer.DefaultName, func(context.Context, composer.Registry, composer.Node) (gateway, error) {
		return "vpn", nil
	})
	got, err := parseRoute(t, composer.Overlay(top, shared), twoHops)
	require.NoError(t, err)
	require.Equal(t, route("a > b > vpn"), got)

	got, err = parseRoute(t, shared, twoHops)
	require.NoError(t, err)
	require.Equal(t, route("a > b > internet"), got, "the shared registry is unchanged")

	disabled := composer.NewEmptyRegistry()
	composer.Register[route](disabled, "via", nil)
	_, err = parseRoute(t, composer.Overlay(disabled, shared), twoHops)
	require.ErrorIs(t, err, errors.ErrUnsupported, "a disabled entry in the overlay hides the one below")
}

// Intercept sees every value of its type, including nested values, defaults,
// and the first-supported options that are tried and rejected.
func TestIntercept_SeesTheWholeConfig(t *testing.T) {
	var trace []string
	traced := composer.Intercept(newRouteRegistry("internet"),
		func(name string, next composer.Parser[route]) composer.Parser[route] {
			return func(ctx context.Context, r composer.Registry, node composer.Node) (route, error) {
				value, err := next(ctx, r, node)
				outcome := string(value)
				if err != nil {
					outcome = "error"
				}
				trace = append(trace, fmt.Sprintf("%s[%q] = %s", node.Path(), name, outcome))
				return value, err
			}
		})

	got, err := parseRoute(t, traced, `
$type: via
hop: a
next:
  $type: first-supported
  options:
    - {$type: via, hop: b, next: {$type: teleport}}
    - {$type: via, hop: c}
`)
	require.NoError(t, err)
	require.Equal(t, route("a > c > internet"), got)
	require.Equal(t, []string{
		`next.options[0]["via"] = error`, // tried, then skipped: its next hop is unsupported
		`[""] = internet`,                // the omitted next hop of c, parsed by the default parser
		`next.options[1]["via"] = c > internet`,
		`["via"] = a > c > internet`,
	}, trace)
}

func TestIntercept_LeavesOtherEntriesAlone(t *testing.T) {
	base := newRouteRegistry("internet")
	wrapped := composer.Intercept(base, func(string, composer.Parser[route]) composer.Parser[route] {
		return func(context.Context, composer.Registry, composer.Node) (route, error) { return "intercepted", nil }
	})
	gw, err := composer.Parse[gateway](context.Background(), wrapped, composer.Node{})
	require.NoError(t, err)
	require.Equal(t, gateway("internet"), gw, "other result types pass through")

	_, ok := wrapped.Lookup(reflect.TypeFor[route](), "teleport")
	require.False(t, ok, "missing entries stay missing")
}

func TestLookup_DelegatesToTheReplacedParser(t *testing.T) {
	r := newRouteRegistry("internet")
	previous, err := composer.Lookup[route](r, "via")
	require.NoError(t, err)
	composer.Register(r, "via", func(ctx context.Context, r composer.Registry, node composer.Node) (route, error) {
		value, err := previous(ctx, r, node)
		return "[" + value + "]", err
	})
	got, err := parseRoute(t, r, twoHops)
	require.NoError(t, err)
	require.Equal(t, route("[a > [b > internet]]"), got)
}

func TestAs_RegistersAnImplementationUnderItsInterface(t *testing.T) {
	r := composer.NewRegistry()
	composer.Register(r, "text", composer.As[fmt.Stringer](func(context.Context, composer.Registry, composer.Node) (*strings.Builder, error) {
		var b strings.Builder
		b.WriteString("built")
		return &b, nil
	}))
	got, err := composer.Parse[fmt.Stringer](context.Background(), r, parseYAML(t, "$type: text"))
	require.NoError(t, err)
	require.Equal(t, "built", got.String())

	require.Panics(t, func() {
		composer.As[fmt.Stringer](func(context.Context, composer.Registry, composer.Node) (int, error) { return 0, nil })
	})
}

func TestRegister_RejectsMismatchedParsers(t *testing.T) {
	r := composer.NewEmptyRegistry()
	require.Panics(t, func() { r.Register(reflect.TypeFor[route](), "x", "not a parser") })
	require.Panics(t, func() {
		r.Register(reflect.TypeFor[route](), "x", func(context.Context, composer.Registry, composer.Node) (int, error) { return 0, nil })
	})
}

// A small document must not be able to demand unbounded work by nesting
// first-supported over aliases, where every level multiplies the options.
func TestParse_BoundsTotalWork(t *testing.T) {
	var doc strings.Builder
	doc.WriteString("$defs:\n  l0: &l0 {$type: teleport}\n")
	const levels = 12
	for i := 1; i <= levels; i++ {
		fmt.Fprintf(&doc, "  l%d: &l%d {$type: first-supported, options: [*l%d, *l%d, *l%d, *l%d]}\n", i, i, i-1, i-1, i-1, i-1)
	}
	fmt.Fprintf(&doc, "$type: first-supported\noptions: [*l%d]\n", levels)

	_, err := parseRoute(t, newRouteRegistry("internet"), doc.String())
	require.ErrorContains(t, err, "exceeds")
	require.NotErrorIs(t, err, errors.ErrUnsupported, "exhausting the budget is not a skippable option")
}

func TestParse_BoundsDepth(t *testing.T) {
	text := strings.Repeat("{$type: via, hop: a, next: ", 150) + "null" + strings.Repeat("}", 150)
	_, err := parseRoute(t, newRouteRegistry("internet"), text)
	require.ErrorContains(t, err, "nesting exceeds")
}
