/*
  Copyright 2026 The Outline Authors
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

import '@material/web/dialog/dialog.js';
import '@material/web/menu/menu.js';
import '@material/web/menu/menu-item.js';

import type {MdDialog} from '@material/web/dialog/dialog.js';
import type {MdMenu} from '@material/web/menu/menu.js';

import {fixture, html, oneEvent} from '@open-wc/testing';

import {dismissTopmostOverlay} from './dismiss_topmost_overlay';

async function openDialog(dialog: MdDialog) {
  const opened = oneEvent(dialog, 'opened');
  dialog.open = true;
  await opened;
}

async function openMenu(menu: MdMenu, anchor: HTMLElement) {
  const opened = oneEvent(menu, 'opened');
  menu.anchorElement = anchor;
  menu.open = true;
  await opened;
}

// Hosts its content in an open shadow root, like the app's Lit views.
class ShadowHost extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
  }
}
customElements.define('dismiss-overlay-shadow-host', ShadowHost);

describe('dismissTopmostOverlay', () => {
  it('returns false when nothing is open', async () => {
    const el = await fixture(html`
      <div>
        <md-dialog quick><div slot="content">Dialog</div></md-dialog>
      </div>
    `);

    expect(dismissTopmostOverlay(el)).toBeFalse();
  });

  it('cancels and closes an open dialog', async () => {
    const el = await fixture(html`
      <div>
        <md-dialog quick><div slot="content">Dialog</div></md-dialog>
      </div>
    `);
    const dialog = el.querySelector('md-dialog')!;
    await openDialog(dialog);
    const cancelListener = jasmine.createSpy('cancel');
    dialog.addEventListener('cancel', cancelListener);
    const closed = oneEvent(dialog, 'closed');

    expect(dismissTopmostOverlay(el)).toBeTrue();
    await closed;

    expect(cancelListener).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBeFalse();
  });

  it('leaves a dialog open when its cancel event is prevented', async () => {
    const el = await fixture(html`
      <div>
        <md-dialog quick @cancel=${(event: Event) => event.preventDefault()}>
          <div slot="content">Dialog</div>
        </md-dialog>
      </div>
    `);
    const dialog = el.querySelector('md-dialog')!;
    await openDialog(dialog);

    expect(dismissTopmostOverlay(el)).toBeTrue();
    await dialog.updateComplete;

    expect(dialog.open).toBeTrue();
  });

  it('finds a dialog inside a shadow root', async () => {
    const host = await fixture<ShadowHost>(
      html`<dismiss-overlay-shadow-host></dismiss-overlay-shadow-host>`
    );
    const dialog = document.createElement('md-dialog');
    dialog.quick = true;
    host.shadowRoot!.append(dialog);
    await openDialog(dialog);
    const closed = oneEvent(dialog, 'closed');

    expect(dismissTopmostOverlay(host.parentNode!)).toBeTrue();
    await closed;

    expect(dialog.open).toBeFalse();
  });

  it('closes a menu before the dialog that hosts it', async () => {
    const el = await fixture(html`
      <div>
        <md-dialog quick>
          <div slot="content">
            <button id="anchor">Anchor</button>
            <md-menu quick>
              <md-menu-item><div slot="headline">Item</div></md-menu-item>
            </md-menu>
          </div>
        </md-dialog>
      </div>
    `);
    const dialog = el.querySelector('md-dialog')!;
    const menu = el.querySelector('md-menu')!;
    await openDialog(dialog);
    await openMenu(menu, el.querySelector<HTMLElement>('#anchor')!);
    const menuClosed = oneEvent(menu, 'closed');

    expect(dismissTopmostOverlay(el)).toBeTrue();
    await menuClosed;

    expect(menu.open).toBeFalse();
    expect(dialog.open).toBeTrue();

    const dialogClosed = oneEvent(dialog, 'closed');
    expect(dismissTopmostOverlay(el)).toBeTrue();
    await dialogClosed;

    expect(dialog.open).toBeFalse();
  });
});
