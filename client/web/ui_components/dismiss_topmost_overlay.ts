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

interface OpenableMenu extends Element {
  open: boolean;
  close(): void;
}

interface OpenableDialog extends Element {
  open: boolean;
  close(): Promise<void>;
}

/**
 * Dismisses the topmost open Material menu or dialog under `root`, searching
 * through shadow roots. Returns whether there was one to dismiss.
 *
 * Menus come first: a menu is drawn above everything else, including a dialog
 * that hosts it (such as the select menu in the DNS dialog). Among several open
 * overlays of a kind, the most deeply nested one is dismissed.
 *
 * A dialog is canceled the way a click on its scrim cancels it: a cancelable
 * `cancel` event, then `close()` unless a listener prevented the event.
 * Listeners that prevent it either close the dialog themselves (the add access
 * key dialog) or keep it open because it must not be dismissed (the privacy
 * acknowledgement). Either way the dialog has handled the request.
 */
export function dismissTopmostOverlay(root: ParentNode): boolean {
  const menus: OpenableMenu[] = [];
  const dialogs: OpenableDialog[] = [];
  collectOpenOverlays(root, menus, dialogs);

  if (menus.length > 0) {
    menus[menus.length - 1].close();
    return true;
  }

  if (dialogs.length > 0) {
    const dialog = dialogs[dialogs.length - 1];
    if (dialog.dispatchEvent(new Event('cancel', {cancelable: true}))) {
      void dialog.close();
    }
    return true;
  }

  return false;
}

// Collects open overlays in document order, descending into each element's
// shadow root right after the element, so nested overlays come after their
// hosts.
function collectOpenOverlays(
  root: ParentNode,
  menus: OpenableMenu[],
  dialogs: OpenableDialog[]
) {
  for (const element of root.querySelectorAll('*')) {
    if (element.localName === 'md-menu' && (element as OpenableMenu).open) {
      menus.push(element as OpenableMenu);
    } else if (
      element.localName === 'md-dialog' &&
      (element as OpenableDialog).open
    ) {
      dialogs.push(element as OpenableDialog);
    }
    if (element.shadowRoot) {
      collectOpenOverlays(element.shadowRoot, menus, dialogs);
    }
  }
}
