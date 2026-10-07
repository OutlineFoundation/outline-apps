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

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]',
].join(',');

const DIRECTION_BY_KEY = {
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
};

const VECTOR_BY_DIRECTION = {
  down: {x: 0, y: 1},
  left: {x: -1, y: 0},
  right: {x: 1, y: 0},
  up: {x: 0, y: -1},
};

const NAVIGATION_SCROLL_PADDING = 8;

function isTextEntry(element) {
  const localName = element?.localName;
  return (
    localName === 'input' ||
    localName === 'textarea' ||
    localName === 'select' ||
    element instanceof globalThis.HTMLInputElement ||
    element instanceof globalThis.HTMLTextAreaElement ||
    element instanceof globalThis.HTMLSelectElement ||
    element?.isContentEditable
  );
}

function isEditableTextEntry(element) {
  const localName = element?.localName;
  if (
    localName === 'textarea' ||
    localName === 'contenteditable' ||
    element instanceof globalThis.HTMLTextAreaElement ||
    element?.isContentEditable
  ) {
    return true;
  }
  if (
    localName !== 'input' &&
    !(element instanceof globalThis.HTMLInputElement)
  ) {
    return false;
  }
  return ![
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ].includes(element.type);
}

function findNext(elements, current, direction) {
  if (!current) return undefined;

  const currentRect = current.getBoundingClientRect();
  const origin = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };
  const vector = VECTOR_BY_DIRECTION[direction];
  let best;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of elements) {
    if (candidate === current) continue;
    const rect = candidate.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - origin.x;
    const dy = rect.top + rect.height / 2 - origin.y;
    const primary = dx * vector.x + dy * vector.y;
    if (primary <= 0) continue;

    const secondary = Math.abs(dx * vector.y - dy * vector.x);
    // Prefer controls in the requested half-plane, then minimize the
    // perpendicular distance. This keeps a nearby diagonal control ahead of
    // a distant control that happens to be perfectly aligned.
    const score = primary + secondary * 2;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function isInComposedSubtree(root, target) {
  let current = target;
  while (current) {
    if (current === root || root.contains(current)) return true;
    current =
      current.parentNode ??
      current.host ??
      current.getRootNode?.().host ??
      null;
  }
  return false;
}

function findComposedAncestor(target, localName) {
  let current = target;
  while (current) {
    if (current.localName === localName) return current;
    current =
      current.parentNode ??
      current.host ??
      current.getRootNode?.().host ??
      null;
  }
  return undefined;
}

function isCoveredByNavigationHeader(element, target) {
  const navigation = element.closest?.('nav');
  const header = navigation?.querySelector('header');
  return Boolean(header && isInComposedSubtree(header, target));
}

const OVERLAY_LOCAL_NAMES = new Set([
  'md-dialog',
  'md-menu',
  'root-navigation',
]);

function isHidden(element) {
  let current = element;
  while (current) {
    if (
      current.hidden ||
      current.getAttribute?.('aria-hidden') === 'true' ||
      (OVERLAY_LOCAL_NAMES.has(current.localName) && !current.open)
    ) {
      return true;
    }

    if (current.nodeType === 1) {
      const style = globalThis.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return true;
      }
    }

    current =
      current.parentNode ??
      current.host ??
      current.getRootNode?.().host ??
      null;
  }
  return false;
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = globalThis.getComputedStyle(element);
  const geometricallyVisible =
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden';
  if (!geometricallyVisible || isHidden(element)) return false;

  // WebViews can transiently return the outer app host (or null) from
  // elementFromPoint while focus is moving into a shadow tree. Keep the
  // active control registered based on its actual composed focus chain.
  const activeElement = getDeepActiveElement(element.ownerDocument);
  if (
    activeElement &&
    (isInComposedSubtree(element, activeElement) ||
      isInComposedSubtree(activeElement, element))
  ) {
    return true;
  }

  // A focusable control can be outside the viewport because its scrollable
  // ancestor has not been scrolled to it yet. Keep it in the registry so the
  // next D-pad press can reach it. Closed overlays are filtered above, so this
  // does not bring translated navigation drawers or dialogs back into focus.
  const inViewport =
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < globalThis.innerWidth &&
    rect.top < globalThis.innerHeight;
  if (!inViewport) return true;

  const x = Math.min(
    Math.max(rect.left + rect.width / 2, 0),
    globalThis.innerWidth - 1
  );
  const y = Math.min(
    Math.max(rect.top + rect.height / 2, 0),
    globalThis.innerHeight - 1
  );

  let topElement = element.ownerDocument.elementFromPoint(x, y);
  while (topElement?.shadowRoot) {
    const shadowElement = topElement.shadowRoot.elementFromPoint(x, y);
    if (!shadowElement || shadowElement === topElement) break;
    topElement = shadowElement;
  }

  // A null result means that the element is not rendered at the point where it
  // is visible. Do not treat it as visible when another element covers it.
  return Boolean(
    topElement &&
      (isInComposedSubtree(element, topElement) ||
        isInComposedSubtree(topElement, element) ||
        isCoveredByNavigationHeader(element, topElement))
  );
}

function hasFocusableShadowDescendant(element, cache) {
  if (!element.shadowRoot) return false;
  if (cache.has(element)) return cache.get(element);

  const visit = root => {
    for (const descendant of root.querySelectorAll('*')) {
      if (
        (isButtonListItem(descendant) ||
          descendant.matches(FOCUSABLE_SELECTOR)) &&
        isFocusableForTv(descendant) &&
        !descendant.disabled &&
        descendant.getAttribute('aria-hidden') !== 'true'
      ) {
        return true;
      }
      if (
        descendant.shadowRoot &&
        hasFocusableShadowDescendant(descendant, cache)
      ) {
        return true;
      }
    }
    return false;
  };

  const result = visit(element.shadowRoot);
  cache.set(element, result);
  return result;
}

function isButtonListItem(element) {
  return (
    element.localName === 'md-list-item' &&
    (element.getAttribute('type') === 'button' ||
      element.getAttribute('role') === 'button')
  );
}

function isFocusableForTv(element) {
  // Material list items use a roving tabindex and set every non-selected
  // item to -1. They are still valid D-pad targets when marked as buttons;
  // focus() works on the host and lets the component update its own state.
  return element.tabIndex >= 0 || isButtonListItem(element);
}

function getDeepActiveElement(document) {
  let activeElement = document.activeElement;
  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

function collectOpenOverlays(root, result = []) {
  for (const element of root.querySelectorAll('*')) {
    if (OVERLAY_LOCAL_NAMES.has(element.localName) && element.open) {
      result.push(element);
    }
    if (element.shadowRoot) {
      collectOpenOverlays(element.shadowRoot, result);
    }
  }
  return result;
}

function getFocusScope(root) {
  const overlays = collectOpenOverlays(root);
  // A menu is the most restrictive scope. It can be opened from a dialog or
  // a server card, and the controls behind it must not receive focus.
  return (
    overlays.find(element => element.localName === 'md-menu') ??
    overlays.find(element => element.localName === 'md-dialog') ??
    overlays.find(element => element.localName === 'root-navigation')
  );
}

function handleMenuKeydown(event, activeElement) {
  const menu =
    event.composedPath().find(element => element?.localName === 'md-menu') ??
    findComposedAncestor(activeElement, 'md-menu');
  if (!menu?.open) return false;

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault();
      event.stopPropagation();

      // Material Web uses a focusout handler which can close a menu when an
      // Android WebView reports a null relatedTarget. Keep it open only while
      // moving focus between its items, then restore the normal behavior.
      const previousStayOpenOnFocusout = menu.stayOpenOnFocusout;
      menu.stayOpenOnFocusout = true;
      if (event.key === 'ArrowDown') {
        menu.activateNextItem?.();
      } else {
        menu.activatePreviousItem?.();
      }
      menu.stayOpenOnFocusout = previousStayOpenOnFocusout;
      return true;
    }
    case 'Enter':
    case ' ':
    case 'Spacebar': {
      event.preventDefault();
      event.stopPropagation();
      const activeItem = menu.items?.find(item => item.tabIndex === 0);
      activeItem?.click();
      return true;
    }
    case 'ArrowLeft':
    case 'Escape':
      event.preventDefault();
      event.stopPropagation();
      menu.close?.();
      return true;
    default:
      return false;
  }
}

function handleRootNavigationKeydown(event, activeElement) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return false;

  const navigation =
    event
      .composedPath()
      .find(element => element?.localName === 'root-navigation') ??
    findComposedAncestor(activeElement, 'root-navigation');
  if (!navigation?.open) return false;

  const exitKey = navigation.align === 'right' ? 'ArrowLeft' : 'ArrowRight';
  if (event.key !== exitKey) return false;

  event.preventDefault();
  event.stopPropagation();
  navigation.dispatchEvent(
    new globalThis.CustomEvent('HideNavigation', {
      bubbles: true,
      composed: true,
    })
  );
  return true;
}

function handleBackbutton(event, root) {
  const overlays = collectOpenOverlays(root);
  const menu = overlays.find(element => element.localName === 'md-menu');
  const dialog = overlays.find(element => element.localName === 'md-dialog');
  const navigation = overlays.find(
    element => element.localName === 'root-navigation'
  );
  if (!menu && !dialog && !navigation) return;

  event.preventDefault();
  event.stopPropagation();
  if (menu) {
    menu.close?.();
  } else if (dialog) {
    // Dispatch cancel on the native dialog so Material can redispatch it to
    // the host and preserve each dialog's existing cancellation behavior.
    const nativeDialog = dialog.shadowRoot?.querySelector('dialog');
    if (nativeDialog) {
      nativeDialog.dispatchEvent(
        new globalThis.Event('cancel', {cancelable: true})
      );
    } else {
      dialog.close?.();
    }
  } else {
    navigation.dispatchEvent(
      new globalThis.CustomEvent('HideNavigation', {
        bubbles: true,
        composed: true,
      })
    );
  }
}

function handleAccessKeyDialogKeydown(event, activeElement) {
  if (event.key !== 'ArrowDown') return false;

  const path = event.composedPath();
  const textField =
    path.find(element => element?.localName === 'md-filled-text-field') ??
    findComposedAncestor(activeElement, 'md-filled-text-field');
  if (!textField) {
    return false;
  }

  const dialog =
    path.find(element => element?.localName === 'add-access-key-dialog') ??
    findComposedAncestor(activeElement, 'add-access-key-dialog');
  const dialogShadowRoot = dialog?.shadowRoot;
  if (!dialogShadowRoot) return false;

  const confirmButton = dialogShadowRoot.querySelector('md-filled-button');
  const target = confirmButton?.disabled
    ? dialogShadowRoot.querySelector('md-text-button')
    : confirmButton;
  if (!target) return false;

  event.preventDefault();
  event.stopPropagation();
  focusElement(target, true);
  return true;
}

function handleActivationKeydown(event, activeFocusable, activeElement) {
  if (!['Enter', ' ', 'Spacebar'].includes(event.key)) return false;
  if (
    !activeFocusable ||
    [activeElement, ...event.composedPath()].some(isEditableTextEntry)
  ) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  activeFocusable.click();
  return true;
}

function focusElement(element, forceHost = false) {
  element.focus();
  const document = element.ownerDocument;
  if (
    document &&
    (forceHost || isButtonListItem(element)) &&
    !isInComposedSubtree(element, getDeepActiveElement(document))
  ) {
    // Some Material hosts call focus() on a shadow control that may not have
    // rendered yet. Focusing the host keeps the D-pad position stable until
    // the component finishes rendering.
    const previousTabIndex = element.getAttribute('tabindex');
    if (element.tabIndex < 0) element.setAttribute('tabindex', '0');
    globalThis.HTMLElement.prototype.focus.call(element);
    if (previousTabIndex === null) {
      element.removeAttribute('tabindex');
    } else {
      element.setAttribute('tabindex', previousTabIndex);
    }
  }
  scrollElementIntoView(element);
}

function scrollElementIntoView(element) {
  if (!element) return;
  element.scrollIntoView?.({block: 'nearest', inline: 'nearest'});

  const navigation = element.closest?.('nav');
  if (!navigation) return;

  const navigationRect = navigation.getBoundingClientRect();
  const hasNavigationRect = navigationRect.bottom > navigationRect.top;
  const navigationTop = hasNavigationRect ? navigationRect.top : 0;
  const navigationBottom = hasNavigationRect
    ? Math.min(navigationRect.bottom, globalThis.innerHeight)
    : globalThis.innerHeight;
  let elementRect = element.getBoundingClientRect();
  if (
    elementRect.top < navigationTop + NAVIGATION_SCROLL_PADDING ||
    elementRect.bottom > navigationBottom - NAVIGATION_SCROLL_PADDING
  ) {
    // `nearest` can leave a drawer item flush against the scrollport edge.
    // Leave a small margin so focus outlines and remote focus indicators are
    // not clipped by the WebView viewport.
    element.scrollIntoView?.({block: 'center', inline: 'nearest'});
    elementRect = element.getBoundingClientRect();
  }

  const header = navigation?.querySelector('header');
  if (!header) return;

  const headerRect = header.getBoundingClientRect();
  if (
    elementRect.top < headerRect.bottom &&
    elementRect.bottom > headerRect.top
  ) {
    element.scrollIntoView?.({block: 'center', inline: 'nearest'});
    elementRect = element.getBoundingClientRect();
    if (elementRect.top < headerRect.bottom) {
      const overlap = headerRect.bottom - elementRect.top;
      navigation.scrollTop = Math.max(0, navigation.scrollTop - overlap);
    }
  }
}

function collectTvFocusableInternal(
  root,
  result,
  shadowRoots,
  focusableShadowDescendants,
  focusScope
) {
  for (const element of root.querySelectorAll('*')) {
    const isButtonItem = isButtonListItem(element);
    if (element.shadowRoot && !isButtonItem) {
      shadowRoots.push(element.shadowRoot);
      collectTvFocusableInternal(
        element.shadowRoot,
        result,
        shadowRoots,
        focusableShadowDescendants,
        focusScope
      );
    }
    if (
      (!focusScope || isInComposedSubtree(focusScope, element)) &&
      (isButtonItem || element.matches(FOCUSABLE_SELECTOR)) &&
      isFocusableForTv(element) &&
      !element.disabled &&
      element.getAttribute('aria-hidden') !== 'true' &&
      (isButtonItem ||
        !hasFocusableShadowDescendant(element, focusableShadowDescendants)) &&
      isVisible(element)
    ) {
      result.push(element);
    }
  }
}

export function collectTvFocusable(root, result = [], shadowRoots = []) {
  const focusScope = getFocusScope(root);
  collectTvFocusableInternal(
    root,
    result,
    shadowRoots,
    new WeakMap(),
    focusScope
  );
  return result;
}

function getActiveFocusable(registered, activeElement, event) {
  const elements = [...registered];
  return (
    elements.find(element => isInComposedSubtree(element, activeElement)) ??
    event?.composedPath?.().find(element => elements.includes(element))
  );
}

/**
 * Adds spatial navigation for Outline's nested web components.
 *
 * @param {Document|DocumentFragment|Element} root
 * @return {() => void} cleanup callback
 */
export function installTvNavigation(root) {
  const eventTarget = root.ownerDocument ?? root;
  const registered = new Set();
  const observers = new Map();
  let previousFocusScope = null;
  let focusReturnElement;
  let pendingFocusReturnElement;
  let lastFocusedElement;
  let scanPending = false;
  let scanFrame = null;
  let disposed = false;

  const scheduleScan = () => {
    if (scanPending || disposed) return;
    scanPending = true;
    scanFrame = globalThis.requestAnimationFrame(() => {
      scanFrame = null;
      scanPending = false;
      if (disposed) return;
      scan();
    });
  };

  const observe = observedRoot => {
    if (disposed || observers.has(observedRoot)) return;
    const observer = new globalThis.MutationObserver(scheduleScan);
    observer.observe(observedRoot, {
      attributes: true,
      attributeFilter: [
        'aria-hidden',
        'aria-selected',
        'class',
        'disabled',
        'hidden',
        'open',
        'role',
        'style',
        'tabindex',
      ],
      childList: true,
      subtree: true,
    });
    observers.set(observedRoot, observer);
  };

  const scan = () => {
    if (disposed) return;
    const shadowRoots = [];
    const elements = [];
    const focusScope = getFocusScope(root);
    const focusScopeChanged = focusScope !== previousFocusScope;
    const shouldRestoreFocus = focusScopeChanged && !focusScope;

    if (focusScopeChanged && focusScope) {
      // Keep the control that opened the first overlay so closing a menu or
      // dialog does not leave focus on a hidden overlay item. A menu can close
      // while opening a dialog; preserve the original page opener in that
      // case. Menus opened from a dialog should instead return to the dialog
      // control that opened them.
      if (
        !previousFocusScope ||
        (focusScope.localName === 'md-menu' &&
          previousFocusScope.localName === 'md-dialog')
      ) {
        focusReturnElement = pendingFocusReturnElement ?? lastFocusedElement;
      }
      pendingFocusReturnElement = undefined;
    }

    collectTvFocusableInternal(
      root,
      elements,
      shadowRoots,
      new WeakMap(),
      focusScope
    );
    const liveObservedRoots = new Set([root, ...shadowRoots]);
    for (const [observedRoot, observer] of observers) {
      if (liveObservedRoots.has(observedRoot)) continue;
      observer.disconnect();
      observers.delete(observedRoot);
    }
    observe(root);
    for (const shadowRoot of shadowRoots) observe(shadowRoot);

    registered.clear();
    for (const element of elements) registered.add(element);

    const activeElement = getDeepActiveElement(eventTarget);
    const activeElementIsDocument =
      !activeElement ||
      activeElement === eventTarget.body ||
      activeElement === eventTarget.documentElement;
    const activeElementOutsideScope =
      focusScope && !isInComposedSubtree(focusScope, activeElement);
    let activeFocusable = elements.find(element =>
      isInComposedSubtree(element, activeElement)
    );
    // Material menus and dialogs move focus asynchronously after opening. If
    // the browser has not focused an overlay control yet, focus its first
    // registered control instead of leaving focus on a hidden page control.
    // Otherwise, leave an unrelated active control alone during a scan.
    if (
      !activeFocusable &&
      elements[0] &&
      (focusScopeChanged ||
        activeElementIsDocument ||
        activeElementOutsideScope)
    ) {
      const returnElement =
        shouldRestoreFocus && elements.includes(focusReturnElement)
          ? focusReturnElement
          : elements[0];
      focusElement(returnElement);
      activeFocusable = returnElement;
    }

    previousFocusScope = focusScope;
    if (shouldRestoreFocus) focusReturnElement = undefined;
    if (!focusScope && !focusScopeChanged) {
      pendingFocusReturnElement = undefined;
    }
  };

  const handleFocus = event => {
    const activeElement = getDeepActiveElement(eventTarget);
    const element = getActiveFocusable(registered, activeElement, event);
    if (!element) return;

    lastFocusedElement = element;
    scrollElementIntoView(element);
  };

  const handleKeydown = event => {
    const activeElement = getDeepActiveElement(eventTarget);
    const activeFocusable = getActiveFocusable(
      registered,
      activeElement,
      event
    );
    if (
      activeFocusable &&
      ['Enter', ' ', 'Spacebar'].includes(event.key) &&
      ![activeElement, ...event.composedPath()].some(isEditableTextEntry)
    ) {
      // Capture the opener before Material moves focus into a menu or dialog.
      // The first scan after that move may otherwise observe the overlay item
      // as the last focused control and lose the page opener.
      pendingFocusReturnElement = activeFocusable;
    }

    // Android WebView key events often have an empty `code`, while Material
    // Web's menu handlers depend on it. Handle menu navigation from `key` so
    // the D-pad can move, select, and dismiss menu items reliably.
    if (handleMenuKeydown(event, activeElement)) return;
    if (handleRootNavigationKeydown(event, activeElement)) return;
    if (handleAccessKeyDialogKeydown(event, activeElement)) return;

    if (handleActivationKeydown(event, activeFocusable, activeElement)) return;

    const direction = DIRECTION_BY_KEY[event.key];
    if (!direction) return;

    const textEntry = [activeElement, ...event.composedPath()].find(
      isTextEntry
    );
    if (textEntry && (direction === 'left' || direction === 'right')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const next = findNext([...registered], activeFocusable, direction);
    if (next) focusElement(next);
  };

  eventTarget.addEventListener('focusin', handleFocus, true);
  eventTarget.addEventListener('keydown', handleKeydown, true);
  const handleBackbuttonEvent = event => handleBackbutton(event, root);
  eventTarget.addEventListener('backbutton', handleBackbuttonEvent, true);
  scan();
  scheduleScan();

  return () => {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener('focusin', handleFocus, true);
    eventTarget.removeEventListener('keydown', handleKeydown, true);
    eventTarget.removeEventListener('backbutton', handleBackbuttonEvent, true);
    if (scanFrame !== null) {
      globalThis.cancelAnimationFrame(scanFrame);
      scanFrame = null;
    }
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
    registered.clear();
  };
}
