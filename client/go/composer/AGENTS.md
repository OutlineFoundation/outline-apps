# The `composer` Package (Outline Composer)

Core of Outline's extensible configuration system: the notation and
toolkit that lets anyone compose network strategies. Read SPEC.md for
the wire format (normative) and DESIGN.md for why things are the way
they are.

## Adding a new config type

1. Define a plain Go struct. No tags. Fields are required unless typed
   `composer.Optional[T]`. Use `composer.Node` for delegated sub-configs.
2. Write a build function `func(ctx context.Context, cfg MyConfig) (T, error)`.
   If it delegates, take the needed `composer.ParseFunc` as a constructor
   argument so the dependency is explicit and compile-checked.
3. Register it: `composer.RegisterParser(parser, "my-type", build)`.

Keep application policy (metadata, DNS behavior, User-Agent) out of this
package; it is destined for the Outline SDK and must stay app-agnostic.

## Status

Built alongside the legacy `client/go/configyaml`; the migration of
`configregistry`, `reporting`, and `client.go` onto this package is a
separate follow-up plan (see docs/superpowers/plans/). Do not add new
parsers to `configyaml`.
