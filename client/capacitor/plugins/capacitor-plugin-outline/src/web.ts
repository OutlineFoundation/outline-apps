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

import {WebPlugin} from '@capacitor/core';

import type {CapacitorPluginOutline} from './definitions';

export class CapacitorPluginOutlineWeb
  extends WebPlugin
  implements CapacitorPluginOutline
{
  async invokeMethod(_options: {
    method: string;
    input: string;
  }): Promise<{value: string}> {
    throw this.unimplemented('Not implemented on web.');
  }

  async start(_options: {
    tunnelId: string;
    serverName: string;
    transportConfig: string;
  }): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async stop(_options: {tunnelId: string}): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async isRunning(_options: {tunnelId: string}): Promise<{isRunning: boolean}> {
    throw this.unimplemented('Not implemented on web.');
  }

  async initializeErrorReporting(_options: {apiKey: string}): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async reportEvents(_options: {uuid: string}): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async quitApplication(): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }
}
