// Copyright 2026 The Outline Authors
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

import {fixture, html} from '@open-wc/testing';

import type {RootNavigation} from './index';
import './index';

describe('RootNavigation', () => {
  it('resets the drawer scroll when it is reopened', async () => {
    const navigation = await fixture<RootNavigation>(html`
      <root-navigation .open=${true}></root-navigation>
    `);
    const nav = navigation.shadowRoot!.querySelector<HTMLElement>('nav')!;
    let scrollTop = 76;
    Object.defineProperty(nav, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: value => {
        scrollTop = value;
      },
    });

    navigation.open = false;
    await navigation.updateComplete;
    navigation.open = true;
    await navigation.updateComplete;
    await new Promise(resolve => requestAnimationFrame(resolve));

    expect(nav.scrollTop).toBe(0);
  });

  it('uses a native button for licenses navigation', async () => {
    const navigation = await fixture<RootNavigation>(html`
      <root-navigation .open=${true}></root-navigation>
    `);
    let page: string | undefined;
    navigation.addEventListener('ChangePage', event => {
      page = (event as CustomEvent<{page: string}>).detail.page;
    });

    const licensesButton =
      navigation.shadowRoot!.querySelector<HTMLButtonElement>(
        'ul li > button'
      )!;
    expect(licensesButton.type).toBe('button');
    expect(licensesButton.tabIndex).toBe(0);

    licensesButton.click();

    expect(page).toBe('licenses');
  });
});
