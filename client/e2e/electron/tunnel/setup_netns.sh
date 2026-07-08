#!/bin/bash
#
# Copyright 2026 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Prepares (or tears down) the hermetic network environment for the desktop
# real-tunnel E2E suite (client/e2e/electron/tunnel.spec.ts). Run as root.
#
#   setup_netns.sh up     create the environment (idempotent)
#   setup_netns.sh down   remove it (idempotent)
#
# Topology ("only reachable through the tunnel" by construction):
#
#   root namespace                        netns $NETNS
#   ┌───────────────────┐                ┌─────────────────────────────────┐
#   │ Outline client    │   veth pair    │ e2eserver:                      │
#   │ $VETH_HOST        │◄──────────────►│  - Shadowsocks on $SS_IP:19999  │
#   │ $HOST_IP/24       │                │    ($VETH_NS, $SS_IP/24)        │
#   └───────────────────┘                │  - HTTP target on $TARGET_IP:80 │
#                                        │    (on lo, netns-local only)    │
#                                        └─────────────────────────────────┘
#
# The root namespace can reach $SS_IP (the Shadowsocks server) over the veth,
# but has no route to $TARGET_IP: the HTTP target is reachable only by
# egressing from inside the namespace, i.e. only through the tunnel.
#
# /etc/netns/$NETNS/hosts points the client's connectivity-check domains at
# the HTTP target, so the hermetic environment satisfies the HTTP HEAD check
# the client runs when it connects (see client/go/outline/connectivity).
#
# The client's Linux backend establishes the VPN via NetworkManager DBus, so
# NetworkManager must be running. To keep it away from the runner's primary
# network (GitHub runners use systemd-networkd), every non-Outline interface
# is declared unmanaged before NetworkManager starts.

set -eu

NETNS='outline-e2e'
# Interface names are limited to 15 characters.
VETH_HOST='oe2e-host'
VETH_NS='oe2e-ns'
HOST_IP='10.200.0.1'
SS_IP='10.200.0.2'
TARGET_IP='10.200.1.1'
NM_CONF='/etc/NetworkManager/conf.d/99-outline-e2e-unmanaged.conf'

# Domains probed by the client's TCP connectivity check
# (client/go/outline/connectivity/connectivity.go testTCPURLs).
CHECK_DOMAINS=(
  connectivitycheck.gstatic.com
  cp.cloudflare.com
  captive.apple.com
  www.google.com
)

ensure_network_manager() {
  if ! command -v NetworkManager >/dev/null; then
    echo 'Installing NetworkManager...'
    DEBIAN_FRONTEND=noninteractive apt-get install -y network-manager
  fi

  # Keep NetworkManager's hands off everything except the Outline TUN device
  # (which the client backend explicitly manages): a newly started
  # NetworkManager must not touch the runner's primary interface or our veth.
  mkdir -p "$(dirname "$NM_CONF")"
  cat > "$NM_CONF" <<'EOF'
[keyfile]
unmanaged-devices=interface-name:eth*;interface-name:ens*;interface-name:enp*;interface-name:eno*;interface-name:veth*;interface-name:oe2e-*;interface-name:docker*;interface-name:br-*
EOF

  if systemctl is-active --quiet NetworkManager; then
    nmcli general reload conf
  else
    systemctl start NetworkManager
  fi
  systemctl is-active --quiet NetworkManager
  echo 'NetworkManager is running.'
}

up() {
  ensure_network_manager

  # Idempotency: rebuild from scratch.
  down_quiet

  ip netns add "$NETNS"
  ip link add "$VETH_HOST" type veth peer name "$VETH_NS" netns "$NETNS"

  ip addr add "$HOST_IP/24" dev "$VETH_HOST"
  ip link set "$VETH_HOST" up

  ip -n "$NETNS" addr add "$SS_IP/24" dev "$VETH_NS"
  ip -n "$NETNS" link set "$VETH_NS" up
  ip -n "$NETNS" link set lo up
  # The HTTP target address lives on the namespace loopback, so it has no
  # route from the root namespace.
  ip -n "$NETNS" addr add "$TARGET_IP/32" dev lo

  # `ip netns exec` bind-mounts /etc/netns/$NETNS/hosts over /etc/hosts, so
  # only processes inside the namespace resolve the check domains locally.
  mkdir -p "/etc/netns/$NETNS"
  {
    echo '127.0.0.1 localhost'
    for domain in "${CHECK_DOMAINS[@]}"; do
      echo "$TARGET_IP $domain"
    done
  } > "/etc/netns/$NETNS/hosts"

  echo "Network namespace $NETNS is ready:"
  echo "  Shadowsocks endpoint: $SS_IP (reachable from the root namespace)"
  echo "  HTTP target:          $TARGET_IP (reachable only inside $NETNS)"
}

down_quiet() {
  ip netns delete "$NETNS" 2>/dev/null || true
  ip link delete "$VETH_HOST" 2>/dev/null || true
  rm -rf "/etc/netns/$NETNS"
  # A crashed run can leave the client's NetworkManager connection profile
  # behind; remove it so the next run starts clean.
  nmcli connection delete 'Outline TUN Connection' 2>/dev/null || true
}

down() {
  down_quiet
  rm -f "$NM_CONF"
  if systemctl is-active --quiet NetworkManager; then
    nmcli general reload conf
  fi
  echo "Network namespace $NETNS removed."
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo 'This script must run as root.' >&2
  exit 1
fi

case "${1:-}" in
  up) up ;;
  down) down ;;
  *)
    echo "Usage: $0 up|down" >&2
    exit 1
    ;;
esac
