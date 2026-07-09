# The `netconfig` Package

The transport layer of Outline Composer: config interfaces
(`StreamDialerConfig`, `PacketDialerConfig`, `StreamEndpointConfig`,
`PacketEndpointConfig`, `PacketListenerConfig`, all in interfaces.go),
their concrete config types, and the parsers that build them — one file
per protocol (direct.go, block.go, dialendpoint.go, websocket.go,
shadowsocks.go). Built on `client/go/composer`; read its SPEC.md (wire
format) and AGENTS.md (parser mechanics) first. Consumed by the Outline
app layer at `client/go/outline/configregistry` — read that package's
README.md for how these pieces get registered, wrapped with metadata,
and assembled into a client.

## Two-phase: parse, then `New`

A parser only composes a typed config object; it does no I/O and has no
side effects. Each config type has a `New*(ctx)` method — `NewStreamDialer`,
`NewStreamEndpoint`, etc. — that builds the runtime object. That's where
dependencies actually get invoked and where any build-time side effect
happens (e.g. `StreamDialEndpointConfig.NewStreamEndpoint` resolves the
address via `net.ResolveTCPAddr` when `ResolveAddressFirst` is set).
Keeping parse pure lets a caller inspect a parsed tree — e.g. read the
first-hop endpoint address — without building anything.

`New*` methods take pointer receivers, so only `*T` satisfies the
config interfaces. This is required, not stylistic: the app layer's
`connmeta` side table (see the configregistry README) keys metadata off
a config's pointer identity, which only holds if parsing always
produces the same `*T`.

## The no-app-imports rule

This package is destined for the Outline SDK (see `composer/DESIGN.md`
D12). It must never import an Outline application package
(`localhost/client/go/outline/...`), and it must never encode Outline
application policy:

- No `ConnectionProviderInfo` or other connection metadata — the app
  layer computes that in wrappers around these parsers, not the parsers
  themselves.
- No hardcoded User-Agent. `NewWebsocketEndpointParser` takes generic
  `WithWebsocketHeaders(...)` options; the caller (configregistry)
  supplies the actual Outline User-Agent string.
- No DNS interception, cookie-jar paths, or other Outline-specific
  behavior — a `TransportPairConfig`-style aggregate type and any DNS
  wrapping belong in the app layer.
- `ResolveAddressFirst` on `StreamDialEndpointConfig` /
  `PacketDialEndpointConfig` is a generic knob — whether `New` resolves
  the address itself before dialing — with no wire field. It is set by
  the app on the already-parsed config, e.g. because a platform's
  protected-socket routing can't tolerate unprotected system DNS
  resolution at dial time (see `resolveFirstOnThisPlatform` in
  configregistry).

## Adding a new config type

1. Define the config struct with `New*(ctx)` method(s) (pointer
   receiver) implementing the relevant interface(s) from
   interfaces.go.
2. Write a parser: a plain `func(ctx context.Context, node composer.Node)
   (*MyConfig, error)` if it stands alone (see `ParseBlock`), or a
   constructor returning one — `NewMyConfigParser(parseChild
   composer.ParseFunc[OtherConfig], opts ...MyConfigOption)
   composer.ParseFunc[*MyConfig]` — if it delegates to another
   category's parser or takes options (see `NewWebsocketEndpointParser`,
   `NewShadowsocksStreamDialerParser`). Delegated dependencies are
   explicit `composer.ParseFunc` constructor arguments, per
   composer/AGENTS.md.
3. Stop there. Do not register a `$type` name or construct a
   `composer.TypeParser` in this package — netconfig exports parser
   constructors only. Registration (`RegisterSubParser`), metadata
   wrapping, and composing strategies into a client all happen in
   `client/go/outline/configregistry`.

## Where new code belongs: here vs. the app layer

Add it here if it's generic transport behavior any Outline Composer
consumer could use: a new protocol, a new dial/endpoint shape, a new
wrapping transport. Add it in `configregistry` instead if it needs
Outline application state or policy — `ConnectionProviderInfo`, a
User-Agent value, DNS interception, data-directory paths, or anything
that reads from an app-only package like `iptable` or `reporting`.

## Status

Complete. netconfig is the sole transport-config layer for the Outline
client; the legacy `client/go/configyaml` package it replaced has been
deleted.
