/*
  Copyright 2024 The Outline Authors
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
import '@material/web/all';

import './index';
import type {AddAccessKeyDialog} from './index';
import {localize} from '../../../testing/localize';

export default {
  title: 'Client/Root View/Add Access Key Dialog',
  component: 'add-access-key-dialog',
  args: {
    open: true,
    accessKey: 'ss://YWVzLTI1Ni1nY206c2VjcmV0QHNzLm9yZw@127.0.0.1:443#Test',
  },
};

export const Example = ({open, accessKey}: AddAccessKeyDialog) =>
  html`<add-access-key-dialog
    .open=${open}
    .localize=${localize}
    .accessKey=${accessKey}
    .accessKeyValidator=${async (key: string) => {
      return key.startsWith('ss://') || key.startsWith('ssconf://');
    }}
  ></add-access-key-dialog>`;
