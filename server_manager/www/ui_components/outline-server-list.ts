// Copyright 2021 The Outline Authors
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

import './outline-server-view';

import {html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';

import type {DisplayCloudId} from './cloud-assets';
import type {ServerView} from './outline-server-view';

export interface ServerViewListEntry {
  id: string;
  name: string;
  cloudId: DisplayCloudId;
}

@customElement('outline-server-list')
export class OutlineServerList extends LitElement {
  @property({type: Array}) serverList: ServerViewListEntry[];
  @property({type: String}) selectedServerId: string;
  @property({type: Function}) localize: Function;
  @property({type: String}) language: string;
  @property({type: Object}) featureFlags: {[key: string]: boolean};
  @property({type: String}) donateUrl: string;
  @property({type: Boolean}) showDonateBanner = false;

  render() {
    if (!this.serverList) {
      return;
    }
    return html`<div>
      ${repeat(
        this.serverList,
        e => e.id,
        e => html`
          <outline-server-view
            .id="${this.makeViewId(e.id)}"
            .serverId="${e.id}"
            .serverName="${e.name}"
            .cloudId="${e.cloudId}"
            .language="${this.language}"
            .localize="${this.localize}"
            .featureFlags="${this.featureFlags}"
            .donateUrl="${this.donateUrl}"
            .showDonateBanner="${this.showDonateBanner}"
            ?hidden="${e.id !== this.selectedServerId}"
          >
          </outline-server-view>
        `
      )}
    </div>`;
  }

  async getServerView(serverId: string): Promise<ServerView> {
    if (!serverId) {
      return null;
    }
    // We need to wait updates to be completed or the view may not yet be there.
    await this.updateComplete;
    const selector = `#${this.makeViewId(serverId)}`;
    return this.shadowRoot.querySelector<ServerView>(selector);
  }

  // Wrapper to encode a string in base64. This is necessary to set the server view IDs to
  // the display server IDs, which are URLs, so they can be used with selector methods. The IDs
  // are never decoded.
  private makeViewId(serverId: string): string {
    return `serverView-${btoa(serverId).replace(/=/g, '')}`;
  }
}
