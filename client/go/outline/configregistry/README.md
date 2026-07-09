# Outline Config Registry

## Overview

`configregistry` is the app layer of Outline's config system: it turns
a provider client config (YAML) into a running client. The wire format
and parsing mechanics are Outline Composer (`client/go/composer`); the
transport strategies (Shadowsocks, websocket, direct, block, dialing,
iptable routing) are `client/go/netconfig`. This package sits above
both — it registers netconfig's parsers under `$type` names, attaches
Outline-specific connection metadata to every parsed config, and
applies Outline policy (DNS interception, User-Agent) that must not
leak into the app-agnostic layers below it.

This framework underpins how the Outline client understands and
establishes connections through various proxy protocols and
combinations, including composed ones (Shadowsocks-over-Websocket,
iptable-routed multi-strategy configs, etc.).

## Core concepts

Read `client/go/composer/SPEC.md` (wire format) and
`client/go/composer/AGENTS.md` (parser mechanics) first; this section
only covers what's specific to this package.

Parsing is two-phase, split across `client/go/outline/client.go`:

1. **Parse** (`ClientConfig.ParseConfig`) decodes the YAML into a
   `composer.Node` tree and runs it through the registered
   `composer.TypeParser[TransportPairConfig]`. This produces a typed
   config tree only — no dialing, no sockets, no client. It's pure
   enough that `parse.go`-style callers can read the first-hop endpoint
   off the result without building anything.
2. **Build** (`ParsedClient.NewClient`) calls `NewTransportPair` on the
   parsed config, which recursively calls every child config's
   `New*(ctx)` method (`NewStreamDialer`, `NewStreamEndpoint`, ...) to
   construct the real `transport.StreamDialer` / `transport.PacketListener`.
   Outline policy that must run at build time — DNS interception,
   cookie-jar paths — is applied here, after the netconfig types hand
   back plain dialers/listeners.

netconfig's config types carry no Outline-specific data; this package
adds it in two ways:

- **Connection metadata** (`ConnectionProviderInfo`: `ConnType` +
  `FirstHop`, in [types.go](./types.go)) answers "is this direct or
  tunneled, and what's the first hop address" — used by the TypeScript
  UI (`client/web/app/outline_server_repository/config.ts`) and by
  `parse.go`. It's computed per config object as parsing happens and
  stored in a [`connmeta.Table`](../connmeta) keyed by the config's
  pointer identity (the same pattern as Go's own `go/ast` +
  `go/types.Info`): a `connmeta.Table` is created per parse call
  (`connmeta.WithTable`) and carried in `ctx`; each registered parser is
  wrapped with [`withInfo`](./composer_registry.go) (or
  [`withTransportInfo`](./transport_configs.go) for whole-transport
  configs), which runs the netconfig parser, computes
  `ConnectionProviderInfo` from the already-recorded metadata of any
  child configs (parsing is post-order, so children are always present
  first), and records it under the parsed config's pointer via
  `setInfo`/`requireInfo`. A lookup miss at the root is a wiring bug —
  it must never silently default to "direct", since that mislabels
  tunneled traffic. `first-supported` needs no wrapper: it returns the
  chosen option's config unchanged, so pointer identity carries its
  metadata through automatically.
- **DNS interception and User-Agent** are the other two pieces of
  policy netconfig can't hold (see `client/go/netconfig/AGENTS.md`).
  The Outline User-Agent is injected as a generic HTTP header option
  when the websocket parser is constructed
  (`netconfig.WithWebsocketHeaders`, wired in
  [composer_registry.go](./composer_registry.go)). DNS interception
  (`NewOutlineDNSTransport` in [outline_dns.go](./outline_dns.go)) wraps
  the built `StreamDialer`/`PacketListener` *after* `NewTransportPair`
  returns, in `client.go`, not inside any parser.

`TransportPairConfig` (in [transport_configs.go](./transport_configs.go))
is the app-level aggregate: `NewTransportPair(ctx)` returns a
`TransportPairParts{StreamDialer, PacketListener}`, still undecorated
by DNS policy. Two forms are registered: `tcpudp` (independent TCP and
UDP strategies) and `basic-access` (direct TCP with TLS fragmentation,
plain UDP). A `$type`-less config falls back to the legacy Shadowsocks
form (one Shadowsocks config used for both TCP and UDP), matching the
documented access-key format.

[iptable_config.go](./iptable_config.go) defines the `iptable`
stream-dialer strategy (registered alongside the others in
`newRegistryTables`), which routes by destination IP prefix to
per-entry dialers with an optional fallback. Its `ConnectionProviderInfo`
aggregates its entries: all-direct, all-tunneled, all-blocked, or
`ConnTypePartial` for a mix. It stays in the app layer (not netconfig)
because its dialer implementation depends on the app-local `iptable`
package.

## Adding a new strategy

Most new strategies belong in `client/go/netconfig`, not here — see
`client/go/netconfig/AGENTS.md` for "here vs. the app layer". Add code
in this package only for the registration/wiring step, or for a
strategy that genuinely needs Outline app state (like `iptable`).

1. **Write the netconfig config type and parser** per
   `client/go/netconfig/AGENTS.md` (a `New*(ctx)`-bearing config struct
   plus a `composer.ParseFunc` or parser constructor). Skip this step if
   you're only wiring up an existing netconfig type.
2. **Write an info function** if the strategy carries connection
   metadata: `func(ctx context.Context, cfg *MyConfig)
   (ConnectionProviderInfo, error)`. Read children's info via
   `requireInfo(ctx, childCfg)`; a leaf strategy just returns a literal
   `ConnectionProviderInfo{ConnType: ...}`.
3. **Register it** in `newRegistryTables` (for a dialer/endpoint/listener
   strategy, [composer_registry.go](./composer_registry.go)) or in
   `NewComposerTransportParser` (for a whole-transport strategy,
   [transport_configs.go](./transport_configs.go)):

   ```go
   t.streamDialers.RegisterSubParser("my-strategy",
       asStreamDialer(withInfo(netconfig.NewMyStrategyParser(t.streamEndpoints.Parse), myStrategyInfo)))
   ```

   The `as*` adapters exist because Go won't implicitly convert
   `composer.ParseFunc[*MyConfig]` to `composer.ParseFunc[SomeInterface]`;
   `withInfo`/`withTransportInfo` attach the metadata wrapper described
   above. The string you register (`"my-strategy"`) is the `$type` value
   config authors write in YAML.

Every registered leaf, wrapped or not, must end up with metadata in the
table — `withInfo`/`withTransportInfo` guarantee this for anything that
goes through them; a strategy that bypasses them (like the `direct`
registrations and the `KindAbsent` fallbacks, which are trivial enough
to call `setInfo` inline) must call `setInfo` itself.

## Testing

[corpus_test.go](./corpus_test.go) parses every documented example
config from
https://developer.getoutline.org/vpn/reference/access-key-config/ plus
known-deployed forms, guarding against silent regressions in the public
config surface. [composer_registry_test.go](./composer_registry_test.go),
[transport_configs_test.go](./transport_configs_test.go), and
[iptable_config_test.go](./iptable_config_test.go) cover metadata
computation (including composition through websocket-over-shadowsocks
and `first-supported`) and the missing-table wiring-bug case.
