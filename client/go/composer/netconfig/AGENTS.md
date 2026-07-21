# The `netconfig` Package

The transport contract layer of Outline Composer: config interfaces
(`StreamDialerConfig`, `PacketDialerConfig`, `StreamEndpointConfig`,
`PacketEndpointConfig`, `PacketListenerConfig`, all in interfaces.go),
their shared typed `registry.Kind[T]` extension points, concrete config
types, parser constructors, and optional registration helpers — one
file per protocol (direct.go, block.go, dialendpoint.go, websocket.go,
shadowsocks.go). Built on `client/go/composer`; read its SPEC.md (wire
format) and AGENTS.md (parser mechanics) first. Consumed by the Outline
app layer at `client/go/outline/configregistry` — read that package's
README.md for how these pieces are named, analyzed, and assembled into
a client.

## Two-phase: parse, then `New`

A parser only composes a typed config object; it does no I/O and has no
side effects. Each config type has a `New*(ctx)` method — `NewStreamDialer`,
`NewStreamEndpoint`, etc. — that builds the runtime object. That's where
dependencies actually get invoked. Keeping parse pure lets a caller
inspect a parsed tree — e.g. read the first-hop endpoint address —
without building anything. This package performs no DNS at any stage:
`StreamDialEndpointConfig.NewStreamEndpoint` dials `Address` exactly as
it finds it.

Many `New*` methods take pointer receivers because their config values
or builders are naturally pointer-backed. Analysis does not depend on
pointer identity or a metadata side table.

## Registration helpers

`RegisterBlock`, `RegisterDialEndpoint`, `RegisterDirect`,
`RegisterShadowsocks`, and `RegisterWebsocket` are optional sugar over
the exported parser constructors and `registry.Register`. Each helper:

- takes every `$type` name from its caller;
- installs named entries only, never a fallback;
- may be called again with a different name or configuration; and
- contains no connection analysis or Outline policy.

Advanced consumers remain free to register any exported parser
directly. Multi-Kind registration is non-transactional, matching the
underlying registry.

## The no-app-imports rule

This package is destined for the Outline SDK (see `composer/DESIGN.md`
D12). It must never import an Outline application package
(`localhost/client/go/outline/...`), and it must never encode Outline
application policy:

- No `ConnectionProviderInfo` or other connection metadata — the app
  layer computes that by analyzing the completed typed config graph.
- No hardcoded User-Agent. `NewWebsocketEndpointParser` takes generic
  `WithWebsocketHeaders(...)` options; the caller (`outline/configregistry`)
  supplies the actual Outline User-Agent string.
- No DNS interception, cookie-jar paths, or other Outline-specific
  behavior — a `TransportPairConfig`-style aggregate type and any DNS
  wrapping belong in the app layer.
- No address resolution. `StreamDialEndpointConfig` /
  `PacketDialEndpointConfig` dial `Address` verbatim. An app that needs
  the dialed address to be an IP resolves it and rewrites `Address` on
  the already-parsed config — e.g. because a platform installs a bypass
  route for that address, or because its protected-socket routing can't
  tolerate unprotected system DNS at dial time (see `ConnectionAnalyzer`
  in the app layer).

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
3. Optionally add a `RegisterMyConfig(r, name, ...)` helper when the type
   implements multiple Kinds or otherwise has repeated mechanical
   registration. The caller supplies every wire name and policy option;
   the helper registers named entries only and does not install a
   fallback. Direct `registry.Register` with the exported parser remains
   the fundamental API.

## Where new code belongs: here vs. the app layer

Add it here if it's generic transport behavior any Outline Composer
consumer could use: a new protocol, a new dial/endpoint shape, a new
wrapping transport. Add it in `outline/configregistry` instead if it
needs Outline application state or policy — `ConnectionProviderInfo`, a
User-Agent value, DNS interception, data-directory paths, or anything
that reads from an app-only package like `iptable` or `reporting`.

## Status

Complete. netconfig is the sole transport-config layer for the Outline
client; the legacy `client/go/configyaml` package it replaced has been
deleted.
