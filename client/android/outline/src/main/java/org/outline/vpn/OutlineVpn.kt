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

package org.outline.vpn

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.os.IBinder
import java.util.concurrent.Executor
import org.outline.DetailedJsonError
import org.outline.IVpnTunnelService
import org.outline.TunnelConfig
import org.outline.log.SentryErrorReporter

/**
 * The app's handle on the Outline VPN.
 *
 * [VpnTunnelService] runs in its own process. This class binds it, forwards
 * tunnel requests to it and reports the tunnel status it broadcasts. It does
 * not ask for the system VPN permission: that needs an activity, so the caller
 * does it before calling [startTunnel].
 *
 * It does not depend on the framework that hosts the web UI; the Capacitor
 * plugin is an adapter over it. `OutlineVpn` in OutlineAppleLib has the same
 * role on the Apple platforms.
 */
class OutlineVpn(context: Context, private val statusListener: StatusListener) {

  fun interface StatusListener {
    /** [status] is the value of a [VpnTunnelService.TunnelStatus]. */
    fun onStatusChange(tunnelId: String, status: Int)
  }

  /** Receives the outcome of [startTunnel]. Exactly one of the methods is called, once. */
  interface StartCallback {
    /** The service handled the request. [error] is null if the tunnel started. */
    fun onResult(error: DetailedJsonError?)

    /** The request was not handed to the service, or the call into it failed. */
    fun onFailure(cause: Exception)
  }

  private class PendingStart(
      val config: TunnelConfig,
      val executor: Executor,
      val callback: StartCallback,
  )

  private val context: Context = context.applicationContext

  // The fields below are read from both the main thread (ServiceConnection
  // callbacks) and the callers' threads, so every access must go through
  // `stateLock` to guarantee both visibility and atomicity of check-then-act
  // sequences.
  private val stateLock = Any()
  private var service: IVpnTunnelService? = null
  private var errorReportingApiKey: String? = null
  private var pendingStart: PendingStart? = null

  private val serviceConnection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      val bound = IVpnTunnelService.Stub.asInterface(binder)
      val pending: PendingStart?
      synchronized(stateLock) {
        service = bound
        pending = pendingStart
        pendingStart = null
      }
      if (pending != null) {
        dispatchStart(bound, pending)
      }
    }

    override fun onServiceDisconnected(name: ComponentName) {
      val apiKey = synchronized(stateLock) {
        service = null
        errorReportingApiKey
      }
      val rebind = Intent(context, VpnTunnelService::class.java).apply {
        putExtra(VpnServiceStarter.AUTOSTART_EXTRA, true)
        putExtra(VpnTunnelService.MessageData.ERROR_REPORTING_API_KEY.value, apiKey)
      }
      context.bindService(rebind, this, Context.BIND_AUTO_CREATE)
    }
  }

  private val statusReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      val tunnelId = intent.getStringExtra(VpnTunnelService.MessageData.TUNNEL_ID.value) ?: return
      val status = intent.getIntExtra(
          VpnTunnelService.MessageData.PAYLOAD.value,
          VpnTunnelService.TunnelStatus.INVALID.value,
      )
      statusListener.onStatusChange(tunnelId, status)
    }
  }

  /** Binds the VPN service and starts reporting tunnel status changes. */
  fun open() {
    val broadcastFilter = IntentFilter().apply {
      addAction(VpnTunnelService.STATUS_BROADCAST_KEY)
      addCategory(context.packageName)
    }
    context.registerReceiver(statusReceiver, broadcastFilter, Context.RECEIVER_NOT_EXPORTED)

    context.bindService(
        Intent(context, VpnTunnelService::class.java),
        serviceConnection,
        Context.BIND_AUTO_CREATE,
    )
  }

  /** Undoes [open]. The tunnel, if any, keeps running in the service. */
  fun close() {
    try {
      context.unregisterReceiver(statusReceiver)
    } catch (ignored: IllegalArgumentException) { }
    kotlin.runCatching { context.unbindService(serviceConnection) }
  }

  /**
   * Asks the service to start a tunnel, waiting for the service to be bound
   * first if it is not yet. The blocking call into the service runs on
   * [executor], and so does [callback], except when the request is refused
   * because another one is already waiting for the service: [callback] is then
   * called on the calling thread before this method returns.
   */
  fun startTunnel(config: TunnelConfig, executor: Executor, callback: StartCallback) {
    val start = PendingStart(config, executor, callback)
    val decision = synchronized(stateLock) {
      val current = service
      when {
        current != null -> StartDecision.Dispatch(current)
        pendingStart != null -> StartDecision.AlreadyPending
        else -> {
          pendingStart = start
          StartDecision.Queued
        }
      }
    }

    when (decision) {
      StartDecision.AlreadyPending ->
          callback.onFailure(IllegalStateException("A VPN start request is already in progress"))
      StartDecision.Queued -> Unit // Dispatched by onServiceConnected.
      is StartDecision.Dispatch -> dispatchStart(decision.service, start)
    }
  }

  /**
   * Asks the service to stop a tunnel. Blocks on the call into the service.
   *
   * @return null if the tunnel was stopped.
   * @throws IllegalStateException if the service is not bound.
   */
  fun stopTunnel(tunnelId: String): DetailedJsonError? {
    val current = synchronized(stateLock) { service }
        ?: throw IllegalStateException("VPN tunnel service is not bound")
    return current.stopTunnel(tunnelId)
  }

  /** Whether the tunnel is running. False if the service cannot be asked. */
  fun isTunnelActive(tunnelId: String): Boolean {
    val current = synchronized(stateLock) { service }
    return try {
      current?.isTunnelActive(tunnelId) ?: false
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Starts error reporting in the app process and in the service's. The key is
   * kept, to hand it to the service again if it has to be bound anew.
   */
  fun initErrorReporting(apiKey: String) {
    val current = synchronized(stateLock) {
      errorReportingApiKey = apiKey
      service
    }
    SentryErrorReporter.init(context, apiKey)
    current?.initErrorReporting(apiKey)
  }

  private sealed class StartDecision {
    data class Dispatch(val service: IVpnTunnelService) : StartDecision()
    object Queued : StartDecision()
    object AlreadyPending : StartDecision()
  }

  private fun dispatchStart(service: IVpnTunnelService, start: PendingStart) {
    start.executor.execute {
      val error = try {
        service.startTunnel(start.config)
      } catch (e: Exception) {
        start.callback.onFailure(e)
        return@execute
      }
      start.callback.onResult(error)
    }
  }
}
