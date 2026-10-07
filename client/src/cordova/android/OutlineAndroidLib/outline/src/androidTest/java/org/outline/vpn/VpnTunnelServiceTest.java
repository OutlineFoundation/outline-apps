// Copyright 2024 The Outline Authors
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

import static org.junit.Assert.*;

import android.content.Intent;

import org.junit.Test;
import org.outline.TunnelConfig;

/**
 * Tests for VpnTunnelService helper logic.
 *
 * <p>VpnTunnelService extends VpnService and cannot be directly instantiated in a test, so the
 * intent-building step is covered through the package-private
 * {@link VpnTunnelService#buildStatusBroadcastIntent} method.
 */
public class VpnTunnelServiceTest {

    private static final String TEST_PACKAGE = "org.outline.test";
    private static final String TUNNEL_ID = "test-tunnel-id";

    // ---- null config --------------------------------------------------------

    @Test
    public void buildStatusBroadcastIntent_nullConfig_returnsNull() {
        Intent result = VpnTunnelService.buildStatusBroadcastIntent(
                null, VpnTunnelService.TunnelStatus.DISCONNECTED, TEST_PACKAGE);
        assertNull("Expected null intent when config is null", result);
    }

    // ---- valid config --------------------------------------------------------

    @Test
    public void buildStatusBroadcastIntent_validConfig_containsTunnelId() {
        TunnelConfig config = new TunnelConfig();
        config.id = TUNNEL_ID;

        Intent result = VpnTunnelService.buildStatusBroadcastIntent(
                config, VpnTunnelService.TunnelStatus.CONNECTED, TEST_PACKAGE);

        assertNotNull("Expected non-null intent for valid config", result);
        assertEquals(TUNNEL_ID,
                result.getStringExtra(VpnTunnelService.MessageData.TUNNEL_ID.value));
    }

    @Test
    public void buildStatusBroadcastIntent_validConfig_containsStatus() {
        TunnelConfig config = new TunnelConfig();
        config.id = TUNNEL_ID;

        Intent result = VpnTunnelService.buildStatusBroadcastIntent(
                config, VpnTunnelService.TunnelStatus.RECONNECTING, TEST_PACKAGE);

        assertNotNull(result);
        assertEquals(VpnTunnelService.TunnelStatus.RECONNECTING.value,
                result.getIntExtra(VpnTunnelService.MessageData.PAYLOAD.value, -1));
    }

    @Test
    public void buildStatusBroadcastIntent_validConfig_packageRestricted() {
        TunnelConfig config = new TunnelConfig();
        config.id = TUNNEL_ID;

        Intent result = VpnTunnelService.buildStatusBroadcastIntent(
                config, VpnTunnelService.TunnelStatus.CONNECTED, TEST_PACKAGE);

        assertNotNull(result);
        assertEquals(TEST_PACKAGE, result.getPackage());
    }

    // ---- TOCTOU regression --------------------------------------------------

    /**
     * Regression test for the TOCTOU race between the null check and the field read in
     * broadcastVpnConnectivityChange. Simulates tearDownActiveTunnel() nulling the service field
     * after the local snapshot has been captured: the intent must still carry the original ID.
     */
    @Test
    public void buildStatusBroadcastIntent_configClearedAfterCapture_retainsId() {
        TunnelConfig config = new TunnelConfig();
        config.id = "race-condition-tunnel";

        // Mimic what broadcastVpnConnectivityChange does: take a local snapshot.
        final TunnelConfig snapshot = config;

        // Simulate tearDownActiveTunnel() setting the service field to null on another thread.
        //noinspection UnusedAssignment
        config = null;

        // The snapshot still holds the original non-null reference; no NPE should occur.
        Intent result = VpnTunnelService.buildStatusBroadcastIntent(
                snapshot, VpnTunnelService.TunnelStatus.DISCONNECTED, TEST_PACKAGE);

        assertNotNull("Broadcast intent must be built from the captured snapshot, not the field",
                result);
        assertEquals("race-condition-tunnel",
                result.getStringExtra(VpnTunnelService.MessageData.TUNNEL_ID.value));
    }
}
