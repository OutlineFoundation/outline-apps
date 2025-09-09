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

import './index';
import type {RootHeader} from './index';

export default {
  title: 'Client/Root View/Root Header',
  component: 'root-header',
  args: {
    title: 'Outline',
    showBackButton: false,
    showAddButton: true,
  },
};

export const Example = ({title, showBackButton, showAddButton}: RootHeader) =>
  html`<root-header
    .title=${title}
    .showBackButton=${showBackButton}
    .showAddButton=${showAddButton}
  ></root-header>`;
