// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package org.outline.vpn;

/**
 * Pure state-resolution logic for the Quick Settings tile, factored out of
 * {@link QuickSettingsTileService} so the precedence rules can be unit-tested without the
 * TileService lifecycle.
 *
 * <p>The persisted "did the user turn Outline on" flag is the single source of truth. We
 * intentionally do not consult {@code ConnectivityManager.getAllNetworks()} as a secondary
 * check: an Outline VPN excludes its own UID from its routing set, so on Android 12+ that API
 * — scoped to the caller's UID context — does not return our own VPN network, making the
 * "is my VPN actually up?" check always return false even on the happy path. The stored flag,
 * updated synchronously by {@link VpnTunnelService#broadcastVpnConnectivityChange}, is
 * already authoritative as long as every disconnect path goes through that broadcast (which
 * onRevoke, onDestroy, STOP_ACTIVE_TUNNEL_EXTRA, and IPC stopTunnel all do).
 */
final class QuickSettingsTileState {
  /** What the click handler should do given the current state. */
  enum ClickAction { OPEN_APP, START_VPN, STOP_VPN }

  /** Whether the tile should render as ACTIVE. */
  static boolean shouldShowOn(boolean storedRunningFlag) {
    return storedRunningFlag;
  }

  /**
   * Decide what the tile should do on click.
   *
   * <p>The "is the VPN running" gate uses the persisted user-intent flag, not the live network
   * state. During the startup window after the first tap, ConnectivityManager hasn't yet
   * surfaced our VPN network — a second tap that read live state would treat it as "still off"
   * and send a duplicate start intent, which trips the {@code alreadyRunning} path in
   * VpnTunnelService and disconnects/reconnects the active tunnel mid-session.
   *
   * @param hasSavedTunnel       true if the tunnel store has a previously-configured server.
   * @param vpnConsentGranted    true if {@code VpnService.prepare} returned null
   *                             (no system consent dialog needed).
   * @param userRequestedRunning the persisted "user turned Outline on" flag.
   */
  static ClickAction resolveClick(boolean hasSavedTunnel,
                                  boolean vpnConsentGranted,
                                  boolean userRequestedRunning) {
    if (!userRequestedRunning && (!hasSavedTunnel || !vpnConsentGranted)) {
      return ClickAction.OPEN_APP;
    }
    return userRequestedRunning ? ClickAction.STOP_VPN : ClickAction.START_VPN;
  }

  private QuickSettingsTileState() {}
}
