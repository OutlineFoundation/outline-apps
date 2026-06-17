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
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors
import org.outline.log.OutlineLogger
import org.outline.log.SentryErrorReporter
import org.outline.vpn.Errors
import org.outline.vpn.VpnServiceStarter
import org.outline.vpn.VpnTunnelService
import outline.Outline
import platerrors.Platerrors
import platerrors.PlatformError

@CapacitorPlugin(name = "CapacitorPluginOutline")
class CapacitorPluginOutline : Plugin() {

  private data class StartVpnRequest(
      val args: StartArgs,
      val call: PluginCall,
  )

  private data class StartArgs(
      val tunnelId: String,
      val serverName: String,
      val transportConfig: String,
  )

  // All fields below are read from both the main thread (ServiceConnection /
  // activity-result callbacks) and the executor pool (@PluginMethod handlers),
  // so every access must go through `stateLock` to guarantee both visibility
  // and atomicity of check-then-act sequences.
  private val stateLock = Any()
  private var vpnTunnelService: IVpnTunnelService? = null
  private var errorReportingApiKey: String? = null
  private var pendingVpnPermissionRequest: StartVpnRequest? = null
  private var pendingServiceBindRequest: StartVpnRequest? = null
  private val executor = Executors.newCachedThreadPool()

  private val vpnServiceConnection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, service: IBinder) {
      val pending: StartVpnRequest?
      synchronized(stateLock) {
        vpnTunnelService = IVpnTunnelService.Stub.asInterface(service)
        pending = pendingServiceBindRequest
        pendingServiceBindRequest = null
      }
      if (pending != null) {
        executeStartTunnel(pending.call, pending.args)
      }
    }

    override fun onServiceDisconnected(name: ComponentName) {
      val apiKey = synchronized(stateLock) {
        vpnTunnelService = null
        errorReportingApiKey
      }
      val context = baseContext()
      val rebind = Intent(context, VpnTunnelService::class.java).apply {
        putExtra(VpnServiceStarter.AUTOSTART_EXTRA, true)
        putExtra(
            VpnTunnelService.MessageData.ERROR_REPORTING_API_KEY.value,
            apiKey,
        )
      }
      context.bindService(rebind, this, Context.BIND_AUTO_CREATE)
    }
  }

  private val vpnTunnelBroadcastReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val tunnelId = intent.getStringExtra(VpnTunnelService.MessageData.TUNNEL_ID.value) ?: return
      val status = intent.getIntExtra(
          VpnTunnelService.MessageData.PAYLOAD.value,
          VpnTunnelService.TunnelStatus.INVALID.value,
      )
      val payload = JSObject().apply {
        put("id", tunnelId)
        put("status", status)
      }
      notifyListeners(STATUS_CHANGE_EVENT, payload)
    }
  }

  override fun load() {
    super.load()
    val context = baseContext()

    OutlineLogger.registerLogHandler(SentryErrorReporter.BREADCRUMB_LOG_HANDLER)

    val goConfig = Outline.getBackendConfig()
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
  }

  override fun handleOnDestroy() {
    val context = baseContext()
    try {
      context.unregisterReceiver(vpnTunnelBroadcastReceiver)
    } catch (ignored: IllegalArgumentException) { }
    kotlin.runCatching { context.unbindService(vpnServiceConnection) }
    executor.shutdown()
    super.handleOnDestroy()
  }

  @PluginMethod
  fun invokeMethod(call: PluginCall) {
    executor.execute {
      try {
        val methodName = call.getString("method")
        if (methodName.isNullOrEmpty()) {
          call.reject("Missing Outline method name.")
          return@execute
        }
        val input = call.getString("input", "") ?: ""
        val result = Outline.invokeMethod(methodName, input)
        result.error?.let { error ->
          sendErrorResult(call, error)
          return@execute
        }
        call.resolve(JSObject().apply { put("value", result.value) })
      } catch (e: Exception) {
        sendErrorResult(call, platformErrorFromException(e))
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

    val startArgs = StartArgs(tunnelId, serverName, transportConfig)

    if (!prepareVpnService(call, startArgs)) {
      return
    }

    executeStartTunnel(call, startArgs)
  }

  @PluginMethod
  fun stop(call: PluginCall) {
    executor.execute {
      try {
        val tunnelId = call.getString("tunnelId")
        if (tunnelId.isNullOrEmpty()) {
          call.reject("Missing tunnelId.")
          return@execute
        }
        val service = synchronized(stateLock) { vpnTunnelService }
        if (service == null) {
          sendErrorResult(call, vpnServiceUnavailableError())
          return@execute
        }
        val result = service.stopTunnel(tunnelId)
        if (result == null) call.resolve() else call.reject(result.errorJson)
      } catch (e: Exception) {
        sendErrorResult(call, platformErrorFromException(e))
      }
    }
  }

  @PluginMethod
  fun isRunning(call: PluginCall) {
    executor.execute {
      try {
        val tunnelId = call.getString("tunnelId")
        if (tunnelId.isNullOrEmpty()) {
          call.reject("Missing tunnelId.")
          return@execute
        }
        val service = synchronized(stateLock) { vpnTunnelService }
        val isActive = try {
          service?.isTunnelActive(tunnelId) ?: false
        } catch (e: Exception) {
          false
        }
        call.resolve(JSObject().apply { put("isRunning", isActive) })
      } catch (e: Exception) {
        sendErrorResult(call, platformErrorFromException(e))
      }
    }
  }

  @PluginMethod
  fun initializeErrorReporting(call: PluginCall) {
    executor.execute {
      try {
        val apiKey = call.getString("apiKey")
        if (apiKey.isNullOrEmpty()) {
          call.reject("Missing error reporting API key.")
          return@execute
        }
        val service = synchronized(stateLock) {
          errorReportingApiKey = apiKey
          vpnTunnelService
        }
        SentryErrorReporter.init(baseContext(), apiKey)
        service?.initErrorReporting(apiKey)
        call.resolve()
      } catch (e: Exception) {
        sendErrorResult(call, platformErrorFromException(e))
      }
    }
  }

  @PluginMethod
  fun reportEvents(call: PluginCall) {
    executor.execute {
      try {
        val uuid = call.getString("uuid")
        if (uuid.isNullOrEmpty()) {
          call.reject("Missing report UUID.")
          return@execute
        }
        SentryErrorReporter.send(uuid)
        call.resolve()
      } catch (e: Exception) {
        sendErrorResult(call, platformErrorFromException(e))
      }
    }
  }

  @PluginMethod
  fun quitApplication(call: PluginCall) {
    val currentActivity = activity ?: run {
      call.reject("No active activity to close")
      return
    }

    currentActivity.finishAffinity()
    currentActivity.finishAndRemoveTask()

    android.os.Process.killProcess(android.os.Process.myPid())
    call.resolve()
  }

  override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.handleOnActivityResult(requestCode, resultCode, data)

    if (requestCode != REQUEST_CODE_PREPARE_VPN) return

    val startRequest = synchronized(stateLock) {
      val req = pendingVpnPermissionRequest
      pendingVpnPermissionRequest = null
      req
    } ?: return
    val call = startRequest.call

    if (resultCode != Activity.RESULT_OK) {
      sendErrorResult(call, vpnPermissionDeniedError())
      bridge.releaseCall(call)
      return
    }

    executeStartTunnel(call, startRequest.args)
  }

  private sealed class StartDecision {
    data class Dispatch(val service: IVpnTunnelService) : StartDecision()
    object Queued : StartDecision()
    object AlreadyPending : StartDecision()
  }

  private fun executeStartTunnel(call: PluginCall, args: StartArgs) {
    val decision = synchronized(stateLock) {
      val current = vpnTunnelService
      when {
        current != null -> StartDecision.Dispatch(current)
        pendingServiceBindRequest != null -> StartDecision.AlreadyPending
        else -> {
          pendingServiceBindRequest = StartVpnRequest(args, call)
          StartDecision.Queued
        }
      }
    }

    when (decision) {
      StartDecision.AlreadyPending -> {
        sendErrorResult(call, startAlreadyInProgressError())
      }
      StartDecision.Queued -> {
        call.setKeepAlive(true)
        saveCall(call)
      }
      is StartDecision.Dispatch -> executor.execute {
        try {
          val config = TunnelConfig().apply {
            id = args.tunnelId
            name = args.serverName
            transportConfig = args.transportConfig
          }
          val result = decision.service.startTunnel(config)
          if (result == null) call.resolve() else call.reject(result.errorJson)
        } catch (e: Exception) {
          sendErrorResult(call, platformErrorFromException(e))
        } finally {
          // Release the saved-call slot held when this call was queued
          // (via prepareVpnService or the Queued branch above). For an
          // unsaved call, releaseCall is a no-op.
          bridge.releaseCall(call)
        }
      }
    }
  }

  private fun prepareVpnService(call: PluginCall, args: StartArgs): Boolean {
    val prepareIntent = VpnService.prepare(baseContext())
    if (prepareIntent == null) return true

    val currentActivity = activity ?: run {
      call.reject("Unable to request VPN permission without an active activity.")
      return false
    }

    val alreadyPending = synchronized(stateLock) {
      if (pendingVpnPermissionRequest != null) {
        true
      } else {
        pendingVpnPermissionRequest = StartVpnRequest(args, call)
        false
      }
    }
    if (alreadyPending) {
      sendErrorResult(call, startAlreadyInProgressError())
      return false
    }

    call.setKeepAlive(true)
    saveCall(call)
    currentActivity.startActivityForResult(prepareIntent, REQUEST_CODE_PREPARE_VPN)
    return false
  }

  private fun sendErrorResult(call: PluginCall, error: PlatformError) {
    val detailedError = Errors.toDetailedJsonError(error)
    if (detailedError == null) {
      call.reject("Unknown Outline error")
    } else {
      call.reject(detailedError.errorJson, detailedError.code)
    }
  }

  private fun baseContext(): Context = context.applicationContext

  companion object {
    private const val REQUEST_CODE_PREPARE_VPN = 100
    private const val STATUS_CHANGE_EVENT = "onStatusChange"
  }
}

private fun platformErrorFromException(e: Exception): PlatformError =
    PlatformError(Platerrors.InternalError, e.message ?: e.toString())

private fun vpnPermissionDeniedError(): PlatformError =
    PlatformError(Platerrors.VPNPermissionNotGranted, "VPN permission not granted")

private fun vpnServiceUnavailableError(): PlatformError =
    PlatformError(Platerrors.InternalError, "VPN tunnel service is not bound")

private fun startAlreadyInProgressError(): PlatformError =
    PlatformError(Platerrors.InternalError, "A VPN start request is already in progress")
