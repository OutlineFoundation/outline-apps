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

import '../../index';

import {ServerListItemElement} from '..';
import {localize} from '../../../../testing/localize';
import {ServerConnectionState} from '../../server_connection_indicator';

export default {
  title: 'Client/Servers View/Server List Item',
  args: {
    server: {
      name: 'My Server',
      address: '1.0.0.127',
      connectionState: ServerConnectionState.DISCONNECTED,
    },
  },
  argTypes: {
    server: {
      object: 'select',
    },
  },
};

export const ServerRowCard = ({server}: ServerListItemElement) => html`
  <div style="width: 100%; height: clamp(100px, 100%, 150px);">
    <server-row-card .localize=${localize} .server=${server}></server-row-card>
  </div>
`;

export const ServerHeroCard = ({server}: ServerListItemElement) => html`
  <div style="width: 100%; height: 100%;">
    <server-hero-card
      .localize=${localize}
      .server=${server}
    ></server-hero-card>
  </div>
`;
