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
          Log.d(TAG, "VPN service connected - ComponentName: $name")
          vpnTunnelService = IVpnTunnelService.Stub.asInterface(service)
          logger.info("VPN service connected")
          Log.d(TAG, "VPN service connection established successfully")
          
          // Execute any pending start tunnel request
          pendingStartTunnelRequest?.let { request ->
            Log.d(TAG, "VPN service connected - Executing pending start tunnel request for tunnel: ${request.tunnelId}")
            val call = bridge.getSavedCall(request.callId)
            if (call != null) {
              // executeStartTunnel will handle releasing the call when it completes
              executeStartTunnel(call, request.tunnelId, request.transportConfig, request.serverName)
            } else {
              Log.w(TAG, "VPN service connected - No saved call found for pending start tunnel request")
            }
            pendingStartTunnelRequest = null
          }
        }

        override fun onServiceDisconnected(name: ComponentName) {
          Log.w(TAG, "VPN service disconnected - ComponentName: $name")
          logger.warning("VPN service disconnected")
          val context = baseContext()
          val rebind = Intent(context, VpnTunnelService::class.java).apply {
            putExtra(VpnServiceStarter.AUTOSTART_EXTRA, true)
            putExtra(
                VpnTunnelService.MessageData.ERROR_REPORTING_API_KEY.value,
                errorReportingApiKey,
            )
          }
          Log.d(TAG, "Attempting to rebind VPN service")
          context.bindService(rebind, this, Context.BIND_AUTO_CREATE)
        }
      }

  private val vpnTunnelBroadcastReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      Log.d(TAG, "VPN tunnel broadcast received - Action: ${intent.action}")
      val tunnelId =
          intent.getStringExtra(VpnTunnelService.MessageData.TUNNEL_ID.value) ?: run {
            Log.w(TAG, "Tunnel status broadcast missing tunnel ID")
            logger.warning("Tunnel status broadcast missing tunnel ID")
            return
          }
      if (statusCallbackIds.isEmpty()) {
        Log.d(TAG, "No Capacitor status listeners registered; dropping update for tunnel $tunnelId")
        logger.fine(
            "No Capacitor status listeners registered; dropping update for tunnel $tunnelId")
        return
      }
      val status =
          intent.getIntExtra(
              VpnTunnelService.MessageData.PAYLOAD.value,
              VpnTunnelService.TunnelStatus.INVALID.value,
          )
      Log.d(TAG, "VPN connectivity changed - tunnelId: $tunnelId, status: $status")
      logger.fine(
          String.format(Locale.ROOT, "VPN connectivity changed: %s, %d", tunnelId, status))

      val payload = JSObject().apply {
        put("id", tunnelId)
        put("status", status)
      }
      Log.d(TAG, "Notifying listeners of VPN status change - listeners: ${statusCallbackIds.size}")
      notifyListeners(VPN_STATUS_EVENT, payload)

      // Also resolve long-lived callbacks to mirror the Cordova plugin behaviour so the
      // TypeScript side can keep using the same contract until we migrate it fully.
      statusCallbackIds.forEach { callbackId ->
        bridge.getSavedCall(callbackId)?.let { savedCall ->
          Log.d(TAG, "Resolving saved call for callbackId: $callbackId")
          savedCall.resolve(payload)
        }
      }
    }
  }

  override fun load() {
    Log.d(TAG, "load() called - Plugin is being loaded")
    super.load()
    Log.d(TAG, "load() - super.load() completed")

    val context = baseContext()
    Log.d(TAG, "load() - Context obtained: ${context.packageName}")

    try {
      OutlineLogger.registerLogHandler(SentryErrorReporter.BREADCRUMB_LOG_HANDLER)
      Log.d(TAG, "load() - OutlineLogger registered")
      
      val goConfig: GoBackendConfig = Outline.getBackendConfig()
      goConfig.dataDir = context.filesDir.absolutePath
      Log.d(TAG, "load() - Go backend config initialized, dataDir: ${goConfig.dataDir}")

      val broadcastFilter = IntentFilter().apply {
        addAction(VpnTunnelService.STATUS_BROADCAST_KEY)
        addCategory(context.packageName)
      }
      context.registerReceiver(
          vpnTunnelBroadcastReceiver,
          broadcastFilter,
          Context.RECEIVER_NOT_EXPORTED,
      )
      Log.d(TAG, "load() - VPN tunnel broadcast receiver registered")

      context.bindService(
          Intent(context, VpnTunnelService::class.java),
          vpnServiceConnection,
          Context.BIND_AUTO_CREATE,
      )
      Log.d(TAG, "load() - VPN tunnel service binding initiated")
      Log.d(TAG, "load() - Plugin load completed successfully")
    } catch (e: Exception) {
      Log.e(TAG, "load() - Error during plugin initialization", e)
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
    Log.d(TAG, "invokeMethod() called - method: $methodName, input: $input")
    
    if (methodName.isNullOrEmpty()) {
      Log.e(TAG, "invokeMethod() - Missing Outline method name")
      call.reject("Missing Outline method name.")
      return
    }
    executor.execute {
      try {
        Log.d(TAG, "invokeMethod() - Executing: Outline.invokeMethod($methodName, $input)")
        logger.fine(
            String.format(Locale.ROOT, "Calling Outline.invokeMethod(%s, %s)", methodName, input))
        val result: InvokeMethodResult = Outline.invokeMethod(methodName, input)
        val error = result.error
        if (error != null) {
          Log.w(TAG, "invokeMethod() - InvokeMethod($methodName) failed: $error")
          logger.warning(
              String.format(Locale.ROOT, "InvokeMethod(%s) failed: %s", methodName, error))
          rejectWithPlatformError(call, error)
          return@execute
        }
        Log.d(TAG, "invokeMethod() - InvokeMethod($methodName) succeeded, value: ${result.value}")
        val payload = JSObject().apply { put("value", result.value) }
        call.resolve(payload)
      } catch (e: Exception) {
        Log.e(TAG, "invokeMethod() - Exception in invokeMethod($methodName)", e)
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
    Log.d(TAG, "start() called - tunnelId: $tunnelId, serverName: $serverName")

    if (tunnelId.isNullOrEmpty() || transportConfig.isNullOrEmpty() || serverName.isNullOrEmpty()) {
      Log.e(TAG, "start() - Missing tunnel start parameters")
      call.reject("Missing tunnel start parameters.")
      return
    }

    if (!prepareVpnService(call, tunnelId, serverName, transportConfig)) {
      Log.d(TAG, "start() - VPN service preparation returned false, waiting for permission")
      return
    }

    Log.d(TAG, "start() - Executing start tunnel")
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
    Log.d(TAG, "onStatusChange() called - callbackId: ${call.callbackId}")
    call.setKeepAlive(true)
    statusCallbackIds.add(call.callbackId)
    saveCall(call)
    Log.d(TAG, "onStatusChange() - Status listener registered, total listeners: ${statusCallbackIds.size}")
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

    Log.d(TAG, "handleOnActivityResult() called - requestCode: $requestCode, resultCode: $resultCode")
    if (requestCode != REQUEST_CODE_PREPARE_VPN) {
      Log.w(TAG, "handleOnActivityResult() - Unknown requestCode: $requestCode")
      logger.warning("Received unknown activity result requestCode=$requestCode")
      return
    }

    val startRequest = pendingStartRequest ?: run {
      Log.w(TAG, "handleOnActivityResult() - No pending VPN start request")
      logger.warning("No pending VPN start request to resume.")
      return
    }

    Log.d(TAG, "handleOnActivityResult() - Found pending request for tunnel: ${startRequest.tunnelId}")
    val call =
        bridge.getSavedCall(startRequest.callId) ?: run {
          Log.w(TAG, "handleOnActivityResult() - Failed to retrieve saved call")
          logger.warning("Failed to retrieve saved call for VPN start.")
          pendingStartRequest = null
          return
        }

    if (resultCode != Activity.RESULT_OK) {
      Log.w(TAG, "handleOnActivityResult() - VPN permission denied by user")
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

    Log.d(TAG, "handleOnActivityResult() - VPN permission granted, starting tunnel")
    executeStartTunnel(
        call,
        startRequest.tunnelId,
        startRequest.transportConfig,
        startRequest.serverName,
    )
    bridge.releaseCall(call)
    pendingStartRequest = null
    Log.d(TAG, "handleOnActivityResult() - Completed")
  }

  private fun executeStartTunnel(
      call: PluginCall,
      tunnelId: String,
      transportConfig: String,
      serverName: String,
  ) {
    Log.d(TAG, "executeStartTunnel() called - tunnelId: $tunnelId, serverName: $serverName")
    Log.d(TAG, "executeStartTunnel() - VPN tunnel service: ${if (vpnTunnelService != null) "connected" else "null"}")
    
    // Wait for VPN service to be connected
    if (vpnTunnelService == null) {
      Log.d(TAG, "executeStartTunnel() - VPN service not connected yet, queuing start request")
      val request = StartVpnRequest(
          tunnelId = tunnelId,
          serverName = serverName,
          transportConfig = transportConfig,
          callId = call.callbackId,
      )
      pendingStartTunnelRequest = request
      call.setKeepAlive(true)
      saveCall(call)
      Log.d(TAG, "executeStartTunnel() - Start request queued, waiting for VPN service connection")
      return
    }
    
    executor.execute {
      try {
        Log.d(TAG, "executeStartTunnel() - Executing on background thread")
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
        Log.d(TAG, "executeStartTunnel() - Calling vpnTunnelService.startTunnel()")
        val result = vpnTunnelService?.startTunnel(config)
        Log.d(TAG, "executeStartTunnel() - startTunnel() returned: ${if (result == null) "success" else "error: $result"}")
        resolveOrReject(call, result)
        Log.d(TAG, "executeStartTunnel() - Call resolved/rejected")
      } catch (e: RemoteException) {
        Log.e(TAG, "executeStartTunnel() - startTunnel failed with RemoteException", e)
        logger.log(Level.SEVERE, "startTunnel failed", e)
        rejectWithPlatformError(
            call,
            PlatformError(Platerrors.InternalError, e.toString()),
        )
      } catch (e: Exception) {
        Log.e(TAG, "executeStartTunnel() - startTunnel failed with exception", e)
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
    Log.d(TAG, "prepareVpnService() called - tunnelId: $tunnelId")
    val context = baseContext()
    val prepareIntent = VpnService.prepare(context)
    if (prepareIntent == null) {
      Log.d(TAG, "prepareVpnService() - VPN permission already granted")
      return true
    }

    Log.d(TAG, "prepareVpnService() - VPN permission needed, requesting...")
    val activity = activity
    if (activity == null) {
      Log.e(TAG, "prepareVpnService() - No activity available")
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
    Log.d(TAG, "prepareVpnService() - Starting VPN permission activity")
    activity.startActivityForResult(prepareIntent, REQUEST_CODE_PREPARE_VPN)
    Log.d(TAG, "prepareVpnService() - VPN permission activity started, waiting for result")
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

