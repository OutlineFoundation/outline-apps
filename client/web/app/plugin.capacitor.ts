// Copyright 2025 The Outline Authors
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

import {CapacitorPluginOutline} from '@outline/client/capacitor/plugins/capacitor-plugin-outline/src';

import {deserializeError} from '../model/platform_error';

// Helper function to call the Outline Capacitor plugin.
export async function pluginExec<T>(
  cmd: string,
  ...args: unknown[]
): Promise<T> {
  if (!CapacitorPluginOutline) {
    throw deserializeError(
      new Error('Capacitor plugin is not available on this platform')
    );
  }

  return new Promise<T>(async (resolve, reject) => {
    const wrappedReject = (e: unknown) => reject(deserializeError(e));

    try {
      switch (cmd) {
        case 'invokeMethod': {
          const [methodName, input] = args as [string, string];
          const result = await CapacitorPluginOutline.invokeMethod({
            method: methodName,
            input: input || '',
          });
          resolve(result.value as T);
          break;
        }
        case 'initializeErrorReporting': {
          const [apiKey] = args as [string];
          await CapacitorPluginOutline.initializeErrorReporting({
            apiKey: apiKey || '',
          });
          resolve(undefined as T);
          break;
        }
        case 'reportEvents': {
          const [uuid] = args as [string];
          await CapacitorPluginOutline.reportEvents({
            uuid: uuid || '',
          });
          resolve(undefined as T);
          break;
        }
        case 'quitApplication': {
          await CapacitorPluginOutline.quitApplication();
          resolve(undefined as T);
          break;
        }
        case 'start': {
          const [tunnelId, serverName, transportConfig] = args as [
            string,
            string,
            string,
          ];
          await CapacitorPluginOutline.start({
            tunnelId,
            serverName,
            transportConfig,
          });
          resolve(undefined as T);
          break;
        }
        case 'stop': {
          const [tunnelId] = args as [string];
          await CapacitorPluginOutline.stop({
            tunnelId,
          });
          resolve(undefined as T);
          break;
        }
        case 'isRunning': {
          const [tunnelId] = args as [string];
          const result = await CapacitorPluginOutline.isRunning({
            tunnelId,
          });
          resolve(result.isRunning as T);
          break;
        }
        default:
          // For unknown commands, use invokeMethod to pass through
          const input = args.length > 0 ? JSON.stringify(args) : '';
          const result = await CapacitorPluginOutline.invokeMethod({
            method: cmd,
            input: input,
          });
          resolve(result.value as T);
      }
    } catch (e) {
      wrappedReject(e);
    }
  });
}

export function pluginRegisterListener<TPayload = unknown>(
  eventName: string,
  listener: (payload: TPayload) => void,
  onError?: (err: unknown) => void
): void {
  if (!CapacitorPluginOutline) {
    const error = new Error(
      'Capacitor plugin is not available on this platform'
    );
    if (onError) {
      onError(deserializeError(error));
    } else {
      console.warn(error.message);
    }
    return;
  }

  if (eventName === 'vpnStatus' || eventName === 'onStatusChange') {
    CapacitorPluginOutline.addListener(
      'vpnStatus',
      (data: {id: string; status: number}) => {
        listener(data as TPayload);
      }
    ).catch((err: unknown) => {
      if (onError) {
        onError(deserializeError(err));
      } else {
        console.warn('Failed to register listener:', err);
      }
    });
  } else {
    const error = new Error(`Unknown event name: ${eventName}`);
    if (onError) {
      onError(deserializeError(error));
    } else {
      console.warn(error.message);
    }
  }
}
