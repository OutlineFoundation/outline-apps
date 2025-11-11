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

import {Capacitor} from '@capacitor/core';

import {CapacitorPluginOutline} from '../../capacitor/plugins/capacitor-plugin-outline/src/index';
import {deserializeError} from '../model/platform_error';

export type VpnStatusPayload = {id: string; status: number};

let pluginInstance: typeof CapacitorPluginOutline | null = null;

function throwDeserialized(error: unknown): never {
  throw deserializeError(error);
}

export async function pluginExec<T>(
  cmd: string,
  ...args: unknown[]
): Promise<T> {
  let plugin;

  // Ensure plugin is loaded (but don't await the plugin object itself)
  if (!pluginInstance) {
    try {
      const pluginModule = await import(
        '../../capacitor/plugins/capacitor-plugin-outline/src/index'
      );
      pluginInstance = pluginModule.CapacitorPluginOutline;
    } catch (e) {
      console.error('[pluginExec] Failed to load plugin module:', e);
      throw e;
    }
  }

  plugin = pluginInstance;
  if (!plugin) {
    if (!Capacitor.isNativePlatform()) {
      throwDeserialized(
        new Error('Outline native plugin is not available on web platform')
      );
    }
    throwDeserialized(new Error('OutlinePlugin not available'));
  }

  try {
    switch (cmd) {
      case 'invokeMethod': {
        const [method, input] = args as [string, string];
        let result;
        try {
          result = await plugin.invokeMethod({
            method,
            input: input ?? '',
          });
        } catch (e) {
          console.error('[pluginExec] invokeMethod threw error:', e);
          throw e;
        }

        return (result?.value ?? '') as T;
      }
      case 'start': {
        const [tunnelId, serverName, transportConfig] = args as [
          string,
          string,
          string,
        ];

        try {
          await plugin.start({
            tunnelId,
            serverName,
            transportConfig,
          });
        } catch (e) {
          console.error(
            `[pluginExec] CapacitorPluginOutline.start failed - tunnelId: ${tunnelId}`,
            e
          );
          throw e;
        }
        return undefined as T;
      }
      case 'stop': {
        const [tunnelId] = args as [string];
        await plugin.stop({tunnelId});
        return undefined as T;
      }
      case 'isRunning': {
        const [tunnelId] = args as [string];
        const result = await plugin.isRunning({tunnelId});
        return Boolean(result?.isRunning) as T;
      }
      case 'initializeErrorReporting': {
        const [apiKey] = args as [string];
        await plugin.initializeErrorReporting({apiKey});
        return undefined as T;
      }
      case 'reportEvents': {
        const [uuid] = args as [string];
        await plugin.reportEvents({uuid});
        return undefined as T;
      }
      case 'quitApplication': {
        await plugin.quitApplication();
        return undefined as T;
      }
      default:
        throw new Error(`Unsupported Outline Capacitor command: ${cmd}`);
    }
  } catch (e) {
    throwDeserialized(e);
  }
}

export async function registerVpnStatusListener(
  listener: (payload: VpnStatusPayload) => void,
  onError?: (err: unknown) => void
): Promise<void> {
  try {
    // Ensure plugin is loaded (but don't await the plugin object itself)
    if (!pluginInstance) {
      const pluginModule = await import(
        '../../capacitor/plugins/capacitor-plugin-outline/src/index'
      );
      pluginInstance = pluginModule.CapacitorPluginOutline;
    }

    const plugin = pluginInstance;
    if (!plugin) {
      const errorMsg =
        'Outline native plugin is not available on this platform';
      if (onError) {
        onError(deserializeError(new Error(errorMsg)));
      } else {
        console.warn(errorMsg);
      }
      return;
    }

    await plugin.addListener('vpnStatus', listener);
  } catch (err: unknown) {
    console.error(
      '[registerVpnStatusListener] Failed to register listener:',
      err
    );
    if (onError) {
      onError(deserializeError(err));
    } else {
      console.warn('Failed to register Capacitor vpnStatus listener', err);
    }
  }
}
