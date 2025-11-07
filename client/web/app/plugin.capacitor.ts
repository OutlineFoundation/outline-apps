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

import { Capacitor } from '@capacitor/core';

import { CapacitorPluginOutline } from '../../capacitor/plugins/capacitor-plugin-outline/src/index';
import { deserializeError } from '../model/platform_error';

export type VpnStatusPayload = { id: string; status: number };

function throwDeserialized(error: unknown): never {
    throw deserializeError(error);
}

export async function pluginExec<T>(
    cmd: string,
    ...args: unknown[]
): Promise<T> {
    if (!CapacitorPluginOutline) {
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
                const result = await CapacitorPluginOutline.invokeMethod({
                    method,
                    input: input ?? '',
                });
                return (result?.value ?? '') as T;
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
                return undefined as T;
            }
            case 'stop': {
                const [tunnelId] = args as [string];
                await CapacitorPluginOutline.stop({ tunnelId });
                return undefined as T;
            }
            case 'isRunning': {
                const [tunnelId] = args as [string];
                const result = await CapacitorPluginOutline.isRunning({ tunnelId });
                return Boolean(result?.isRunning) as T;
            }
            case 'initializeErrorReporting': {
                const [apiKey] = args as [string];
                await CapacitorPluginOutline.initializeErrorReporting({ apiKey });
                return undefined as T;
            }
            case 'reportEvents': {
                const [uuid] = args as [string];
                await CapacitorPluginOutline.reportEvents({ uuid });
                return undefined as T;
            }
            case 'quitApplication': {
                await CapacitorPluginOutline.quitApplication();
                return undefined as T;
            }
            default:
                throw new Error(`Unsupported Outline Capacitor command: ${cmd}`);
        }
    } catch (e) {
        throwDeserialized(e);
    }
}

export function registerVpnStatusListener(
    listener: (payload: VpnStatusPayload) => void,
    onError?: (err: unknown) => void
): void {
    if (!CapacitorPluginOutline) {
        const errorMsg = 'Outline native plugin is not available on this platform';
        if (onError) {
            onError(deserializeError(new Error(errorMsg)));
        } else {
            console.warn(errorMsg);
        }
        return;
    }

    CapacitorPluginOutline.addListener('vpnStatus', listener).catch(
        (err: unknown) => {
            if (onError) {
                onError(deserializeError(err));
            } else {
                console.warn('Failed to register Capacitor vpnStatus listener', err);
            }
        }
    );
}
