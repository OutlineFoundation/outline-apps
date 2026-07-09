# Composer Design Decisions

A log of the key decisions behind the `composer` package, so future
maintainers (and the Outline SDK migration) know what was decided and
why. Each entry: decision, rationale, alternatives rejected.

## D1. YAML as the wire format

JSON is a strict YAML subset, so JSON remains valid. YAML adds comments,
unquoted keys, and anchors. Parsing uses `github.com/goccy/go-yaml`
after correctness issues with `gopkg.in/yaml.v3` (outline-apps#2576).

## D2. Opaque `Node` handle instead of `any` trees or `[]byte`

Parsers exchange `composer.Node`, an immutable handle hiding the goccy
AST.

- vs `any` trees (old `configyaml.ConfigNode`): keeps source positions
  for error messages, self-documenting delegated fields, swappable
  backend (a YAML-library change touches one package, not every parser).
- vs `[]byte`: rejected decisively because YAML anchors don't survive
  subtree extraction — `endpoint: *proxy` is meaningless as standalone
  bytes — plus it would force reparsing and lose positions.

goccy types never appear in exported signatures.

## D3. No struct tags; naming by convention

Struct tags would couple config structs to the decoding library; change
the decoder, rewrite every struct. Instead the wire name is derived from
the Go field name (CamelCase → snake_case, acronym runs as one word) and
matching is normalization-based (lowercase, strip underscores). The
struct alone is the schema.

## D4. Required by default; `Optional[T]` for optional fields

Optionality is part of the schema, so it lives in the type system:
`Optional[T]` with `Get()` and `Or(default)`. `*T` pointers were
considered (Go tradition) but rejected: less self-documenting, nil
footguns, and no defaulting idiom. Explicit `null` equals absent.
For the migration: legacy structs do not encode optionality, but each
legacy parser already validates its required fields explicitly (e.g.
shadowsocks rejects an empty cipher or secret). When porting, mirror
that: validated-required fields stay plain, the rest become
`Optional[T]`.

## D5. Sender-side criticality: the `?` key suffix

The config author marks ignorable fields with a trailing `?` on the key
(`padding?: 32`) — strict by default, opt-out per field, like X.509
critical extensions (inverted). Local to the field, valid JSON,
TypeScript-familiar. Rejected: a `$optional: [names]` list (declaration
at a distance, repetition). Sender-side `?` and receiver-side
`Optional[T]` are orthogonal axes owned by different parties.

## D6. `errors.ErrUnsupported` unifies negotiation

Unknown `$type`, unknown required field, and platform-unsupported
features all wrap `errors.ErrUnsupported`, so `first-supported` handles
graceful degradation for all of them. Providers get two tiers of
forward compatibility: `?` for ignorable tweaks, `first-supported` for
structural alternatives. Mitigation for typo'd field names being
swallowed: when no option is supported, first-supported reports every
option's error.

## D7. `first-supported` is built into `TypeParser`

Generic combinators must exist for every parsed type; leaving
registration to each call site caused duplicated wiring (and one
near-miss bug) in the legacy system. `NewTypeParser` registers built-in
combinators itself.

## D8. No re-dispatch loop in `TypeParser.Parse`

The legacy parse loop re-dispatched when a sub-parser returned another
config — a macro facility that the type system made unusable (sub-parsers
return T, not nodes). Dropped for a single dispatch step. If macros are
ever needed, they should be an explicit, depth-guarded transformer
concept.

## D9. Own reflection decoder, no third-party mapping library

The semantics are bespoke ($-reserved keys, ? suffix, ErrUnsupported
classification, path+position errors, Optional detection). Wrapping
mapstructure or goccy's decoder would need as much pre/post-processing
code as a direct ~300-line AST walker, with less control. The legacy
map→JSON→YAML round-trip (MapToAny) is retired.

## D10. Anchors and merge keys resolved by the framework

ParseYAML builds a document-wide anchor table; nodes resolve aliases
lazily (no upfront expansion, so no memory amplification). Decode
enforces depth and node-count budgets against billion-laughs configs.

YAML merge keys (`<<`) are supported with standard YAML semantics:
explicit keys in the host mapping win over merged keys, and earlier
merge sources win over later ones. Merges are expanded when a mapping's
entries are read, before any field matching, so they work uniformly for
struct targets, map targets, and `$type` dispatch. Expansion is
depth-limited (20 levels) so self-referential merges error instead of
hanging. An earlier draft rejected merge keys, but the official
access-key config documentation relies on them to de-duplicate config
sections (e.g. sharing cipher/secret between the tcp and udp
transports):
https://developer.getoutline.org/vpn/reference/access-key-config/

## D11. Scalar shorthand stays in fallback handlers

`Decode` of a scalar into a struct errors. Type-level shorthand
("host:443" as a full endpoint) is per-type semantics and lives in each
TypeParser's fallback handler, as in the legacy design.

## D12. Coexistence and migration

The package was built alongside `configyaml` and adopted by porting one
parser chain at a time in a follow-up plan; `configyaml` was deleted at
the end. Migration complete 2026-07-09: `client/go/netconfig` is now
the transport-config layer (config interfaces, concrete config types,
protocol parsers), and `client/go/outline/configregistry` is the app
layer that registers netconfig's parsers, attaches connection metadata
via `client/go/outline/connmeta`, and applies Outline policy (DNS
interception, User-Agent) at the boundary. Long-term destination: the
Outline SDK (this package has no Outline-app dependencies by design —
app policy like ConnectionProviderInfo, DNS interception, and
User-Agent stays in the app layer, never in `composer` or `netconfig`).

## D13. Package name: `composer`

The system is Outline Composer: the notation and toolkit that lets
anyone compose network strategies — the tool for composing, not the
entity doing the composing. "We built the notation; you write the
music." Rejected: `config` (too generic, and it collides with the
ubiquitous `config` local-variable name at call sites) and `configyaml`
(ties the name to one serialization format when the core is
format-agnostic).

## Spike findings (2026-07, goccy/go-yaml v1.18.0)

The canary tests in `goccy_test.go` pin the library behaviors the
design relies on. Findings vs the original assumptions:

- Mappings always parse as `*ast.MappingNode`, regardless of size,
  style, or nesting. (Older goccy used `*ast.MappingValueNode` for
  single-pair mappings; `mappingEntries` keeps a defensive case.)
- `IntegerNode.Value` is `uint64` for ALL non-negative integers, even
  small ones, and `int64` for negative ones. Both decoder paths handle
  both representations.
- `yes`/`no` parse as strings (YAML 1.2 semantics), so the SPEC's
  "only true/false are bool" rule needs no extra enforcement.
- A trailing `?` is part of a plain YAML key (`padding?:` works).
- Block-literal chomping is already applied to the AST string value.
- goccy rejects an anchor whose value is an alias (`&x *x`) at parse
  time, so direct alias chains cannot be constructed; composer's
  `maxAliasDepth` guard is defense-in-depth behind that.
- Composer resolves anchors document-globally, so aliases may reference
  anchors defined later in the document — deliberately more lenient
  than the YAML spec's define-before-use rule.
