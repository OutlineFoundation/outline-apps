<!-- markdownlint-disable-file MD033 -->

# Outline Config Reference

Outline uses a YAML-based configuration to define VPN parameters and handle TCP/UDP traffic. The configuration supports composability at multiple levels, enabling flexible and extensible setups.

The top-level configuration specifies a [TunnelConfig](#TunnelConfig).

## Examples

A typical Shadowsocks configuration will look like this:

```yaml
transport:
  $type: tcpudp

  tcp:
    $type: shadowsocks
    endpoint: ss.example.com:4321
    cipher: chacha20-ietf-poly1305
    secret: SECRET
    prefix: "POST "

  udp:
    $type: shadowsocks
    endpoint: ss.example.com:4321
    cipher: chacha20-ietf-poly1305
    secret: SECRET
```

Note how we can now have TCP and UDP running on different ports or endpoints.

You can leverage YAML anchors and the `<<` merge key to avoid duplication:

```yaml
transport:
  $type: tcpudp

  tcp:
    <<: &shared
      $type: shadowsocks
      endpoint: ss.example.com:4321
      cipher: chacha20-ietf-poly1305
      secret: SECRET
    prefix: "POST "

  udp: *shared
```

It's now possible to compose strategies and do multi-hops:

```yaml
transport:
  $type: tcpudp

  tcp:
    $type: shadowsocks

    endpoint:
      $type: dial
      address: exit.example.com:4321
      dialer:
        $type: shadowsocks
        address: entry.example.com:4321
        cipher: chacha20-ietf-poly1305
        secret: ENTRY_SECRET

    cipher: chacha20-ietf-poly1305
    secret: EXIT_SECRET

  udp: *shared
```

In case of blocking of "look-like-nothing" protocols like Shadowsocks, you can use Shadowsocks over Websockets. See the [server examnple configuration](https://github.com/OutlineFoundation/outline-ss-server/blob/master/cmd/outline-ss-server/config_example.yml) on how to deploy it. A client configuration will look like:

```yaml
transport:
  $type: tcpudp
  tcp:
    $type: shadowsocks
    endpoint:
        $type: websocket
        url: wss://legendary-faster-packs-und.trycloudflare.com/SECRET_PATH/tcp
    cipher: chacha20-ietf-poly1305
    secret: SS_SECRET

  udp:
    $type: shadowsocks
    endpoint:
        $type: websocket
        url: wss://legendary-faster-packs-und.trycloudflare.com/SECRET_PATH/udp
    cipher: chacha20-ietf-poly1305
    secret: SS_SECRET
```

Note that the Websocket endpoint can, in turn, take an endpoint, which can be leveraged to bypass DNS-based blocking:

```yaml
transport:
  $type: tcpudp
  tcp:
    $type: shadowsocks
    endpoint:
        $type: websocket
        url: wss://legendary-faster-packs-und.trycloudflare.com/SECRET_PATH/tcp
        endpoint: cloudflare.net:443
    cipher: chacha20-ietf-poly1305
    secret: SS_SECRET

  udp:
    $type: shadowsocks
    endpoint:
        $type: websocket
        url: wss://legendary-faster-packs-und.trycloudflare.com/SECRET_PATH/udp
        endpoint: cloudflare.net:443
    cipher: chacha20-ietf-poly1305
    secret: SS_SECRET
```

Note that Websockets is not yet supported on Windows. In order to have a single config for all platforms, use a `first-supported` for backwards-compatibility:

```yaml
transport:
  $type: tcpudp
  tcp:
    $type: shadowsocks
    endpoint:
      $type: first-supported
      options:
        - $type: websocket
          url: wss://legendary-faster-packs-und.trycloudflare.com/SECRET_PATH/tcp
        - ss.example.com:4321
    cipher: chacha20-ietf-poly1305
    secret: SS_SECRET

  udp:
    $type: shadowsocks
    endpoint:
      $type: first-supported
      options:
        - $type: websocket
          url: wss://legendary-faster-packs-und.trycloudflare.com/SECRET_PATH/udp
        - ss.example.com:4321
    cipher: chacha20-ietf-poly1305
    secret: SS_SECRET
```

In case the count of users is needed to have an exact estimate of the sessions, a reporting server can be used for that. This feature is currently experimental.

```yaml
transport:
  $type: tcpudp
  tcp:
    <<: &shared
      $type: shadowsocks
      endpoint: ss.example.com:4321
      cipher: chacha20-ietf-poly1305
      secret: SECRET
    prefix: "POST "
  udp: *shared

reporter:
  $type: http
  request:
    # URL is the only required field.
    url: https://your-callback-server.com/outline_callback
    method: POST  # This is the default, no need to specify
    headers:
      Content-Type: [application/json]
      Authorization: [Bearer SECRET]
    body: '{"foo": "bar"}'
  # Optional. If not specified reporting happens once at the start of the session.
  interval: 24h
  # Optional. If enabled, the HTTP client will remember cookies across sessions.
  enable_cookies: true
```

## Tunnels

### <a id=TunnelConfig></a>TunnelConfig

Tunnel is the top-level object in the Outline configuration returned by [Dynamic Access Keys](https://www.reddit.com/r/outlinevpn/wiki/index/dynamic_access_keys/). It specifies how the VPN should be configured.

**Format:** [ExplicitTunnelConfig](#ExplicitTunnelConfig) | [LegacyShadowsocksConfig](#LegacyShadowsocksConfig) | [LegacyShadowsocksURI](#LegacyShadowsocksURI)

### <a id=ExplicitTunnelConfig></a>ExplicitTunnelConfig

**Format:** _struct_

**Fields:**

- `transport` ([TransportConfig](#TransportConfig)): the transport to use to exchange packages with the target destination
- `error` (_struct_): information to communicate to the user in case of service error (e.g. key expired, quota exhausted)
  - `message` (_string_): user-friendly message to display to the user
  - `details` (_string_): message to display when the user opens the error details. Helpful for troubleshooting.

Fields `error` and `transport` are mutually exclusive.

Successful example:

```yaml
transport:
  $type: tcpudp
  tcp:
    ...  # Stream Dialer for TCP
  udp:
    ...  # Packet Listener for UDP
```

Error example:

```yaml
error:
  message: Quota exceeded
  details: Used 100GB out of 100GB
```

## Transports

### <a id=TransportConfig></a>TransportConfig

Specifies how packets should be exchanged with the target destination.

**Format:** [Interface](#Interface)

Supported Interface types:

- `tcpudp`: [TCPUDPConfig](#TCPUDPConfig)

### <a id=TCPUDPConfig></a>TCPUDPConfig

TCPUDPConfig allows for setting separate TCP and UDP strategies.

**Format:** _struct_

**Fields:**

- `tcp` ([DialerConfig](#DialerConfig)): the Stream Dialer to use for TCP connections.
- `udp` ([PacketListenerConfig](#PacketListenerConfig)): the Packet Listener to use for UDP packets.

Example sending TCP and UDP to different endpoints:

```yaml
tcp:
  $type: shadowsocks
  endpoint: ss.example.com:80
  <<: &cipher
    cipher: chacha20-ietf-poly1305
    secret: SECRET
  prefix: "POST "

udp:
  $type: shadowsocks
  endpoint: ss.example.com:53
  <<: *cipher
```

## Endpoints

Endpoints establish connections to a fixed endpoint. It's preferable over Dialers since it allows for endpoint-specific optimizations. There are Stream and Packet Endpoints.

### <a id=EndpointConfig></a>EndpointConfig

**Format:** _string_ | [Interface](#Interface)

The _string_ Endpoint is the host:port address of the desired endpoint. The connection is established using the default Dialer.

Supported Interface types for Stream and Packet Endpoints:

- `dial`: [DialEndpointConfig](#DialEndpointConfig)
- `first-supported`: [FirstSupportedConfig](#FirstSupportedConfig)
- `websocket`: [WebsocketEndpointConfig](#WebsocketEndpointConfig)
<!-- TODO(fortuna): Add Shadowsocks endpoint
- `shadowsocks`: [ShadowsocksConfig](#ShadowsocksConfig)
-->

### <a id=DialEndpointConfig></a>DialEndpointConfig

Establishes connections by dialing a fixed address. It can take a dialer, which allows for composition of strategies.

**Format:** _struct_

**Fields:**

- `address` (_string_): the endpoint address to dial
- `dialer` ([DialerConfig](#DialerConfig)): the dialer to use to dial the address

### <a id=WebsocketEndpointConfig></a>WebsocketEndpointConfig

Tunnels stream and packet connections to an endpoint over Websockets.

For stream connections, each write is turned into a Websocket message. For packet connections, each packet is turned into a Websocket message.

**Format:** _struct_

**Fields:**

- `url` (_string_): the URL for the Websocket endpoint. The schema must be `https` or `wss` for Websocket over TLS, and `http` or `ws` for plaintext Websocket. 
- `endpoint` ([EndpointConfig](#EndpointConfig)): the web server endpoint to connect to. If absent, is connects to the address specified in the URL.


## Dialers

Dialers establishes connections given an endpoint address. There are Stream and Packet Dialers.

### <a id=DialerConfig></a>DialerConfig

**Format:** _null_ | [Interface](#Interface)

The _null_ (absent) Dialer means the default Dialer, which uses direct TCP connections for Stream and direct UDP connections for Packets.

Supported Interface types for Stream and Packer Dialers:

- `first-supported`: [FirstSupportedConfig](#FirstSupportedConfig)
- `shadowsocks`: [ShadowsocksConfig](#ShadowsocksConfig)

## Packet Listeners

A Packet Listener establishes an unbounded packet connection that can be used to send packets to multiple destinations.

### <a id=PacketListenerConfig></a>PacketListenerConfig

**Format:** _null_ | [Interface](#Interface)

The _null_ (absent) Packet Listener means the default Packet Listener, which is a UDP Packet Listener.

Supported Interface types:

- `first-supported`: [FirstSupportedConfig](#FirstSupportedConfig)
- `shadowsocks`: [ShadowsocksPacketListenerConfig](#ShadowsocksConfig)

## Strategies

### Shadowsocks

#### <a id=LegacyShadowsocksConfig></a>LegacyShadowsocksConfig

LegacyShadowsocksConfig represents a Tunnel that uses Shadowsocks as the transport. It implements the legacy format for backwards-compatibility.

**Format:** _struct_

**Fields:**

- `server` (_string_): the host to connect to
- `server_port` (_number_): the port number to connect to
- `method` (_string_): the [AEAD cipher](https://shadowsocks.org/doc/aead.html#aead-ciphers) to use
- `password` (_string_): used to generate the encryption key
- `prefix` (_string_): the [prefix disguise](https://www.reddit.com/r/outlinevpn/wiki/index/prefixing/) to use. Currently only supported on stream connections.

Example:

```yaml
server: example.com
server_port: 4321
method: chacha20-ietf-poly1305
password: SECRET
prefix: "POST "
```

#### <a id=LegacyShadowsocksURI></a>LegacyShadowsocksURI

LegacyShadowsocksURI represents a Tunnel that uses Shadowsocks as the transport. It implements the legacy URL format for backwards-compatibility.

**Format:** _string_

See [Legacy Shadowsocks URI Format](https://shadowsocks.org/doc/configs.html#uri-and-qr-code) and [SIP002 URI scheme](https://shadowsocks.org/doc/sip002.html). We don't support plugins.

Example:

```yaml
ss://chacha20-ietf-poly1305:SECRET@example.com:443?prefix=POST%20
```

#### <a id=ShadowsocksConfig></a>ShadowsocksConfig

ShadowsocksConfig can represent a Stream or Packet Dialers, as well as a Packet Listener that uses Shadowsocks.

**Format:** _struct_

**Fields:**

- `endpoint` ([EndpointConfig](#EndpointConfig)): the Shadowsocks endpoint to connect to
- `cipher` (_string_): the [AEAD cipher](https://shadowsocks.org/doc/aead.html#aead-ciphers) to use
- `secret` (_string_): used to generate the encryption key
- `prefix` (_string_, optional): the [prefix disguise](https://www.reddit.com/r/outlinevpn/wiki/index/prefixing/) to use. Currently only supported on stream connections.

Example:

```yaml
endpoint: example.com:4321
cipher: chacha20-ietf-poly1305
secret: SECRET
prefix: "POST "
```

## Meta Definitions

### <a id=FirstSupportedConfig></a>FirstSupportedConfig

Uses the first config that is supported by the application. This is a way to incorporate new configs while being backwards-compatible with old configs.

**Format:** _struct_

**Fields:**

- `options` ([EndpointConfig[]](#EndpointConfig) | [DialerConfig[]](#DialerConfig) | [PacketListenerConfig[]](#PacketListenerConfig)): list of options to consider

### <a id=Interface></a>Interface

Interfaces allow for choosing one of multiple implementations. It uses the `$type` field to specify the type that config represents.

Example:

```yaml
$type: shadowsocks
endpoint: example.com:4321
cipher: chacha20-ietf-poly1305
secret: SECRET
```
