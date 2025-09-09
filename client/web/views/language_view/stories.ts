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
import type {LanguageView} from './index';

export default {
  title: 'Client/Language View',
  component: 'contact-view',
  args: {
    selectedLanguageId: 'en',
    languages: [
      {id: 'en', name: 'English'},
      {id: 'es', name: 'Español'},
    ],
  },
};

export const Example = ({selectedLanguageId, languages}: LanguageView) => html`
  <language-view
    selectedLanguageId=${selectedLanguageId}
    .languages=${languages}
  ></language-view>
`;
