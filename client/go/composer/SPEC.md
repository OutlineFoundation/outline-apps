# Outline Composer Format Specification

Status: Draft. This document is normative for the `composer` package.

## Documents

A config is a single-document YAML text (JSON, being a YAML subset, is
also valid). Multi-document streams are rejected.

## Values

A config value is one of:

- **Scalar**: string, integer, float, boolean.
- **Mapping**: string keys to config values.
- **Sequence**: list of config values.
- **Absent**: a missing field, or an explicit `null`/empty value.
  `field: null` and omitting `field` are equivalent.

YAML anchors (`&name`) and aliases (`*name`) are supported and resolved
by the framework, with limits (see Limits). YAML merge keys (`<<`) are
NOT supported and produce an error; use anchors on whole values instead.

## Reserved key namespace: `$`

Mapping keys starting with `$` are reserved for the framework and are
never treated as fields:

- `$type` (string): selects the registered sub-parser for the value.
  A mapping without `$type` is handled by the type's fallback rules
  (e.g. scalar shorthand, legacy formats).
- `$defs`: the conventional place to define YAML anchors for reuse
  elsewhere in the document; parsers ignore its content.
- All other `$` keys are reserved for future use and ignored.

## Field naming

Field names are lowercase `snake_case` (e.g. `server_port`). Matching is
tolerant: keys are compared case-insensitively with underscores removed,
so `serverport` and `Server_Port` match the same field. The canonical
spelling used in documentation and error messages is `snake_case`.

## Sender-side optional fields: the `?` suffix

A key ending in `?` (e.g. `padding?: 32`) tells the parser the field is
**safe to ignore if unknown**:

- Known field, `?` suffix: parsed normally; the `?` changes nothing.
- Unknown field, `?` suffix: skipped.
- Unknown field, no `?`: an error that matches `errors.ErrUnsupported`.
- The same field appearing both with and without `?`: an error.

The `?` marker applies to key *recognition* only. If the field is known,
errors inside its value are real errors. For a whole optional subtree
with fallback semantics, use `first-supported`.

## Receiver-side required fields

Parsers declare their schema as Go structs. Every exported struct field
is **required by default**: the config must set it to a non-absent value.
Fields typed `composer.Optional[T]` are optional. There are no struct
tags.

Unknown fields (without `?`) are always errors: they mean the client
cannot faithfully implement the config.

## Scalar conversions

| Config value       | Go targets                                | Notes                                |
|--------------------|-------------------------------------------|--------------------------------------|
| string, block text | `string`                                  | no coercion from numbers or booleans |
| integer            | `int*`, `uint*` (range-checked), `float*` | no coercion from strings             |
| float              | `float32`, `float64`                      |                                      |
| boolean            | `bool`                                    | only `true`/`false`                  |

A mapping decodes into a struct or a `map[string]T` (map keys are taken
verbatim: no `$`/`?` semantics). A sequence decodes into a slice. Any
value can decode into a `composer.Node` to defer parsing.

## Negotiation and `first-supported`

Errors that mean "this client cannot handle this config" — unknown
`$type`, unknown required field, unsupported platform — match
`errors.ErrUnsupported`. The built-in combinator:

```yaml
$type: first-supported
options:
  - {$type: fancy-new-thing, ...}
  - {$type: old-reliable, ...}
```

tries each option in order, skipping only options that fail with
`ErrUnsupported`; any other error aborts. If no option is supported the
combined error (matching `ErrUnsupported`) reports why each option
failed.

## Limits

To protect against adversarial configs:

- Alias indirection: at most 20 levels.
- Decode depth: at most 100 nested levels.
- Decode work: at most 100,000 values visited per Decode call
  (defeats billion-laughs style alias amplification).
