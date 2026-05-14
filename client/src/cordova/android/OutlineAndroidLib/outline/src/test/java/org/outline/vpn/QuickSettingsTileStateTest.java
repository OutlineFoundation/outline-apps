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

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.outline.vpn.QuickSettingsTileState.ClickAction;

public class QuickSettingsTileStateTest {

  // ---- shouldShowOn ----

  @Test
  public void shouldShowOn_followsStoredFlag() {
    assertFalse(QuickSettingsTileState.shouldShowOn(false));
    assertTrue(QuickSettingsTileState.shouldShowOn(true));
  }

  // ---- resolveClick ----

  @Test
  public void resolveClick_offWithNoSavedTunnel_opensApp() {
    assertEquals(ClickAction.OPEN_APP,
        QuickSettingsTileState.resolveClick(/*hasSavedTunnel*/ false,
                                            /*vpnConsentGranted*/ true,
                                            /*userRequestedRunning*/ false));
  }

  @Test
  public void resolveClick_offWithoutConsent_opensApp() {
    // We must take the user into the app so the OS can present the VPN consent dialog.
    assertEquals(ClickAction.OPEN_APP,
        QuickSettingsTileState.resolveClick(true, false, false));
  }

  @Test
  public void resolveClick_offWithSavedTunnelAndConsent_starts() {
    assertEquals(ClickAction.START_VPN,
        QuickSettingsTileState.resolveClick(true, true, false));
  }

  @Test
  public void resolveClick_userRequestedOn_alwaysStops() {
    // Once the user has tapped to start, every subsequent click stops — never opens the app,
    // even if the saved tunnel was cleared or consent was revoked since.
    assertEquals(ClickAction.STOP_VPN,
        QuickSettingsTileState.resolveClick(true, true, true));
    assertEquals(ClickAction.STOP_VPN,
        QuickSettingsTileState.resolveClick(false, true, true));
    assertEquals(ClickAction.STOP_VPN,
        QuickSettingsTileState.resolveClick(true, false, true));
    assertEquals(ClickAction.STOP_VPN,
        QuickSettingsTileState.resolveClick(false, false, true));
  }

  @Test
  public void resolveClick_duringStartupWindow_doesNotDoubleStart() {
    // Regression: the user-intent flag is set true the instant the first tap starts the
    // VPN service. A second tap during the ~seconds-long startup window — before
    // ConnectivityManager surfaces the VPN network — must NOT send a second START intent,
    // because VpnTunnelService's "alreadyRunning" path will tear down and reconnect the
    // live tunnel, causing a mid-session blip. The click handler should treat this as STOP.
    assertEquals(ClickAction.STOP_VPN,
        QuickSettingsTileState.resolveClick(/*hasSavedTunnel*/ true,
                                            /*vpnConsentGranted*/ true,
                                            /*userRequestedRunning*/ true));
  }
}
