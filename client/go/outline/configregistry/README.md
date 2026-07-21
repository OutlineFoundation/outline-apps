# Outline Config Registry

`configregistry` is the Outline-owned layer above Composer and
`composer/netconfig`. It chooses Outline's `$type` names and compatibility
fallbacks, defines app-only transport configs, analyzes parsed graphs for
connection information, and applies Outline transport policy.

The reusable layers below this package do not know Outline's names,
`ConnectionProviderInfo`, DNS interception, or platform address-resolution
policy.

## Lifecycle

The client config lifecycle is:

```text
YAML → typed config graph → Outline analysis/policy → runtime build
```

1. `ClientConfig.ParseConfig` parses YAML with a `registry.Composer` and gets a
   `TransportPairConfig`. Parsing uses an ordinary `context.Context`; there is
   no metadata table or pointer-identity requirement.
2. `ConnectionAnalyzer.AnalyzeTransport` recursively inspects the concrete
   config graph and returns `TransportPairInfo`. On platforms that need it,
   it also resolves direct dial endpoints and rewrites their `Address` to the
   resolved form, so `FirstHop` is the address that will actually be dialed.
   This performs DNS and honors the context. Unknown concrete configs are
   internal wiring errors.
3. `ParsedClient.NewClient` recursively builds the runtime dialers and
   listeners, then applies Outline's DNS interception.

Analysis is deliberately separate from parsing. Reusable protocol parsers stay
focused on syntax and config construction, while Outline can make app-specific
decisions after the whole graph is known. `first-supported` needs no special
analysis case because parsing has already returned its chosen concrete config.

## Registration

`Register` installs the vocabulary used by the Outline client:

- It registers the named `$type` values `basic-access`, `block`, `dial`,
  `direct`, `iptable`, `shadowsocks`, `tcpudp`, and `websocket`. The source
  registrations stay sorted by this wire name for readability.
- It calls the optional `netconfig.Register…` helpers for WebSocket, dial
  endpoints, Shadowsocks, block, and direct configs. Outline supplies every
  wire name and the WebSocket User-Agent option, while app-only IP-table,
  TCP/UDP, and Basic Access parsers are registered directly.
- It installs Outline's absent-direct, scalar-Shadowsocks, endpoint, and legacy
  top-level transport fallbacks directly.

The `netconfig` helpers are only convenience functions over exported parser
constructors and `registry.Register`. They register named entries only, can be
called again with a different name or options, and do not attach metadata or
install fallbacks. Advanced consumers can always register individual parsers.
Registration is non-transactional, matching `composer/registry`.

## Adding a config type

Generic protocol configs and parser constructors belong in
`composer/netconfig`. Add an optional registration helper there if it removes
repeated mechanical registration across Kinds; keep its name and options
caller-controlled.

Outline-only configs or compatibility behavior belong here. Register their
parsers directly in `Register`, then add an exhaustive concrete-type case to
the relevant `ConnectionAnalyzer` method. Analyzer cases must reject typed nil
pointers and recursively analyze child configs. Repeated analysis must stay
idempotent; address rewriting relies on re-resolving an IP being a no-op.

## Testing

- `analysis_test.go` covers every analyzer category, composition, resolution
  policy, nil/unknown configs, and repeated analysis.
- `analysis_integration_test.go` and `transport_test.go` cover the full
  parse-then-analyze path and compatibility forms.
- `corpus_test.go` preserves the documented config corpus and known gaps.
- `iptable_config_test.go` preserves aggregation and dispatch behavior.
