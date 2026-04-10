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

import type {PluginListenerHandle} from '@capacitor/core';

export interface CapacitorPluginOutline {
  invokeMethod(options: {
    method: string;
    input: string;
  }): Promise<{value: string}>;
  start(options: {
    tunnelId: string;
    serverName: string;
    transportConfig: string;
  }): Promise<void>;
  stop(options: {tunnelId: string}): Promise<void>;
  isRunning(options: {tunnelId: string}): Promise<{isRunning: boolean}>;
  initializeErrorReporting(options: {apiKey: string}): Promise<void>;
  reportEvents(options: {uuid: string}): Promise<void>;
  quitApplication(): Promise<void>;
  addListener(
    eventName: 'vpnStatus',
    listenerFunc: (data: {id: string; status: number}) => void
  ): Promise<PluginListenerHandle>;
}
