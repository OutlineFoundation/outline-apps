# Outline Composer Format Specification

Status: Draft. This document is normative for the `composer` package.

## Documents

A config is a single-document YAML text. JSON is a subset of YAML, so a
JSON document is also valid. Multi-document streams are rejected.

## Values

A config value is one of:

- **Scalar**: string, integer, float, boolean.
- **Mapping**: string keys to config values. Duplicate keys are an error.
- **Sequence**: list of config values.
- **Absent**: a missing field, or an explicit `null` or empty value.
  `field: null` and omitting `field` are equivalent.

YAML anchors (`&name`) and aliases (`*name`) are supported. An alias may
refer to an anchor defined anywhere in the document, including later in it.
YAML tags (`!!str`, `!custom`) are not supported.

### Merge keys

The YAML merge key `<<` inserts the entries of another mapping into the
mapping that holds it, so that shared config sections are written once:

```yaml
tcp:
  $type: shadowsocks
  endpoint: ss.example.com:80
  <<: &cipher
    cipher: chacha20-ietf-poly1305
    secret: SECRET
udp:
  $type: shadowsocks
  endpoint: ss.example.com:53
  <<: *cipher
```

- A key written in the mapping itself wins over a merged key, wherever the
  `<<` appears.
- The value of `<<` is a mapping or a sequence of mappings. Earlier mappings
  in the sequence win over later ones.
- A merge is shallow: it adds top-level keys only. A merged mapping may
  itself contain `<<`, up to 20 levels.
- Merges are expanded before fields are matched, so they apply to every use
  of a mapping.

## Reserved key namespace: `$`

Mapping keys starting with `$` are reserved for the format and are never
treated as fields:

- `$defs`: the conventional place to define anchors for reuse elsewhere in
  the document. Its content is otherwise ignored.
- All other `$` keys are reserved for future use and ignored.

## Field naming

Field names are lowercase `snake_case`, as in `server_port`. Matching is
tolerant: keys are compared case-insensitively with underscores removed, so
`serverport` and `Server_Port` match the same field. `snake_case` is the
spelling for documentation and examples. Error messages name fields in the
normalized form (`serverport`), which is always a valid spelling.

## Fields the receiver requires

A parser declares the fields of a mapping. Every field is **required**
unless the parser declares it optional: the config must set a required field
to a value that is not absent.

A field the parser does not declare is an error. It means this client cannot
do what the config asks. The error is reported as *unsupported*, which lets
a config offer an alternative (see the `?` suffix below).

## Fields the sender allows to be ignored: the `?` suffix

A key ending in `?`, as in `padding?: 32`, tells the parser that the field
is **safe to ignore if unknown**:

- Known field with `?`: parsed as usual. The `?` changes nothing.
- Unknown field with `?`: skipped.
- Unknown field without `?`: an *unsupported* error.
- The same field both with and without `?`: an error.

The `?` applies to recognizing the key only. If the field is known, an error
inside its value is still an error.

## Scalar conversions

| Config value       | Accepted for                               | Notes                                |
|--------------------|--------------------------------------------|--------------------------------------|
| string, block text | string fields                              | no conversion from numbers or booleans |
| integer            | integer fields (range-checked), float fields | no conversion from strings           |
| float              | float fields                               |                                      |
| boolean            | boolean fields                             | only `true` and `false`              |

A parser may declare that a particular field accepts any scalar and reads it
as text. This exists for fields that deployed configs write both ways, such
as a password made of digits.

A mapping decodes into declared fields, or into an open map of string keys,
whose keys are taken verbatim with no `$` or `?` meaning. A sequence decodes
into a list.

## Limits

To protect against adversarial configs:

- Alias indirection: at most 20 levels.
- Merge expansion: at most 100,000 mapping and sequence values.
- Nesting: at most 100 levels per decoded value.
- Work: at most 100,000 values visited per decoded value. This defeats
  alias amplification ("billion laughs").
