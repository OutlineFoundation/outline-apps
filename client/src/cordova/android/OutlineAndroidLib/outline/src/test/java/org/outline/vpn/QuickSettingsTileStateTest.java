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

import android.os.Build;

import org.junit.Test;
import org.outline.vpn.QuickSettingsTileState.ClickAction;

public class QuickSettingsTileStateTest {

  private static final int SDK_PRE_S = Build.VERSION_CODES.R;   // Android 11
  private static final int SDK_S = Build.VERSION_CODES.S;       // Android 12
  private static final int SDK_POST_S = Build.VERSION_CODES.UPSIDE_DOWN_CAKE; // Android 14

  // ---- shouldShowOn ----

  @Test
  public void shouldShowOn_storedFalse_alwaysOff() {
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_PRE_S, false, false));
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_PRE_S, false, true));
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_S, false, false));
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_S, false, true));
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_POST_S, false, false));
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_POST_S, false, true));
  }

  @Test
  public void shouldShowOn_preS_trustsStoredFlag() {
    // Pre-Android 12 cannot distinguish foreign VPN from Outline, so the stored flag wins.
    assertTrue(QuickSettingsTileState.shouldShowOn(SDK_PRE_S, true, false));
    assertTrue(QuickSettingsTileState.shouldShowOn(SDK_PRE_S, true, true));
  }

  @Test
  public void shouldShowOn_sPlus_requiresOutlineNetwork() {
    // System torn the tunnel down or a foreign VPN owns the active network: tile must be OFF.
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_S, true, false));
    assertFalse(QuickSettingsTileState.shouldShowOn(SDK_POST_S, true, false));

    // Outline-owned VPN network confirmed: tile ON.
    assertTrue(QuickSettingsTileState.shouldShowOn(SDK_S, true, true));
    assertTrue(QuickSettingsTileState.shouldShowOn(SDK_POST_S, true, true));
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
