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

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.VpnService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import org.outline.R;

import java.util.logging.Logger;

/**
 * Quick Settings tile for toggling the last successfully connected Outline tunnel.
 */
public class QuickSettingsTileService extends TileService {
  private static final Logger LOG = Logger.getLogger(QuickSettingsTileService.class.getName());
  private static final String PREFERENCES_NAME = "quickSettingsTile";
  private static final String VPN_RUNNING_KEY = "vpnRunning";

  public static void requestTileUpdate(Context context) {
    TileService.requestListeningState(
        context,
        new ComponentName(context, QuickSettingsTileService.class));
  }

  public static void setVpnRunningState(Context context, boolean running) {
    context
        .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(VPN_RUNNING_KEY, running)
        .apply();
  }

  private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      updateTile();
    }
  };

  private boolean statusReceiverRegistered;

  @Override
  public void onTileAdded() {
    updateTile();
  }

  @Override
  public void onStartListening() {
    registerStatusReceiver();
    updateTile();
  }

  @Override
  public void onStopListening() {
    unregisterStatusReceiver();
  }

  @Override
  public void onClick() {
    super.onClick();

    boolean vpnRunning = isTileActive() || isOutlineVpnRunning();
    VpnTunnelStore tunnelStore = new VpnTunnelStore(this);
    if (!vpnRunning && (tunnelStore.load() == null || VpnService.prepare(this) != null)) {
      openApp();
    } else {
      setTileState(vpnRunning ? Tile.STATE_INACTIVE : Tile.STATE_ACTIVE);
      setVpnRunning(!vpnRunning);
      new Handler(Looper.getMainLooper()).postDelayed(
          () -> {
            updateTile();
            requestTileUpdate(this);
          },
          1000);
    }
  }

  private void registerStatusReceiver() {
    if (statusReceiverRegistered) {
      return;
    }
    IntentFilter filter = new IntentFilter();
    filter.addAction(VpnTunnelService.STATUS_BROADCAST_KEY);
    filter.addCategory(getPackageName());
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(statusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
    } else {
      registerReceiver(statusReceiver, filter);
    }
    statusReceiverRegistered = true;
  }

  private void unregisterStatusReceiver() {
    if (!statusReceiverRegistered) {
      return;
    }
    unregisterReceiver(statusReceiver);
    statusReceiverRegistered = false;
  }

  private void updateTile() {
    setTileState(isOutlineVpnRunning() ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
  }

  private boolean isTileActive() {
    Tile tile = getQsTile();
    return tile != null && tile.getState() == Tile.STATE_ACTIVE;
  }

  private void setTileState(int state) {
    Tile tile = getQsTile();
    if (tile == null) {
      return;
    }
    tile.setState(state);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.setSubtitle(getString(state == Tile.STATE_ACTIVE
          ? R.string.quick_settings_tile_state_on
          : R.string.quick_settings_tile_state_off));
    }
    tile.updateTile();
  }

  private boolean isOutlineVpnRunning() {
    if (getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .getBoolean(VPN_RUNNING_KEY, false)) {
      return true;
    }

    ConnectivityManager connectivityManager =
        (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
    if (connectivityManager == null) {
      return false;
    }
    // Before Android 12, VPN network owner UID is unavailable, so a foreign VPN cannot be
    // distinguished from Outline. In that case, rely only on the persisted Outline VPN state.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return false;
    }
    for (Network network : connectivityManager.getAllNetworks()) {
      NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
      if (capabilities == null || !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
        continue;
      }
      if (capabilities.getOwnerUid() == getApplicationInfo().uid) {
        return true;
      }
    }
    return false;
  }

  private void setVpnRunning(boolean running) {
    Intent intent = new Intent(this, VpnTunnelService.class);
    intent.putExtra(
        running
            ? VpnTunnelService.START_LAST_TUNNEL_EXTRA
            : VpnTunnelService.STOP_ACTIVE_TUNNEL_EXTRA,
        true);
    if (running && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      startForegroundService(intent);
    } else {
      startService(intent);
    }
  }

  private void openApp() {
    Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
    if (launchIntent == null) {
      LOG.warning("Unable to open Outline from Quick Settings tile.");
      return;
    }
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      PendingIntent pendingIntent = PendingIntent.getActivity(
          this,
          0,
          launchIntent,
          PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      startActivityAndCollapse(pendingIntent);
    } else {
      startActivityAndCollapse(launchIntent);
    }
  }
}
