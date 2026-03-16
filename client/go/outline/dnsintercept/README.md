# dnsintercept

This package intercepts DNS traffic inside the VPN tunnel and routes it reliably through the proxy, even when UDP is blocked by the network.

## Key abstractions

This package works in terms of three interfaces from the `golang.getoutline.org/sdk/network` package that model UDP packet flow through the proxy.

**`PacketProxy`** represents anything that can handle UDP sessions.  It has a single method:

```go
NewSession(resp PacketResponseReceiver) (PacketRequestSender, error)
```

Calling `NewSession` tells the proxy that a new UDP flow has started.  The caller supplies a `PacketResponseReceiver` (where incoming packets will be delivered) and gets back a `PacketRequestSender` (where it will send outgoing packets).

**`PacketRequestSender`** is the outbound half of a session — the handle the network stack uses to send packets *into* the proxy:

```go
WriteTo(p []byte, destination netip.AddrPort) (int, error)
Close() error
```

**`PacketResponseReceiver`** is the inbound half — a callback the proxy calls to deliver packets *back* to the network stack:

```go
WriteFrom(p []byte, source net.Addr) (int, error)
Close() error
```

Put together, a session looks like this:

```mermaid
sequenceDiagram
    participant Stack as Network stack
    participant Proxy as PacketProxy

    Stack->>Proxy: NewSession(responseReceiver) → requestSender
    loop per outgoing packet
        Stack->>Proxy: requestSender.WriteTo(packet, dst)
    end
    loop per incoming packet
        Proxy->>Stack: responseReceiver.WriteFrom(packet, src)
    end
    Stack->>Proxy: requestSender.Close()
    Proxy->>Stack: responseReceiver.Close()
```

The two halves are independent: outgoing packets flow through `WriteTo`, incoming packets are pushed back via `WriteFrom`.  Either side can close independently.

The wrappers in this package implement `PacketProxy` and intercept `WriteTo` / `WriteFrom` calls to rewrite addresses or generate synthetic responses, then delegate to an inner proxy for everything else.

## Background

When the Outline VPN is active, the OS is configured to send all DNS queries to a fake link-local address (`169.254.113.53:53`).  This address is served by the VPN tunnel itself — no real server listens there.  The `dnsintercept` package sits at the boundary between the OS and the proxy transport, intercepting those queries and handling them appropriately.

DNS can travel over both TCP and UDP:

- **TCP** is simple: queries always get through via the proxy's stream dialer.
- **UDP** is conditional: queries can be forwarded via UDP only if the proxy supports it.  On some networks, UDP is blocked entirely.

## How UDP DNS is handled

UDP connectivity is not guaranteed, so the package uses two strategies and switches between them dynamically.

### Forward mode (UDP available)

DNS queries are forwarded over UDP to a public resolver (Cloudflare, Quad9, or OpenDNS, chosen randomly per session) through the proxy transport.  Responses are rewritten to appear to come from the original fake address.

```mermaid
sequenceDiagram
    participant OS
    participant forwardPacketProxy
    participant Transport
    participant Resolver as Public DNS resolver

    OS->>forwardPacketProxy: UDP query to 169.254.113.53:53
    forwardPacketProxy->>Transport: UDP query to 1.1.1.1:53 (remapped)
    Transport->>Resolver: query
    Resolver->>Transport: response
    Transport->>forwardPacketProxy: UDP response from 1.1.1.1:53
    forwardPacketProxy->>OS: response from 169.254.113.53:53 (remapped back)
    Note over forwardPacketProxy: session closed immediately after response
```

Each DNS session (one query/response pair) opens a transport session for the duration of the exchange and closes it as soon as the response is delivered.  This keeps resource usage proportional to in-flight queries rather than to recent query rate.

### Truncate mode (UDP unavailable)

If UDP is blocked, forwarding silently fails and DNS stops working.  To handle this, the package falls back to *truncate mode*: it responds immediately to every UDP DNS query with a [truncated DNS response](https://www.rfc-editor.org/rfc/rfc1035#section-4.1.1) (the TC bit set).  This is a standard DNS signal telling the OS to retry the same query over TCP, which goes through the stream dialer and always works.

```mermaid
sequenceDiagram
    participant OS
    participant truncatePacketProxy
    participant StreamDialer
    participant Resolver as Public DNS resolver

    OS->>truncatePacketProxy: UDP query to 169.254.113.53:53
    truncatePacketProxy->>OS: truncated response (TC=1), no transport used
    Note over OS: retries over TCP automatically
    OS->>StreamDialer: TCP query to 169.254.113.53:53
    StreamDialer->>Resolver: TCP query to 1.1.1.1:53 (remapped)
    Resolver->>StreamDialer: TCP response
    StreamDialer->>OS: TCP response
```

In truncate mode, no transport session is opened for DNS at all — the truncated response is generated locally.  Non-DNS UDP traffic still flows through the transport normally (a base transport session is opened lazily on the first non-DNS packet).

## Dynamic switching

The two modes are wired together by the caller (`config.wrapTransportPairWithOutlineDNS`) using a `DelegatePacketProxy`.  The VPN starts in truncate mode (safe default) and switches to forward mode once UDP connectivity is confirmed.  It switches back to truncate mode if connectivity is lost.

```mermaid
flowchart LR
    OS["OS (UDP traffic)"] --> ppMain
    check["UDP connectivity check<br/>(on network change)"] -->|pass| ppMain
    check -->|fail| ppMain

    ppMain{{"DelegatePacketProxy<br/>(ppMain)"}}
    ppMain -->|UDP available| ppForward["forwardPacketProxy<br/>(DNS → resolver via transport)"]
    ppMain -->|UDP blocked| ppTrunc["truncatePacketProxy<br/>(DNS → TC response locally)"]

    ppForward --> ppBase["base PacketProxy<br/>(transport)"]
    ppTrunc --> ppBase
```

## Package contents

| File | Description |
|------|-------------|
| `forward.go` | `WrapForwardStreamDialer` and `WrapForwardPacketProxy` — redirect DNS to a real resolver |
| `truncate.go` | `WrapTruncatePacketProxy` — respond with TC=1 to force TCP retry |
| `helpers.go` | `isEquivalentAddrPort` — address comparison ignoring IPv4-in-IPv6 mapping |
