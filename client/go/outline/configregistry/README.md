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

A `composer.ParseFunc[T]` transforms a `composer.Node` into a Go value of type `T`. The registered parsers currently create connection objects during parsing.

```go
type ParseFunc[T any] func(ctx context.Context, input composer.Node) (T, error)
```

`composer.ParseYAML` parses a document once. A `Node` retains the original source position, configuration path, and document anchors when passed to another parser. Use `Node.Decode` for scalar values and shallow `map[string]composer.Node` or `[]composer.Node` containers. `Node.IsAbsent` recognizes both missing fields and explicit nulls.

YAML merges follow the conventional merge extension: explicit fields override merged fields regardless of their position, and earlier mappings in a merge sequence override later ones. Native validation and saved-config normalization use these same rules. Expansion is bounded. Node accepts one document and rejects explicit YAML tags, duplicate keys/anchors, and non-string mapping keys.

For configuration structs, use `composer.Decoder`. Its zero value uses strict scalar conversions; the migrated parsers explicitly select `composer.Decoder{CoerceScalars: true}` to retain existing scalar conversions. Both modes preserve defaults and reject unknown fields unless `AllowUnknownFields` is explicitly enabled. Fields typed as `composer.Node` receive the original child node for delegation. It does not serialize a subtree and parse it again. Reserved keys beginning with `$`, including `$type`, are ignored at the root of the decoded schema.

Decode errors include the field path and original line and column. Use `node.WrapError(err)` for additional validation errors; wrapping preserves an already located child error and `errors.Is`/`errors.As` checks. An alias retains its access path and the source position of its definition.

`Node.MarshalJSON` expands aliases and merges for storage with bounded traversal. The application supplies the native response envelope.

The context is passed to nested parsers. Dependencies between parsers are still supplied when constructing them.

A `TypeParser[T any]` is a utility that manages the parsing of a specific type `T` which can have multiple implementations or "subtypes".
It allows for the registration of different subparsers (`ParseFunc`s), each associated with a unique subtype name.

When a `TypeParser` encounters a YAML map with a `$type` attribute, it uses the value of `$type` to look up the corresponding registered subparser and delegates the original node to it, including `$type`.

Example of `$type` usage in YAML:

```yaml
endpoint:
  $type: shadowsocks
  endpoint: "127.0.0.1:8080"
  cipher: "chacha20-ietf-poly1305"
  secret: "your_password"
```

Here, a `TypeParser` for an "endpoint" would see `$type: shadowsocks` and delegate to the "shadowsocks" subparser.

When you create a `TypeParser`, a _fallback handler_ must be specified. If the input config is not
a map, or is a map without a `$type` attribute, the fallback handler is called. This is helpful
for handling cases like parsing strings and the empty value. For example, a stream endpoint
can be specified simply as a string address (e.g., `"proxy.example.com:443"`). This string would be parsed by the stream endpoint `TypeParser`'s fallback handler.

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

1. **Create the parser function**:
   Accept a `composer.Node` and return the runtime object. Request any nested parser as a constructor argument. Keep delegated fields as nodes so aliases and source locations survive. For example, this endpoint wrapper delegates its `endpoint` field:

   ```go
   func NewAliasEndpointSubParser[T any](parseEndpoint composer.ParseFunc[*Endpoint[T]]) composer.ParseFunc[*Endpoint[T]] {
       return func(ctx context.Context, input composer.Node) (*Endpoint[T], error) {
           var config struct {
               Endpoint composer.Node
           }
           var decoder composer.Decoder
           if err := decoder.Decode(input, &config); err != nil {
               return nil, err
           }
           return parseEndpoint(ctx, config.Endpoint)
       }
   }
   ```

   Given `endpoint: {$type: alias, endpoint: proxy.example.com:443}`, the nested parser receives the child at `endpoint.endpoint`, with its original source position. The wrapper does not need to know whether that child is a string, mapping, or alias.

2. **Register the strategy**:
   Locate `NewDefaultTransportProvider` in [`registry.go`](registry.go). Register the parser for the appropriate result type. The registration name selects the parser through `$type`:

   ```go
   streamEndpoints.RegisterSubParser("alias", NewAliasEndpointSubParser(streamEndpoints.Parse))
   ```

3. **Test delegation and errors**:
   Exercise the registered parser with a complete YAML document, including nested configuration and aliases defined outside its subtree. Assert the runtime behavior and the path and source position of a nested error. Preserve existing metadata and parse-time behavior when migrating a parser.
