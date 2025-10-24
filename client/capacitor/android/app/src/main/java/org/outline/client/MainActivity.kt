package org.outline.client

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import org.outline.OutlineCapacitorPlugin

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(OutlineCapacitorPlugin::class.java)
    super.onCreate(savedInstanceState)
  }
}
