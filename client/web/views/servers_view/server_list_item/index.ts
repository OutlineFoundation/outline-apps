/*
  Copyright 2021 The Outline Authors
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

import type {Menu} from '@material/web/menu/menu';

import {type Localizer} from '@outline/infrastructure/i18n';
import {Ref} from 'lit/directives/ref';

import {ServerConnectionState} from '../server_connection_indicator';

export enum ServerListItemEvent {
  CONNECT = 'ConnectPressed',
  DISCONNECT = 'DisconnectPressed',
  FORGET = 'ForgetPressed',
  RENAME = 'RenameRequested',
}

/**
 * Data required to represent a Server in the UI.
 */
export interface ServerListItem {
  disabled: boolean;
  errorMessageId?: string;
  address: string;
  id: string;
  name: string;
  connectionState: ServerConnectionState;
}

/**
 * Required attributes for an element to be used
 * as an item display in the Server List.
 */
export interface ServerListItemElement {
  server: ServerListItem;
  localize: Localizer;
  menu: Ref<Menu>;
  menuButton: Ref<HTMLElement>;
  isRenameDialogOpen: boolean;
}
