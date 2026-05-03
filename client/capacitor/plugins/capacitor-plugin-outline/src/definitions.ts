/**
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

import type { PluginListenerHandle } from '@capacitor/core';

export interface ExecuteOptions {
  action: string;
  method?: string;
  input?: string;
  tunnelId?: string;
  serverName?: string;
  transportConfig?: string;
  apiKey?: string;
  uuid?: string;
}

export interface ExecuteResult {
  value: string;
  isRunning: boolean;
}

export interface VpnStatusData {
  id: string;
  status: number;
}

export const Actions = {
  INVOKE_METHOD: 'invokeMethod',
  START: 'start',
  STOP: 'stop',
  ON_STATUS_CHANGE: 'onStatusChange',
  IS_RUNNING: 'isRunning',
  INIT_ERROR_REPORTING: 'initializeErrorReporting',
  REPORT_EVENTS: 'reportEvents',
  QUIT: 'quitApplication',
} as const;

export type Action = typeof Actions[keyof typeof Actions];

export interface CapacitorPluginOutline {
  execute(options: ExecuteOptions): Promise<ExecuteResult>;

  addListener(
    eventName: string,
    listenerFunc: (data: VpnStatusData) => void
  ): Promise<PluginListenerHandle>;
}
