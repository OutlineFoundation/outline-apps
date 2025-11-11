package org.outline.client;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import org.outline.CapacitorPluginOutline;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "OutlineMainActivity";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    Log.d(TAG, "onCreate: Starting MainActivity");
    Log.d(TAG, "onCreate: Registering CapacitorPluginOutline");
    try {
      registerPlugin(CapacitorPluginOutline.class);
      Log.d(TAG, "onCreate: CapacitorPluginOutline registered successfully");
    } catch (Exception e) {
      Log.e(TAG, "onCreate: Failed to register CapacitorPluginOutline", e);
    }
    super.onCreate(savedInstanceState);
    Log.d(TAG, "onCreate: MainActivity initialization complete");
  }
}
