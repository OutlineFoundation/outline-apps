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
 * Pure state-resolution logic for the Quick Settings tile.
 */
final class QuickSettingsTileState {
  enum ClickAction {
    OPEN_APP,
    START_VPN,
    STOP_VPN,
  }

  static boolean shouldShowOn(boolean storedRunningFlag) {
    return storedRunningFlag;
  }

  static ClickAction resolveClick(
      boolean hasSavedTunnel, boolean vpnConsentGranted, boolean userRequestedRunning) {
    if (!userRequestedRunning && (!hasSavedTunnel || !vpnConsentGranted)) {
      return ClickAction.OPEN_APP;
    }
    return userRequestedRunning ? ClickAction.STOP_VPN : ClickAction.START_VPN;
  }

  private QuickSettingsTileState() {}
}
