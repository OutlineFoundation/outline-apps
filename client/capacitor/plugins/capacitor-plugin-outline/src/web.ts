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

import { WebPlugin } from '@capacitor/core';

import type { CapacitorPluginOutline, ExecuteOptions, ExecuteResult, VpnStatusData } from './definitions';

export class CapacitorPluginOutlineWeb
  extends WebPlugin
  implements CapacitorPluginOutline {
  async execute(_options: ExecuteOptions): Promise<ExecuteResult> {
    throw this.unimplemented('Not implemented on web.');
  }

  async addListener(
    _eventName: string,
    _listenerFunc: (data: VpnStatusData) => void
  ): Promise<any> {
    throw this.unimplemented('Not implemented on web.');
  }
}
