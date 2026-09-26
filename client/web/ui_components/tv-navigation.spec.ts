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

import {collectTvFocusable, installTvNavigation} from './tv-navigation.js';

function setRect(element: HTMLElement, x: number, y: number) {
  Object.assign(element.style, {
    height: '20px',
    left: `${x}px`,
    position: 'fixed',
    top: `${y}px`,
    width: '20px',
  });
}

type MenuElement = HTMLElement & {
  activateNextItem: () => void;
  activatePreviousItem: () => void;
  close: () => void;
  items: HTMLElement[];
  open: boolean;
  stayOpenOnFocusout: boolean;
};

describe('TV navigation', () => {
  let root: HTMLDivElement;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup = undefined;
    root = document.createElement('div');
    document.body.append(root);
    spyOn(document, 'elementFromPoint').and.callFake((x, y) => {
      const elements: Element[] = [];
      const visit = (container: ParentNode) => {
        for (const element of container.querySelectorAll('*')) {
          elements.push(element);
          if (element.shadowRoot) visit(element.shadowRoot);
        }
      };
      visit(document);
      return (
        elements.reverse().find(element => {
          const rect = element.getBoundingClientRect();
          return (
            x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
          );
        }) ?? null
      );
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    root.remove();
  });

  const navigationSettled = () =>
    new Promise(resolve => globalThis.setTimeout(resolve, 0));

  it('moves focus in the requested spatial direction', async () => {
    const left = document.createElement('button');
    const right = document.createElement('button');
    root.append(left, right);
    setRect(left, 0, 0);
    setRect(right, 100, 0);
    cleanup = installTvNavigation(root);
    left.focus();

    left.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowRight',
      })
    );

    await navigationSettled();

    expect(document.activeElement).toBe(right);
  });

  it('reaches controls outside the viewport and scrolls them into view', async () => {
    const first = document.createElement('button');
    const offscreen = document.createElement('button');
    root.append(first, offscreen);
    setRect(first, 0, 0);
    setRect(offscreen, 0, 1000);
    const scrollIntoView = spyOn(offscreen, 'scrollIntoView');
    cleanup = installTvNavigation(root);
    first.focus();

    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

    await navigationSettled();

    expect(document.activeElement).toBe(offscreen);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  it('keeps a focusable host whose shadow control is not tabbable', () => {
    const host = document.createElement('div');
    host.tabIndex = 0;
    const shadowRoot = host.attachShadow({mode: 'open'});
    const internalControl = document.createElement('button');
    internalControl.tabIndex = -1;
    shadowRoot.append(internalControl);
    root.append(host);
    setRect(host, 0, 0);

    expect(collectTvFocusable(root)).toContain(host);
  });

  it('keeps Material button list items with a roving tabindex', () => {
    const item = document.createElement('md-list-item');
    item.setAttribute('role', 'button');
    item.tabIndex = -1;
    root.append(item);
    setRect(item, 0, 0);

    expect(collectTvFocusable(root)).toContain(item);
  });

  it('moves between controls that delegate focus into shadow DOM', async () => {
    const createControl = (x: number) => {
      const host = document.createElement('div');
      host.tabIndex = 0;
      const shadowRoot = host.attachShadow({
        mode: 'open',
        delegatesFocus: true,
      });
      const internalControl = document.createElement('button');
      internalControl.tabIndex = -1;
      shadowRoot.append(internalControl);
      root.append(host);
      setRect(host, x, 0);
      setRect(internalControl, x, 0);
      return host;
    };
    const left = createControl(0);
    const right = createControl(100);
    cleanup = installTvNavigation(root);
    left.focus();

    left.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowRight',
      })
    );
    await navigationSettled();

    expect(document.activeElement).toBe(right);
  });

  it('focuses the first available control when navigation starts', () => {
    const button = document.createElement('button');
    root.append(button);
    setRect(button, 0, 0);

    cleanup = installTvNavigation(root);

    expect(document.activeElement).toBe(button);
  });

  it('leaves horizontal arrows to text fields', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    root.append(input, button);
    setRect(input, 0, 0);
    setRect(button, 100, 0);
    cleanup = installTvNavigation(root);
    input.focus();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      composed: true,
      cancelable: true,
      key: 'ArrowRight',
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBeFalse();
    expect(document.activeElement).toBe(input);
  });

  it('moves vertically out of text fields', async () => {
    const input = document.createElement('textarea');
    const button = document.createElement('button');
    root.append(input, button);
    setRect(input, 0, 0);
    setRect(button, 0, 100);
    cleanup = installTvNavigation(root);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

    await navigationSettled();

    expect(document.activeElement).toBe(button);
  });

  it('lets the access-key dialog route Down to its action button', async () => {
    const dialog = document.createElement('div');
    Object.defineProperty(dialog, 'localName', {
      configurable: true,
      value: 'add-access-key-dialog',
    });
    const dialogShadowRoot = dialog.attachShadow({mode: 'open'});
    const textField = document.createElement('md-filled-text-field');
    const confirmButton = document.createElement('md-filled-button');
    textField.tabIndex = 0;
    confirmButton.tabIndex = 0;
    dialogShadowRoot.append(textField, confirmButton);
    root.append(dialog);
    setRect(textField, 0, 0);
    setRect(confirmButton, 0, 100);
    cleanup = installTvNavigation(root);
    textField.focus();

    textField.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

    await navigationSettled();

    expect(dialogShadowRoot.activeElement).toBe(confirmButton);
  });

  it('routes Down to Cancel when the access key cannot be confirmed', async () => {
    const dialog = document.createElement('div');
    Object.defineProperty(dialog, 'localName', {
      configurable: true,
      value: 'add-access-key-dialog',
    });
    const dialogShadowRoot = dialog.attachShadow({mode: 'open'});
    const textField = document.createElement('md-filled-text-field');
    const cancelButton = document.createElement('md-text-button');
    const confirmButton = document.createElement('md-filled-button');
    textField.tabIndex = 0;
    cancelButton.tabIndex = 0;
    confirmButton.tabIndex = 0;
    confirmButton.disabled = true;
    dialogShadowRoot.append(textField, cancelButton, confirmButton);
    root.append(dialog);
    setRect(textField, 0, 0);
    setRect(cancelButton, 0, 100);
    setRect(confirmButton, 100, 100);
    const focusCancel = spyOn(cancelButton, 'focus').and.callThrough();
    cleanup = installTvNavigation(root);
    textField.focus();

    textField.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

    await navigationSettled();

    expect(focusCancel).toHaveBeenCalled();
  });

  it('routes arrow keys through an open menu', () => {
    const menu = document.createElement('md-menu') as MenuElement;
    const item = document.createElement('button');
    const activateNextItem = jasmine.createSpy('activateNextItem');
    menu.activateNextItem = activateNextItem;
    menu.activatePreviousItem = jasmine.createSpy('activatePreviousItem');
    menu.close = jasmine.createSpy('close');
    Object.defineProperty(menu, 'items', {
      configurable: true,
      value: [item],
    });
    menu.open = true;
    menu.stayOpenOnFocusout = false;
    menu.append(item);
    root.append(menu);
    setRect(item, 0, 0);
    cleanup = installTvNavigation(root);
    item.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: 'ArrowDown',
    });
    item.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(activateNextItem).toHaveBeenCalled();
    expect(menu.stayOpenOnFocusout).toBeFalse();
  });

  it('activates the selected item and closes an open menu', () => {
    const menu = document.createElement('md-menu') as MenuElement;
    const item = document.createElement('button');
    const close = jasmine.createSpy('close');
    menu.activateNextItem = jasmine.createSpy('activateNextItem');
    menu.activatePreviousItem = jasmine.createSpy('activatePreviousItem');
    menu.close = close;
    Object.defineProperty(menu, 'items', {
      configurable: true,
      value: [item],
    });
    menu.open = true;
    menu.stayOpenOnFocusout = false;
    menu.append(item);
    root.append(menu);
    setRect(item, 0, 0);
    spyOn(item, 'click');
    cleanup = installTvNavigation(root);
    item.focus();

    item.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'Enter',
      })
    );
    item.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'Escape',
      })
    );

    expect(item.click).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('closes the left navigation with the right arrow', () => {
    const navigation = document.createElement(
      'root-navigation'
    ) as HTMLElement & {
      align: string;
      open: boolean;
    };
    navigation.align = 'left';
    navigation.open = true;
    const hideNavigation = jasmine.createSpy('hideNavigation');
    navigation.addEventListener('HideNavigation', hideNavigation);
    const item = document.createElement('button');
    navigation.append(item);
    root.append(navigation);
    setRect(item, 0, 0);
    cleanup = installTvNavigation(root);
    item.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: 'ArrowRight',
    });
    item.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(hideNavigation).toHaveBeenCalled();
  });

  it('does not steal focus while a dialog is open', () => {
    const dialog = document.createElement('div');
    Object.defineProperty(dialog, 'localName', {value: 'md-dialog'});
    Object.defineProperty(dialog, 'open', {
      configurable: true,
      value: true,
    });
    const button = document.createElement('button');
    root.append(dialog, button);
    setRect(button, 0, 0);
    cleanup = installTvNavigation(root);

    expect(document.activeElement).not.toBe(button);
  });

  it('limits focus to an open dialog instead of the page behind it', () => {
    const dialog = document.createElement('div');
    Object.defineProperty(dialog, 'localName', {value: 'md-dialog'});
    Object.defineProperty(dialog, 'open', {value: true});
    const dialogButton = document.createElement('button');
    const backgroundButton = document.createElement('button');
    dialog.append(dialogButton);
    root.append(dialog, backgroundButton);
    setRect(dialogButton, 0, 0);
    setRect(backgroundButton, 100, 0);

    expect(collectTvFocusable(root)).toEqual([dialogButton]);
  });

  it('activates custom controls with Enter', () => {
    const item = document.createElement('md-list-item');
    item.setAttribute('role', 'button');
    item.tabIndex = -1;
    root.append(item);
    setRect(item, 0, 0);
    spyOn(item, 'click');
    cleanup = installTvNavigation(root);
    item.focus();

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: 'Enter',
    });
    item.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(item.click).toHaveBeenCalled();
  });

  it('does not collect a translated-offscreen navigation control', () => {
    const navigation = document.createElement('root-navigation');
    const item = document.createElement('button');
    navigation.append(item);
    root.append(navigation);
    setRect(item, -100, 0);

    expect(collectTvFocusable(root)).not.toContain(item);
  });

  it('does not collect controls from a closed overlay in the viewport', () => {
    const navigation = document.createElement(
      'root-navigation'
    ) as HTMLElement & {
      open: boolean;
    };
    const item = document.createElement('button');
    navigation.open = false;
    navigation.append(item);
    root.append(navigation);
    setRect(item, 0, 0);

    expect(collectTvFocusable(root)).not.toContain(item);
  });

  it('does not scan after navigation is cleaned up', async () => {
    cleanup = installTvNavigation(root);
    cleanup();
    cleanup = undefined;

    const button = document.createElement('button');
    root.append(button);
    setRect(button, 0, 0);
    await navigationSettled();

    expect(document.activeElement).not.toBe(button);
  });
});
