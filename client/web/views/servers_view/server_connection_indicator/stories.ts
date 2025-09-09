/* tslint:disable */
/*
  Copyright 2022 The Outline Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import {html} from 'lit';

import {ServerConnectionIndicator, ServerConnectionState} from './index';

export default {
  title: 'Client/Servers View/Server Connection Indicator',
  component: 'server-connection-indicator',
  args: {
    connectionState: ServerConnectionState.DISCONNECTED,
  },
  argTypes: {
    connectionState: {
      control: 'select',
      options: Object.values(ServerConnectionState),
    },
  },
};

export const Example = ({connectionState}: ServerConnectionIndicator) =>
  html`
    <div style="width: clamp(64px, 100vw, 512px); height: clamp(64px, 100vh, 512px);">
      <server-connection-indicator
        connection-state="${connectionState ?? ServerConnectionState.DISCONNECTED}"
      ></server-connection-indicator>
    </div>
  `;
