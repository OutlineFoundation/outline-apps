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
  const navigationFrameSettled = () =>
    new Promise(resolve =>
      globalThis.requestAnimationFrame(() => globalThis.setTimeout(resolve, 0))
    );

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
    item.setAttribute('type', 'button');
    root.append(item);
    setRect(item, 0, 0);

    expect(collectTvFocusable(root)).toContain(item);
  });

  it('registers a Material button list item host instead of its shadow button', () => {
    const item = document.createElement('md-list-item');
    item.setAttribute('type', 'button');
    const shadowRoot = item.attachShadow({mode: 'open'});
    const button = document.createElement('button');
    shadowRoot.append(button);
    root.append(item);
    setRect(item, 0, 0);
    setRect(button, 0, 0);

    expect(collectTvFocusable(root)).toEqual([item]);
  });

  it('keeps a focusable shadow control when hit testing retargets to its host', () => {
    const host = document.createElement('md-filled-text-field');
    const shadowRoot = host.attachShadow({mode: 'open'});
    const textArea = document.createElement('textarea');
    textArea.tabIndex = 0;
    shadowRoot.append(textArea);
    root.append(host);
    setRect(host, 0, 0);
    setRect(textArea, 0, 0);
    (document.elementFromPoint as jasmine.Spy).and.returnValue(host);

    expect(collectTvFocusable(root)).toContain(textArea);
  });

  it('keeps the active shadow control when hit testing is transiently empty', () => {
    const host = document.createElement('md-filled-text-field');
    host.tabIndex = 0;
    const shadowRoot = host.attachShadow({
      mode: 'open',
      delegatesFocus: true,
    });
    const textArea = document.createElement('textarea');
    textArea.tabIndex = 0;
    shadowRoot.append(textArea);
    root.append(host);
    setRect(host, 0, 0);
    setRect(textArea, 0, 0);
    textArea.focus();
    (document.elementFromPoint as jasmine.Spy).and.returnValue(null);

    expect(collectTvFocusable(root)).toContain(textArea);
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

  it('does not steal focus from an active control outside the navigation root', async () => {
    const outside = document.createElement('input');
    const button = document.createElement('button');
    document.body.append(outside);
    root.append(button);
    setRect(button, 0, 0);
    cleanup = installTvNavigation(root);
    outside.focus();

    button.classList.add('changed');
    await navigationSettled();

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('starts from a control already focused before scanning', async () => {
    const first = document.createElement('md-list-item');
    const second = document.createElement('md-list-item');
    first.setAttribute('type', 'button');
    second.setAttribute('type', 'button');
    first.tabIndex = 0;
    second.tabIndex = -1;
    root.append(first, second);
    setRect(first, 0, 0);
    setRect(second, 0, 100);
    await navigationSettled();
    first.focus();

    cleanup = installTvNavigation(root);
    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

    await navigationSettled();

    expect(document.activeElement).toBe(second);
  });

  it('starts from a link focused before scanning', async () => {
    const link = document.createElement('a');
    const button = document.createElement('button');
    link.href = '#test';
    root.append(link, button);
    setRect(link, 0, 0);
    setRect(button, 0, 100);
    link.focus();

    cleanup = installTvNavigation(root);
    link.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

    await navigationSettled();

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
    const modal = document.createElement('div');
    Object.defineProperty(modal, 'localName', {
      configurable: true,
      value: 'md-dialog',
    });
    Object.defineProperty(modal, 'open', {value: true});
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
    modal.append(dialog);
    root.append(modal);
    setRect(textField, 0, 0);
    setRect(confirmButton, 0, 100);
    await navigationSettled();
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
    const modal = document.createElement('div');
    Object.defineProperty(modal, 'localName', {
      configurable: true,
      value: 'md-dialog',
    });
    Object.defineProperty(modal, 'open', {value: true});
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
    modal.append(dialog);
    root.append(modal);
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

  it('routes retargeted Down from the access-key textarea to its action', () => {
    const modal = document.createElement('div');
    Object.defineProperty(modal, 'localName', {
      configurable: true,
      value: 'md-dialog',
    });
    Object.defineProperty(modal, 'open', {value: true});
    const dialog = document.createElement('div');
    Object.defineProperty(dialog, 'localName', {
      configurable: true,
      value: 'add-access-key-dialog',
    });
    const dialogShadowRoot = dialog.attachShadow({mode: 'open'});
    const textField = document.createElement('md-filled-text-field');
    const fieldShadowRoot = textField.attachShadow({mode: 'open'});
    const textArea = document.createElement('textarea');
    const cancelButton = document.createElement('md-text-button');
    textArea.tabIndex = 0;
    cancelButton.tabIndex = 0;
    fieldShadowRoot.append(textArea);
    dialogShadowRoot.append(textField, cancelButton);
    modal.append(dialog);
    root.append(modal);
    setRect(textArea, 0, 0);
    setRect(cancelButton, 0, 100);
    cleanup = installTvNavigation(root);
    textArea.focus();
    const focusCancel = spyOn(cancelButton, 'focus').and.callThrough();

    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: 'ArrowDown',
      })
    );

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

  it('returns focus to the opener after a menu closes', async () => {
    const opener = document.createElement('button');
    const menu = document.createElement('div') as unknown as MenuElement;
    const item = document.createElement('button');
    Object.defineProperty(menu, 'localName', {
      configurable: true,
      value: 'md-menu',
    });
    Object.defineProperty(menu, 'open', {
      configurable: true,
      get: () => menu.hasAttribute('open'),
    });
    menu.close = () => menu.removeAttribute('open');
    menu.append(item);
    root.append(opener, menu);
    setRect(opener, 0, 0);
    setRect(item, 0, 100);
    cleanup = installTvNavigation(root);
    opener.focus();

    menu.setAttribute('open', '');
    item.focus();
    await navigationSettled();

    item.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: 'ArrowLeft',
      })
    );
    await navigationFrameSettled();

    expect(document.activeElement).toBe(opener);
  });

  it('closes an open menu with the Android backbutton', () => {
    const menu = document.createElement('md-menu') as MenuElement;
    const item = document.createElement('button');
    Object.defineProperty(menu, 'items', {
      configurable: true,
      value: [item],
    });
    menu.open = true;
    menu.close = jasmine.createSpy('close');
    menu.append(item);
    root.append(menu);
    setRect(item, 0, 0);
    cleanup = installTvNavigation(root);
    item.focus();

    const event = new Event('backbutton', {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(menu.close).toHaveBeenCalled();
  });

  it('cancels an open dialog with the Android backbutton', () => {
    const dialog = document.createElement('md-dialog');
    Object.defineProperty(dialog, 'open', {value: true});
    const nativeDialog = document.createElement('dialog');
    dialog.attachShadow({mode: 'open'}).append(nativeDialog);
    const cancel = jasmine.createSpy('cancel');
    nativeDialog.addEventListener('cancel', cancel);
    root.append(dialog);
    cleanup = installTvNavigation(root);

    const event = new Event('backbutton', {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(cancel).toHaveBeenCalled();
    expect(cancel.calls.mostRecent().args[0].cancelable).toBeTrue();
  });

  it('closes open root navigation with the Android backbutton', () => {
    const navigation = document.createElement('root-navigation');
    Object.defineProperty(navigation, 'open', {value: true});
    const hideNavigation = jasmine.createSpy('hideNavigation');
    navigation.addEventListener('HideNavigation', hideNavigation);
    root.append(navigation);
    cleanup = installTvNavigation(root);

    const event = new Event('backbutton', {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(hideNavigation).toHaveBeenCalled();
  });

  it('returns focus to the opener after a dialog closes', async () => {
    const opener = document.createElement('button');
    const dialog = document.createElement('div');
    const dialogButton = document.createElement('button');
    Object.defineProperty(dialog, 'localName', {
      configurable: true,
      value: 'md-dialog',
    });
    Object.defineProperty(dialog, 'open', {
      configurable: true,
      get: () => dialog.hasAttribute('open'),
    });
    dialog.append(dialogButton);
    root.append(opener, dialog);
    setRect(opener, 0, 0);
    setRect(dialogButton, 0, 100);
    cleanup = installTvNavigation(root);
    opener.focus();

    dialog.setAttribute('open', '');
    dialogButton.focus();
    await navigationFrameSettled();
    await navigationSettled();

    dialog.removeAttribute('open');
    await navigationFrameSettled();
    await navigationSettled();

    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the page opener after a menu opens a dialog', async () => {
    const opener = document.createElement('button');
    const menu = document.createElement('div') as unknown as MenuElement;
    const menuItem = document.createElement('button');
    const dialog = document.createElement('div');
    const dialogButton = document.createElement('button');
    Object.defineProperty(menu, 'localName', {
      configurable: true,
      value: 'md-menu',
    });
    Object.defineProperty(menu, 'open', {
      configurable: true,
      get: () => menu.hasAttribute('open'),
    });
    Object.defineProperty(dialog, 'localName', {
      configurable: true,
      value: 'md-dialog',
    });
    Object.defineProperty(dialog, 'open', {
      configurable: true,
      get: () => dialog.hasAttribute('open'),
    });
    menu.items = [menuItem];
    menu.close = () => menu.removeAttribute('open');
    menu.append(menuItem);
    dialog.append(dialogButton);
    root.append(opener, menu, dialog);
    setRect(opener, 0, 0);
    setRect(menuItem, 0, 100);
    setRect(dialogButton, 0, 200);
    opener.addEventListener('click', () => {
      menu.setAttribute('open', '');
      menuItem.focus();
    });
    menuItem.addEventListener('click', () => {
      menu.removeAttribute('open');
      dialog.setAttribute('open', '');
      dialogButton.focus();
    });
    cleanup = installTvNavigation(root);
    opener.focus();

    opener.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: 'Enter',
      })
    );
    await navigationFrameSettled();

    menuItem.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: 'Enter',
      })
    );
    await navigationFrameSettled();
    await navigationSettled();

    dialog.removeAttribute('open');
    await navigationFrameSettled();
    await navigationSettled();

    expect(document.activeElement).toBe(opener);
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

  it('focuses the first control in an open overlay', () => {
    const navigation = document.createElement('div');
    Object.defineProperty(navigation, 'localName', {value: 'md-dialog'});
    Object.defineProperty(navigation, 'open', {value: true});
    const button = document.createElement('button');
    navigation.append(button);
    root.append(navigation);
    setRect(button, 0, 0);
    cleanup = installTvNavigation(root);

    expect(document.activeElement).toBe(button);
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
    item.setAttribute('type', 'button');
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

  it('keeps a menu item covered by its sticky header in the registry', () => {
    const navigation = document.createElement('nav');
    const item = document.createElement('button');
    const header = document.createElement('header');
    navigation.append(item, header);
    root.append(navigation);
    setRect(item, 0, 5);
    setRect(header, 0, 0);
    Object.assign(header.style, {height: '20px'});

    expect(collectTvFocusable(root)).toContain(item);
  });

  it('scrolls a focused menu item below its sticky header', () => {
    const navigation = document.createElement('nav');
    const item = document.createElement('button');
    const header = document.createElement('header');
    navigation.append(item, header);
    root.append(navigation);
    setRect(item, 0, 5);
    setRect(header, 0, 0);
    Object.assign(header.style, {height: '20px'});
    spyOn(item, 'focus');
    spyOn(item, 'scrollIntoView');
    let scrollTop = 50;
    Object.defineProperty(navigation, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: value => {
        scrollTop = value;
      },
    });

    cleanup = installTvNavigation(root);

    expect(scrollTop).toBe(35);
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
