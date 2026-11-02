/*
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.outline.client;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    if (isAndroidTv()) {
      setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
    }
    super.onCreate(savedInstanceState);
  }

  private boolean isAndroidTv() {
    UiModeManager uiModeManager =
        (UiModeManager) getSystemService(Activity.UI_MODE_SERVICE);
    return (uiModeManager != null
            && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION)
        || getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
  }
}
