# Outline Config Registry

## Overview

The Outline Config framework is a composable and extensible system to specify network strategies:

- **Composable** because it lets strategies to be combined to build more advanced strategies.
  For example, Shadowsocks-over-Websocket, or multi-hop.
- **Extensible** because it's possible to register new strategies without having to change the
  framework.

This framework underpins how the Outline client understands and establishes connections through various proxy protocols and combinations.

## Configuration Format: YAML

The config framework is based on YAML. JSON is a strict subset of YAML, so JSON notation can be used
as well. YAML was chosen for several reasons that enhance readability and maintainability:

- Removes the need for quotes in field names and many string values.
- Allows the use of comments.
- Has anchors, which can reduce duplication.

We use the `github.com/goccy/go-yaml` library for parsing. This library was chosen after encountering issues with bugs in corner cases with the `gopkg.in/yaml.v3` library.

## Core concepts

The format is read by the [`composer`](../../composer) package, which has no dependency on the Outline Client.

`composer.ParseYAML` reads a config into a `composer.Node`. A node is a handle to a value in the document: a map, a list, a single value, or nothing. It resolves YAML anchors and merge keys, and its errors name the place in the config. `Node.Decode` maps a node onto a Go struct. Fields are required unless their type is `composer.Optional`, unknown fields are unsupported, and a field of type `composer.Node` is left for another parser to read.

A `composer.Parser[T]` turns a node into a Go value of type `T`:

```go
type Parser[T any] func(ctx context.Context, registry Registry, node Node) (T, error)
```

A `composer.Registry` holds the parsers, keyed by the Go type they return and by a name. `composer.Parse[T](ctx, registry, node)` picks the parser: when the node is a map with a `$type` attribute, the one registered for `T` under that name.

Example of `$type` usage in YAML:

```yaml
endpoint:
  $type: shadowsocks
  address: "127.0.0.1:8080"
  cipher: "chacha20-ietf-poly1305"
  password: "your_password"
```

Here, `composer.Parse` for an endpoint type would see `$type: shadowsocks` and call the parser registered for that type as "shadowsocks".

A value that is not a map, or is a map without a `$type` attribute, goes to the parser registered for `T` under `composer.DefaultName`. This is helpful for handling cases like parsing strings and the empty value. For example, a stream endpoint can be specified simply as a string address (e.g., `"proxy.example.com:443"`).

A parser parses the values nested in its own with `composer.Parse` and the registry it was given. It does not hold on to other parsers. So any Go type can be a config type, registered from any package, and whoever calls `composer.Parse` decides which parsers apply to the whole config.

`first-supported` is available for every type. It takes a list of options and uses the first one this client supports.

## Application Concepts

The Outline config defines a few concepts that are closely tied to the client application.

In [types.go](./types.go), we define a few higher-level types for the Outline config.
Some of these are wrappers around concepts from the Outline SDK, augmented with additional behavior or metadata needed by the application. For instance, we might add information about the first hop of a strategy, indicating whether it's a direct connection or tunneled, and if tunneled, the tunnel address. The use of generics in these types helps minimize code duplication.

One of the central pieces is the `TransportPair`, an object used by the VPN code to create TCP and UDP tunnels. The `NewRegistry` function returns the registry with the config types of the client. This is where different network strategies (like Shadowsocks, HTTP proxies, Websockets, etc.) are registered. A transport is parsed with `composer.Parse[*TransportPair]`.

Example of registering parsers in `NewRegistry`:

```go
// Websocket support.
composer.Register(r, "websocket", parseWebsocketStreamEndpoint)
composer.Register(r, "websocket", parseWebsocketPacketEndpoint)
```

The two parsers have the same name and different result types: `*Endpoint[transport.StreamConn]` and `*Endpoint[net.Conn]`.

## Adding a New Strategy or Dialer

To introduce a new network capability (e.g., custom proxy protocol, dialing strategy), follow these steps:

1. **Create the Parser Function**:
   Write a `composer.Parser` that transforms the config node into a native connection interface, such as `*Dialer[transport.StreamConn]`. If your dialer delegates downward to a nested endpoint, parse it with the registry.

   ```go
   func parseMyStrategyDialer(ctx context.Context, r composer.Registry, node composer.Node) (*Dialer[transport.StreamConn], error) {
       // 1. Decode `node` into your custom struct, with the nested endpoint as a `composer.Node`
       // 2. Parse the nested endpoint: composer.Parse[*Endpoint[transport.StreamConn]](ctx, r, config.Endpoint)
       // 3. Instantiate your streaming strategy
       // 4. Return a `Dialer` with the connection info: whether it's tunneled, and the first hop
   }
   ```

2. **Register the Strategy**:
   Locate the `NewRegistry` function in [`registry.go`](registry.go).
   Register your parser there. Its result type selects the category (stream dialer, packet dialer, endpoint, ...). The string key you provide will act as the native identifier for the matching `$type` field inside Outline configuration files.

   ```go
   composer.Register(r, "my_strategy", parseMyStrategyDialer)
   ```

   Code outside this package can do the same on the registry that `NewRegistry` returns, and pass it as `ClientConfig.Registry`. It can also register parsers for its own Go types.
