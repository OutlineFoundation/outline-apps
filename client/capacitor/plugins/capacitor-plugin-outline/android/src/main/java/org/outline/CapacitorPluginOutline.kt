// Copyright 2018 The Outline Authors
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

package org.outline

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.net.VpnService
import android.os.IBinder
import android.os.RemoteException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.util.Log
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.logging.Level
import java.util.logging.Logger
import org.outline.log.OutlineLogger
import org.outline.log.SentryErrorReporter
import org.outline.vpn.Errors
import org.outline.vpn.VpnServiceStarter
import org.outline.vpn.VpnTunnelService
import outline.GoBackendConfig
import outline.InvokeMethodResult
import outline.Outline
import platerrors.Platerrors
import platerrors.PlatformError

@CapacitorPlugin(name = "CapacitorPluginOutline")
class CapacitorPluginOutline : Plugin() {

  private data class StartVpnRequest(
      val tunnelId: String,
      val serverName: String,
      val transportConfig: String,
      val callId: String,
  )

  private val logger = Logger.getLogger(CapacitorPluginOutline::class.java.name)

  private var vpnTunnelService: IVpnTunnelService? = null
  private var errorReportingApiKey: String? = null
  private var pendingStartRequest: StartVpnRequest? = null
  private var pendingStartTunnelRequest: StartVpnRequest? = null
  private val statusCallbackIds = CopyOnWriteArraySet<String>()
  private val executor = Executors.newCachedThreadPool()

  private val vpnServiceConnection =
      object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, service: IBinder) {
          vpnTunnelService = IVpnTunnelService.Stub.asInterface(service)
          logger.info("VPN service connected")
          
          // Execute any pending start tunnel request
          pendingStartTunnelRequest?.let { request ->
            val call = bridge.getSavedCall(request.callId)
            if (call != null) {
              // executeStartTunnel will handle releasing the call when it completes
              executeStartTunnel(call, request.tunnelId, request.transportConfig, request.serverName)
            }
            pendingStartTunnelRequest = null
          }
        }

        override fun onServiceDisconnected(name: ComponentName) {
          logger.warning("VPN service disconnected")
          val context = baseContext()
          val rebind = Intent(context, VpnTunnelService::class.java).apply {
            putExtra(VpnServiceStarter.AUTOSTART_EXTRA, true)
            putExtra(
                VpnTunnelService.MessageData.ERROR_REPORTING_API_KEY.value,
                errorReportingApiKey,
            )
          }
          context.bindService(rebind, this, Context.BIND_AUTO_CREATE)
        }
      }

  private val vpnTunnelBroadcastReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val tunnelId =
          intent.getStringExtra(VpnTunnelService.MessageData.TUNNEL_ID.value) ?: run {
            logger.warning("Tunnel status broadcast missing tunnel ID")
            return
          }
      if (statusCallbackIds.isEmpty()) {
        logger.fine(
            "No Capacitor status listeners registered; dropping update for tunnel $tunnelId")
        return
      }
      val status =
          intent.getIntExtra(
              VpnTunnelService.MessageData.PAYLOAD.value,
              VpnTunnelService.TunnelStatus.INVALID.value,
          )
      logger.fine(
          String.format(Locale.ROOT, "VPN connectivity changed: %s, %d", tunnelId, status))

      val payload = JSObject().apply {
        put("id", tunnelId)
        put("status", status)
      }
      notifyListeners(VPN_STATUS_EVENT, payload)

      // Also resolve long-lived callbacks to mirror the Cordova plugin behaviour so the
      // TypeScript side can keep using the same contract until we migrate it fully.
      statusCallbackIds.forEach { callbackId ->
        bridge.getSavedCall(callbackId)?.let { savedCall ->
          savedCall.resolve(payload)
        }
      }
    }
  }

  override fun load() {
    super.load()

    val context = baseContext()

    try {
      OutlineLogger.registerLogHandler(SentryErrorReporter.BREADCRUMB_LOG_HANDLER)
      
      val goConfig: GoBackendConfig = Outline.getBackendConfig()
      goConfig.dataDir = context.filesDir.absolutePath

      val broadcastFilter = IntentFilter().apply {
        addAction(VpnTunnelService.STATUS_BROADCAST_KEY)
        addCategory(context.packageName)
      }
      context.registerReceiver(
          vpnTunnelBroadcastReceiver,
          broadcastFilter,
          Context.RECEIVER_NOT_EXPORTED,
      )

      context.bindService(
          Intent(context, VpnTunnelService::class.java),
          vpnServiceConnection,
          Context.BIND_AUTO_CREATE,
      )
    } catch (e: Exception) {
      throw e
    }
  }

  override fun handleOnDestroy() {
    val context = baseContext()
    try {
      context.unregisterReceiver(vpnTunnelBroadcastReceiver)
    } catch (ignored: IllegalArgumentException) {
      // Receiver might not have been registered if load() never ran; ignore.
    }
    kotlin.runCatching { context.unbindService(vpnServiceConnection) }
    executor.shutdown()
    super.handleOnDestroy()
  }

  @PluginMethod
  fun invokeMethod(call: PluginCall) {
    val methodName = call.getString("method")
    val input = call.getString("input", "")
    if (methodName.isNullOrEmpty()) {
      call.reject("Missing Outline method name.")
      return
    }
    executor.execute {
      try {
        logger.fine(
            String.format(Locale.ROOT, "Calling Outline.invokeMethod(%s, %s)", methodName, input))
        val result: InvokeMethodResult = Outline.invokeMethod(methodName, input)
        val error = result.error
        if (error != null) {
          logger.warning(
              String.format(Locale.ROOT, "InvokeMethod(%s) failed: %s", methodName, error))
          rejectWithPlatformError(call, error)
          return@execute
        }
        val payload = JSObject().apply { put("value", result.value) }
        call.resolve(payload)
      } catch (e: Exception) {
        logger.log(
            Level.SEVERE,
            String.format(Locale.ROOT, "invokeMethod(%s) threw exception", methodName),
            e)
        rejectWithPlatformError(
            call,
            PlatformError(Platerrors.InternalError, e.toString()),
        )
      }
    }
  }

  @PluginMethod
  fun start(call: PluginCall) {
    val tunnelId = call.getString("tunnelId")
    val serverName = call.getString("serverName")
    val transportConfig = call.getString("transportConfig")
    if (tunnelId.isNullOrEmpty() || transportConfig.isNullOrEmpty() || serverName.isNullOrEmpty()) {
      call.reject("Missing tunnel start parameters.")
      return
    }

    if (!prepareVpnService(call, tunnelId, serverName, transportConfig)) {
      return
    }

    executeStartTunnel(call, tunnelId, transportConfig, serverName)
  }

  @PluginMethod
  fun stop(call: PluginCall) {
    val tunnelId = call.getString("tunnelId")
    if (tunnelId.isNullOrEmpty()) {
      call.reject("Missing tunnelId.")
      return
    }
    executor.execute {
      try {
        logger.info(String.format(Locale.ROOT, "Stopping VPN tunnel %s", tunnelId))
        val result = vpnTunnelService?.stopTunnel(tunnelId)
        resolveOrReject(call, result)
      } catch (e: RemoteException) {
        logger.log(Level.SEVERE, "stopTunnel failed", e)
        rejectWithPlatformError(
            call,
            PlatformError(Platerrors.InternalError, e.toString()),
        )
      }
    }
  }

  @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
  fun onStatusChange(call: PluginCall) {
    call.setKeepAlive(true)
    statusCallbackIds.add(call.callbackId)
    saveCall(call)
    call.resolve()
  }

  @PluginMethod
  fun isRunning(call: PluginCall) {
    val tunnelId = call.getString("tunnelId")
    if (tunnelId.isNullOrEmpty()) {
      call.reject("Missing tunnelId.")
      return
    }
    executor.execute {
      val isActive =
          try {
            vpnTunnelService?.isTunnelActive(tunnelId) ?: false
          } catch (e: Exception) {
            logger.log(Level.SEVERE, "Failed to determine if tunnel is active: $tunnelId", e)
            false
          }
      val payload = JSObject().apply { put("isRunning", isActive) }
      call.resolve(payload)
    }
  }

  @PluginMethod
  fun initializeErrorReporting(call: PluginCall) {
    val apiKey = call.getString("apiKey")
    if (apiKey.isNullOrEmpty()) {
      call.reject("Missing error reporting API key.")
      return
    }
    executor.execute {
      try {
        errorReportingApiKey = apiKey
        SentryErrorReporter.init(baseContext(), apiKey)
        vpnTunnelService?.initErrorReporting(apiKey)
        call.resolve()
      } catch (e: Exception) {
        logger.log(Level.SEVERE, "Failed to initialize error reporting.", e)
        rejectWithPlatformError(
            call,
            PlatformError(Platerrors.InternalError, e.toString()),
        )
      }
    }
  }

  @PluginMethod
  fun reportEvents(call: PluginCall) {
    val uuid = call.getString("uuid")
    if (uuid.isNullOrEmpty()) {
      call.reject("Missing report UUID.")
      return
    }
    executor.execute {
      SentryErrorReporter.send(uuid)
      call.resolve()
    }
  }

  @PluginMethod
  fun quitApplication(call: PluginCall) {
    activity?.finish()
    call.resolve()
  }

  override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.handleOnActivityResult(requestCode, resultCode, data)

    if (requestCode != REQUEST_CODE_PREPARE_VPN) {
      logger.warning("Received unknown activity result requestCode=$requestCode")
      return
    }

    val startRequest = pendingStartRequest ?: run {
      logger.warning("No pending VPN start request to resume.")
      return
    }

    val call =
        bridge.getSavedCall(startRequest.callId) ?: run {
          logger.warning("Failed to retrieve saved call for VPN start.")
          pendingStartRequest = null
          return
        }

    if (resultCode != Activity.RESULT_OK) {
      logger.warning("Failed to prepare VPN; permission denied by user.")
      rejectWithPlatformError(
          call,
          PlatformError(
              Platerrors.VPNPermissionNotGranted,
              "failed to grant the VPN permission",
          ),
      )
      bridge.releaseCall(call)
      pendingStartRequest = null
      return
    }

    executeStartTunnel(
        call,
        startRequest.tunnelId,
        startRequest.transportConfig,
        startRequest.serverName,
    )
    bridge.releaseCall(call)
    pendingStartRequest = null
  }

  private fun executeStartTunnel(
      call: PluginCall,
      tunnelId: String,
      transportConfig: String,
      serverName: String,
  ) {
    // Wait for VPN service to be connected
    if (vpnTunnelService == null) {
      val request = StartVpnRequest(
          tunnelId = tunnelId,
          serverName = serverName,
          transportConfig = transportConfig,
          callId = call.callbackId,
      )
      pendingStartTunnelRequest = request
      call.setKeepAlive(true)
      saveCall(call)
      return
    }
    
    executor.execute {
      try {
        logger.info(
            String.format(
                Locale.ROOT,
                "Starting VPN tunnel %s for server %s",
                tunnelId,
                serverName,
            ))
        val config = TunnelConfig().apply {
          id = tunnelId
          name = serverName
          this.transportConfig = transportConfig
        }
        val result = vpnTunnelService?.startTunnel(config)
        resolveOrReject(call, result)
      } catch (e: RemoteException) {
        logger.log(Level.SEVERE, "startTunnel failed", e)
        rejectWithPlatformError(
            call,
            PlatformError(Platerrors.InternalError, e.toString()),
        )
      } catch (e: Exception) {
        logger.log(Level.SEVERE, "startTunnel failed", e)
        rejectWithPlatformError(
            call,
            PlatformError(Platerrors.InternalError, e.toString()),
        )
      }
    }
  }

  private fun prepareVpnService(
      call: PluginCall,
      tunnelId: String,
      serverName: String,
      transportConfig: String,
  ): Boolean {
    val context = baseContext()
    val prepareIntent = VpnService.prepare(context)
    if (prepareIntent == null) {
      return true
    }

    val activity = activity
    if (activity == null) {
      call.reject("Unable to request VPN permission without an active activity.")
      return false
    }

    val request =
        StartVpnRequest(
            tunnelId = tunnelId,
            serverName = serverName,
            transportConfig = transportConfig,
            callId = call.callbackId,
        )
    pendingStartRequest = request
    call.setKeepAlive(true)
    saveCall(call)
    activity.startActivityForResult(prepareIntent, REQUEST_CODE_PREPARE_VPN)
    return false
  }

  private fun resolveOrReject(call: PluginCall, error: DetailedJsonError?) {
    if (error == null) {
      call.resolve()
    } else {
      call.reject(error.errorJson)
    }
  }

  private fun rejectWithPlatformError(call: PluginCall, error: PlatformError) {
    resolveOrReject(call, Errors.toDetailedJsonError(error))
  }

  private fun baseContext(): Context = context.applicationContext

  companion object {
    private const val TAG = "CapacitorPluginOutline"
    private const val REQUEST_CODE_PREPARE_VPN = 100
    private const val VPN_STATUS_EVENT = "vpnStatus"
  }
}

