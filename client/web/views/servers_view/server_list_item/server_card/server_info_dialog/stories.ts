/*
  Copyright 2025 The Outline Authors
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

import './index';
import {localize} from '../../../../../testing/localize';

export default {
  title: 'Client/Servers View/Server List Item/Server Info Dialog',
  args: {
    open: true,
  },
};

export const Proxyless = ({open}: {open: boolean}) => {
  return html`
    <server-proxyless-info-dialog
      .open=${open}
      .localize=${localize}
    ></server-proxyless-info-dialog>
  `;
};

export const SplitTunneling = ({open}: {open: boolean}) => {
  return html`
    <server-split-tunneling-info-dialog
      .open=${open}
      .localize=${localize}
    ></server-split-tunneling-info-dialog>
  `;
};

export const CompleteProtection = ({open}: {open: boolean}) => {
  return html`
    <server-complete-protection-info-dialog
      .open=${open}
      .localize=${localize}
    ></server-complete-protection-info-dialog>
  `;
};
