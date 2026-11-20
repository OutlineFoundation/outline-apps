# Outline's Composer vocabulary

This package is the Outline Client's vocabulary for configs read with [Composer](../../composer/): the `$type` names, the legacy access-key forms, the app-only configs (`tcpudp`, `basic-access`, `iptable`), and the connection metadata the client shows and routes with.

The client does not use it yet. It is built beside [`configregistry`](../configregistry/), and [`differential_test.go`](differential_test.go) checks that both read every config in its corpus the same way. The client switches over in a later change.

## Using it

```go
registry := composerconfig.NewRegistry(composerconfig.Options{
	DirectStreamDialer: &transport.TCPDialer{},
	DirectPacketDialer: &transport.UDPDialer{},
})
node, err := composer.ParseYAML([]byte(configText))
// Parsing validates and describes. It does no I/O.
cfg, info, err := composerconfig.ParseTransport(ctx, registry, node)
// info.Stream and info.Packet hold the connection type and first hop.
// Building creates the dialers. It does not dial.
pair, err := cfg.NewTransportPair(ctx)
```

Everything that reaches the network builds on the dialers in `Options`, so the client can pass dialers whose sockets are excluded from the VPN.

## Adding a component

1. **Write the config.** A config is a parsed value with a build method, such as `NewStreamDialer(ctx)` for `netconfig.StreamDialerConfig`. Its parser has the type `composer.Parser[T]`: it reads its node, parses nested values through the registry it is given with `composer.Parse`, and does no I/O. A component that other apps can reuse belongs in [`netconfig`](../../composer/netconfig/); one only Outline needs belongs here.
2. **Register it** in `NewRegistry` under its `$type`, once for each result type it can serve.
3. **Describe it.** Add a case to `Describe` in [`metadata.go`](metadata.go) with its connection type and first hop. Until you do, configs that use it are rejected with `ErrNoConnInfo`: the client never treats a config it cannot classify as direct.
4. **Test it.** Add configs to the corpus in `differential_test.go`. `TestFirstHopIsWhatGetsDialed` builds each one over recording dialers and checks that the reported first hop is what actually gets dialed, and that parsing and building dial nothing. A config that `master`'s parser cannot read needs an entry in `legacyUnreadable` with its expected metadata.

## Known gaps

- `master` resolves a direct endpoint's hostname while parsing on Linux and Windows. This package does not do that yet. It needs to happen at build, before the client switches over.
- `basic-access` dials with a new `TCPDialer` instead of the injected one, as `master` does. See the TODO in `transport.go`.
- Built configs have no way to release resources, which components with long-lived sessions will need.
