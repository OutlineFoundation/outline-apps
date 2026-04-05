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

// Starting from electron 12, contextIsolation is turned on by default.
// So we are not able to use node APIs or electron APIs in renderer scripts
// any more. We have to inject key features into the global window object
// in preload: https://www.electronjs.org/docs/latest/tutorial/tutorial-preload.

// Please also update preload.d.ts whenever you changed this file.

import * as os from 'node:os';

import {
  clipboard,
  contextBridge,
  ipcRenderer,
  IpcRendererEvent,
} from 'electron';

/**
 * The method channel for sending messages through electron's IPC.
 *
 * All functions are defined as fields because `contextBridge` will only inject
 * fields (defined in object) but not functions (defined in prototype) to the
 * global object.
 */
export class ElectronRendererMethodChannel {
  /**
   * Construct a electron's renderer method channel with a specific namespace.
   * @param namespace The namespace string which will be the prefix of all channels.
   *
   * We need to have a namespace due to security consideration:
   *   - https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations
   */
  constructor(private readonly namespace: string) {}

  readonly send = (channel: string, ...args: unknown[]): void =>
    ipcRenderer.send(`${this.namespace}-${channel}`, ...args);

  // TODO: replace the `any` with a better type once we unify the IPC call framework
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  readonly invoke = async (
    channel: string,
    ...args: unknown[]
  ): Promise<any> => {
    const ipcName = `${this.namespace}-${channel}`;
    try {
      return await ipcRenderer.invoke(ipcName, ...args);
    } catch (e) {
      // Normalize the error message to what's being thrown in the IPC itself
      //   e.message == "Error invoking remote method 'xxx': <error name>: <actual message>"
      // https://github.com/electron/electron/blob/v31.0.0/lib/renderer/api/ipc-renderer.ts#L22
      if (typeof e?.message === 'string') {
        const errPattern = new RegExp(
          `'${ipcName}':\\s*(?<name>[^:]+):\\s*(?<message>.*)`,
          's'
        );
        const groups = e.message.match(errPattern)?.groups;
        if (
          typeof groups?.['name'] === 'string' &&
          typeof groups?.['message'] === 'string'
        ) {
          e.name = groups['name'];
          e.message = groups['message'];
        }
      }
      throw e;
    }
  };

  readonly on = (
    channel: string,
    listener: (e: IpcRendererEvent, ...args: unknown[]) => void
  ): void => {
    ipcRenderer.on(`${this.namespace}-${channel}`, listener);
  };

  readonly once = (
    channel: string,
    listener: (e: IpcRendererEvent, ...args: unknown[]) => void
  ): void => {
    ipcRenderer.once(`${this.namespace}-${channel}`, listener);
  };
}

contextBridge.exposeInMainWorld('electron', {
  // TODO: move this os definition to a platform api call in the future
  os: {
    platform: os.platform(),
  },
  // TODO: move this clipboard definition to a platform api call as well
  clipboard: clipboard,
  // TODO: refactor channel namespace to a constant
  methodChannel: new ElectronRendererMethodChannel('outline-ipc'),
});
