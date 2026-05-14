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
  @Test
  public void shouldShowOnFollowsStoredState() {
    assertFalse(QuickSettingsTileState.shouldShowOn(false));
    assertTrue(QuickSettingsTileState.shouldShowOn(true));
  }

  @Test
  public void resolveClickStartsWhenReadyAndOff() {
    assertEquals(ClickAction.START_VPN, QuickSettingsTileState.resolveClick(true, true, false));
  }

  @Test
  public void resolveClickOpensAppWhenOffAndNotReady() {
    assertEquals(ClickAction.OPEN_APP, QuickSettingsTileState.resolveClick(false, true, false));
    assertEquals(ClickAction.OPEN_APP, QuickSettingsTileState.resolveClick(true, false, false));
  }

  @Test
  public void resolveClickStopsWhenUserAlreadyRequestedRunning() {
    assertEquals(ClickAction.STOP_VPN, QuickSettingsTileState.resolveClick(true, true, true));
    assertEquals(ClickAction.STOP_VPN, QuickSettingsTileState.resolveClick(false, true, true));
    assertEquals(ClickAction.STOP_VPN, QuickSettingsTileState.resolveClick(true, false, true));
    assertEquals(ClickAction.STOP_VPN, QuickSettingsTileState.resolveClick(false, false, true));
  }
}
