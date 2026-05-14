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

import android.os.Build;

/**
 * Pure state-resolution logic for the Quick Settings tile, factored out of
 * {@link QuickSettingsTileService} so the precedence rules can be unit-tested without the
 * TileService lifecycle.
 *
 * <p>Two signals drive the tile:
 * <ul>
 *   <li>The persisted "did the user turn Outline on" flag (a SharedPreferences boolean managed
 *       by the tile and the VPN service).
 *   <li>Whether the system reports an active VPN network whose owner UID matches this app
 *       (Android 12+; older OSes can't distinguish a foreign VPN from Outline's).
 * </ul>
 */
final class QuickSettingsTileState {
  /** What the click handler should do given the current state. */
  enum ClickAction { OPEN_APP, START_VPN, STOP_VPN }

  /**
   * Whether the tile should render as ACTIVE.
   *
   * <p>The user must have asked Outline to turn on AND, on Android 12+, the system must
   * actually report an Outline-owned VPN network. This keeps the tile in sync when the system
   * tears Outline's tunnel down without our cooperation, or when a foreign VPN owns the only
   * active VPN network.
   */
  static boolean shouldShowOn(int sdkInt,
                              boolean storedRunningFlag,
                              boolean outlineVpnNetworkPresent) {
    if (!storedRunningFlag) {
      return false;
    }
    if (sdkInt < Build.VERSION_CODES.S) {
      return true;
    }
    return outlineVpnNetworkPresent;
  }

  /**
   * Whether Outline's VPN is actually running right now, used to decide what the click handler
   * does. Differs from {@link #shouldShowOn} in that on Android 12+ it ignores the stored flag
   * — the click handler reacts to ground truth, even if our stored state has drifted.
   */
  static boolean isOutlineVpnRunning(int sdkInt,
                                     boolean storedRunningFlag,
                                     boolean outlineVpnNetworkPresent) {
    if (sdkInt < Build.VERSION_CODES.S) {
      return storedRunningFlag;
    }
    return outlineVpnNetworkPresent;
  }

  /**
   * Decide what the tile should do on click.
   *
   * @param hasSavedTunnel       true if the tunnel store has a previously-configured server.
   * @param vpnConsentGranted    true if {@code VpnService.prepare} returned null
   *                             (no system consent dialog needed).
   * @param outlineVpnRunning    the result of {@link #isOutlineVpnRunning}.
   */
  static ClickAction resolveClick(boolean hasSavedTunnel,
                                  boolean vpnConsentGranted,
                                  boolean outlineVpnRunning) {
    if (!outlineVpnRunning && (!hasSavedTunnel || !vpnConsentGranted)) {
      return ClickAction.OPEN_APP;
    }
    return outlineVpnRunning ? ClickAction.STOP_VPN : ClickAction.START_VPN;
  }

  private QuickSettingsTileState() {}
}
