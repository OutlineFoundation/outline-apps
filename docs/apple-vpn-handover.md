# Apple VPN server handover

## Behavior

Connecting to another server keeps the existing system VPN interface, routes,
and DNS configuration installed. The app uses versioned provider messages
instead of stopping and restarting `NETunnelProviderSession`.

1. Prepare the replacement client and check TCP connectivity while the current
   server continues carrying traffic. Do not create another remote device here:
   the SDK's lwIP device is a singleton, and configuring another closes the old one.
2. Save a pending configuration alongside the current configuration in the system
   VPN preferences, without changing on-demand rules.
3. Commit the prepared client on the packet queue. Close the old packet engine,
   create its replacement, and attach a new return-traffic relay. Keep exactly
   one packetFlow reader and serialize its writes with replacement and shutdown.
4. Write an atomic commit marker containing only the transaction UUID. The
   extension uses a pending configuration after restart only when its token
   matches this marker. Finalize the preferences and emit logical server-change
   events; these do not represent a system VPN disconnect.

An unreachable or invalid replacement fails before changing the packet engine.
A failure after replacement retains routes, drops traffic, and marks the old
logical server as reconnecting so the user can retry or disconnect. An expired,
unsupported, or failed IPC request never falls back to stop/start. A lost commit
reply is reconciled using both runtime server ID and transaction token, including
when refreshing a configuration for the same server ID.

Explicit Disconnect still tears down the system VPN. It cancels pending starts,
including a switch whose runtime identity has already changed. Complete app
operations are serialized across asynchronous waits. Failure to read VPN
preferences does not get interpreted as an absent VPN. Older extensions retain
status notifications, but cannot perform this protected handover until restarted
with the updated extension.

Network loss now marks the provider as reasserting without clearing its routes
or DNS. A failed routing refresh does not deliberately cancel the VPN. Private
network exclusions, including the Tailscale address range, are unchanged.

## Scope and limitations

- This is an Apple client implementation, not a Windows/Linux/Android change.
- Existing TCP sessions may need to reconnect when the remote server changes.
  There is no promise of instant migration or a zero-millisecond interruption.
- Preflight checks TCP connectivity, not every destination or UDP service.
- This is not a general kill switch. Existing route exclusions and IPv4-only
  configuration are unchanged. Explicit network bindings, other VPNs, OS behavior,
  extension crashes, and termination can have separate effects.
- IPC waits are bounded; OS preference operations and transport teardown can
  have additional waits. Disconnect can wait for an in-flight operation to settle.

## Verification and release gate

Focused verification uses the actual source with controlled adapters, outside
the repository; no test/spec files were added or modified.

- 100 app handovers and 100 provider handovers passed, with checks for explicit
  disconnect, rapid switches, failed preparation/commit/preferences, unsupported
  IPC, missing replies, same-ID refresh, expired/replayed tokens, delayed
  preparation after stop, network loss, commit-marker failure, and restart
  selection before and after commit.
- A real Go/lwIP probe reproduced destruction of the active singleton when a
  second device is created before its health is known. Ten failed/successful
  client-only preflight cycles kept the existing device usable under `-race`,
  with controlled in-memory transports and no external network requests.
- Existing Go connectivity tests passed with `-race`; VPN and tun2socks packages
  compiled. Targeted `go vet` passed.
- The arm64 Mac Catalyst Go framework built. Changed Swift and Objective-C
  sources compiled against the Catalyst SDK and generated bindings with a
  logging adapter. This is not a complete signed application build.

Before merging or releasing, build the complete Apple application and validate a
signed extension with on-device packet capture. The full local Xcode attempt
could not complete: the generated Cordova host project was absent and package
resolution remained unfinished. No running VPN or installed app was modified.

Before release, capture TCP, UDP, and DNS on the physical interface during
successful and failed server switches, same-ID refresh, network loss/recovery,
rapid connect/disconnect, and app/provider termination. Verify explicit
Disconnect restores ordinary networking and intentional private-network
exceptions still work. Check both macOS and iOS, including supported older OS
versions and upgrades with an already-running older extension.

References: [Apple packet tunnel routing](https://developer.apple.com/documentation/networkextension/nepackettunnelprovider),
[Apple reasserting state](https://developer.apple.com/documentation/networkextension/netunnelprovider/reasserting).
