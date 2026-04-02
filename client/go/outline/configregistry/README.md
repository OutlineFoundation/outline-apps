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

A `ParseFunc[T any]` is a generic function that defines how to transform a configuration (typically a YAML config pre-parsed as a map, list or primitive type) into a specific Go type `T`.

```go
type ParseFunc[T any] func(ctx context.Context, input ConfigNode) (OutputType, error)
```

The `Context` was added to enable parse-time context and sharing between parsers. This is useful for
implementing features like named objects in the config that can be referred to by other parts of the configuration.

A `TypeParser[T any]` is a utility that manages the parsing of a specific type `T` which can have multiple implementations or "subtypes".
It allows for the registration of different subparsers (`ParseFunc`s), each associated with a unique subtype name.

When a `TypeParser` encounters a YAML map with a `$type` attribute, it uses the value of `$type` to look up the corresponding registered subparser and delegates the parsing of that map to it.

Example of `$type` usage in YAML:

```yaml
endpoint:
  $type: shadowsocks
  address: "127.0.0.1:8080"
  cipher: "chacha20-ietf-poly1305"
  password: "your_password"
```

Here, a `TypeParser` for an "endpoint" would see `$type: shadowsocks` and delegate to the "shadowsocks" subparser.

When you create a `TypeParser`, a _fallback handler_ must be specified. If the input config is not
a map, or is a map without a `$type` attribute, the fallback handler is called. This is helpful
for handling cases like parsing strings and the empty value. For example, a stream endpoint
can be specified simply as a string address (e.g., `"proxy.example.com:443"`). This string would be parsed by the stream dialer `TypeParser`'s fallback handler.

## Application Concepts

The Outline config defines a few concepts that are closely tied to the client application.

In [types.go](./types.go), we define a few higher-level types for the Outline config.
Some of these are wrappers around concepts from the Outline SDK, augmented with additional behavior or metadata needed by the application. For instance, we might add information about the first hop of a strategy, indicating whether it's a direct connection or tunneled, and if tunneled, the tunnel address. The use of generics in these types helps minimize code duplication.

One of the central pieces is the `TransportPair`, an object used by the VPN code to create TCP and UDP tunnels. The `NewDefaultTransportProvider` function is responsible for creating the `TypeParser` for `TransportPair`. This is where different network strategies (like Shadowsocks, HTTP proxies, Websockets, etc.) are registered.

Example of registering subparsers in `NewDefaultTransportProvider`:

```go
// Websocket support.
streamEndpoints.RegisterSubParser("websocket", NewWebsocketStreamEndpointSubParser(streamEndpoints.Parse))
packetEndpoints.RegisterSubParser("websocket", NewWebsocketPacketEndpointSubParser(streamEndpoints.Parse))
```

Notice how the dependencies between the subparsers and the parsers they depend on are explicit
and will cause compile-time errors if not provided.

## Adding a New Strategy or Dialer

To introduce a new network capability (e.g., custom proxy protocol, dialing strategy), follow these steps:

1. **Create the Parser Function**:
   Write a parser package or function (`SubParser`) that transforms the YAML block (`map[string]any`) into a native connection interface, such as `*Dialer[transport.StreamConn]`. If your dialer delegates downward to a nested endpoint, require that parser as an argument.

   ```go
   func NewMyStrategyDialerSubParser(parseEndpoint configyaml.ParseFunc[*Endpoint[transport.StreamConn]]) func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
       return func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
           // 1. Unmarshal `input` logic into your custom struct
           // 2. Instantiate your streaming strategy
           // 3. Return a `Dialer` conforming to the interface requirements
       }
   }
   ```

2. **Register the Strategy**:
   Locate the `NewDefaultTransportProvider` function in [`registry.go`](registry.go).
   Register your parsing function into the relevant parser category (`streamDialers` or `packetDialers`). The string key you provide will act as the native identifier for the matching `$type` field inside Outline configuration files.

   ```go
   streamDialers.RegisterSubParser("my_strategy", NewMyStrategyDialerSubParser(streamEndpoints.Parse))
   ```
