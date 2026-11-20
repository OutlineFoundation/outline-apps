# Composer Design Decisions

The decisions behind the `composer` package, so that maintainers know what
was decided and why. Each entry gives the decision, its reason, and the
alternatives that were rejected.

## D1. YAML as the wire format

JSON is a subset of YAML, so JSON remains valid. YAML adds comments,
unquoted keys, and anchors. Parsing uses `github.com/goccy/go-yaml`, after
correctness problems with `gopkg.in/yaml.v3` (outline-apps#2576).

## D2. An opaque `Node` instead of `any` trees or `[]byte`

Parsers exchange `composer.Node`, an immutable handle that hides the YAML
library's syntax tree.

- Compared with `any` trees (`configyaml.ConfigNode` today): a Node
  keeps source positions for error messages, and a change of YAML library
  touches one package instead of every parser.
- Compared with `[]byte`: an alias does not survive being cut out of its
  document. `endpoint: *proxy` means nothing as standalone bytes. Bytes
  would also be parsed again at every level and lose their position.

No type of the YAML library appears in an exported signature.

## D3. No struct tags; names matched by convention

Struct tags would tie every config struct to the decoding library. Matching
normalizes instead (lowercase, underscores removed), so any spelling that
normalizes to the Go field name works. `snake_case` is the documented
convention, not something the code derives: an earlier revision derived a
`snake_case` name from each Go name for error messages, and acronyms and
plurals ("IPs") made that a heuristic. Errors now name fields in the
normalized form, which is always a valid spelling.

## D4. Required by default; `Optional[T]` for optional fields

Whether a field may be omitted is part of the schema, so it is part of the
field's type: `Optional[T]`, with `Get()` and `Or(default)`. Pointers were
considered and rejected: `*T` says less, invites nil dereferences, and has
no idiom for defaults. An explicit `null` is the same as an omitted field.

## D5. The sender marks ignorable fields with a `?` suffix

A config author marks a field that an older client may safely ignore with a
trailing `?` on its key (`padding?: 32`). Fields are strict by default and
opted out one at a time, like critical extensions in X.509 with the default
inverted. The marker sits on the field, is valid JSON, and reads like
TypeScript. A `$optional: [names]` list was rejected: it declares at a
distance and repeats names.

`?` and `Optional[T]` answer different questions for different parties. The
sender says whether the receiver may ignore a field it does not know. The
receiver says whether the sender may omit a field.

## D6. `errors.ErrUnsupported` marks what this client cannot do

An unknown field wraps `errors.ErrUnsupported`. Later layers use the same
error for unknown config types and for features a platform lacks, so one
mechanism can fall back from any of them. A provider gets two levels of
forward compatibility: `?` for tweaks that can be ignored, and a choice
between whole alternatives for the rest.

## D7. Our own decoder, not a mapping library

The decoding rules are particular to this format: reserved `$` keys, the
`?` suffix, unsupported-versus-invalid errors, paths and positions in
errors, and `Optional`. Wrapping a general decoder would need as much code
around it as the direct walk over the syntax tree, with less control.

## D8. Aliases are resolved by the package

`ParseYAML` indexes every anchor in the document, and nodes resolve aliases
when they are read. Nothing is expanded up front, so an alias cannot
multiply memory. `Decode` limits depth and the number of values it visits,
so a config cannot multiply work either.

## D9. Merge keys follow the YAML convention

The access-key documentation uses merge keys (`<<`) to share a cipher and
secret between the TCP and UDP halves of a transport, so the format
supports them: https://developer.getoutline.org/vpn/reference/access-key-config/

A key in the mapping wins over a merged key, and earlier merge sources win
over later ones, as the YAML merge key specification says. Merges are
expanded when a mapping's entries are read, before fields are matched, so
they behave the same for every way a mapping is used. Expansion is limited
in depth and in total work, so a mapping that merges itself is an error
and repeated aliases cannot multiply the work of a short merge list.

The YAML library's own decoder cannot read the documented example in which
an anchor is defined inside a merge value and used again later in the
document (`<<: &shared {...}` followed by `udp: *shared`). Resolving
aliases in this package makes that example work.

## D10. Shorthand belongs to each parser

Decoding a scalar into a struct is an error. A shorthand such as
`host:443` for a whole endpoint is the meaning of one config type, and is
handled by the parser of that type.

## D11. Package name: `composer`

The system is Outline Composer: the notation and toolkit for composing
network strategies. `config` was rejected as too generic, and it collides
with the `config` variable at most call sites. `configyaml` was rejected
because it names one serialization.

## Findings about goccy/go-yaml v1.18.0

`goccy_test.go` pins the library behaviors that the package relies on:

- A mapping always parses as `*ast.MappingNode`. Older versions used
  `*ast.MappingValueNode` for a single pair, and `mappingEntries` still
  accepts it.
- `IntegerNode.Value` is `uint64` for every non-negative integer and
  `int64` for negative ones.
- `yes` and `no` parse as strings, as in YAML 1.2.
- A trailing `?` is part of a plain key, so `padding?:` works.
- Block text has its chomping applied in the syntax tree already.
- The library rejects an anchor whose value is an alias (`&x *x`). The
  alias depth limit is a second line of defense.
- The library rejects duplicate mapping keys.
