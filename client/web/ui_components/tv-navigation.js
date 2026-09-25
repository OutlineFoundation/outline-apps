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

import {
  GetBoundingClientRectAdapter,
  ROOT_FOCUS_KEY,
  SpatialNavigation,
} from '@noriginmedia/norigin-spatial-navigation-core';

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

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = globalThis.getComputedStyle(element);
  const geometricallyVisible =
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden';
  if (!geometricallyVisible) return false;

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (
    x < 0 ||
    y < 0 ||
    x >= globalThis.innerWidth ||
    y >= globalThis.innerHeight
  ) {
    return false;
  }

  let topElement = element.ownerDocument.elementFromPoint(x, y);
  while (topElement?.shadowRoot) {
    const shadowElement = topElement.shadowRoot.elementFromPoint(x, y);
    if (!shadowElement || shadowElement === topElement) break;
    topElement = shadowElement;
  }

  // A null result means that the element is outside the viewport or that it is
  // not rendered. Do not treat it as visible: translated navigation drawers
  // otherwise remain in the focus registry while they are closed.
  return Boolean(topElement && isInComposedSubtree(element, topElement));
}

function hasFocusableShadowDescendant(element, cache) {
  if (!element.shadowRoot) return false;
  if (cache.has(element)) return cache.get(element);

  const visit = root => {
    for (const descendant of root.querySelectorAll('*')) {
      if (
        descendant.matches(FOCUSABLE_SELECTOR) &&
        descendant.tabIndex >= 0 &&
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

function isFocusableForTv(element) {
  // Material list items use a roving tabindex and set every non-selected
  // item to -1. They are still valid D-pad targets when marked as buttons;
  // focus() works on the host and lets the component update its own state.
  return (
    element.tabIndex >= 0 ||
    (element.localName === 'md-list-item' &&
      element.getAttribute('role') === 'button')
  );
}

function getDeepActiveElement(document) {
  let activeElement = document.activeElement;
  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

const OVERLAY_LOCAL_NAMES = new Set([
  'md-dialog',
  'md-menu',
  'root-navigation',
]);

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

function handleMenuKeydown(event) {
  const menu = event
    .composedPath()
    .find(element => element?.localName === 'md-menu');
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

function handleRootNavigationKeydown(event) {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return false;

  const navigation = event
    .composedPath()
    .find(element => element?.localName === 'root-navigation');
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

function collectTvFocusableInternal(
  root,
  result,
  shadowRoots,
  focusableShadowDescendants,
  focusScope
) {
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
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
      element.matches(FOCUSABLE_SELECTOR) &&
      isFocusableForTv(element) &&
      !element.disabled &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !hasFocusableShadowDescendant(element, focusableShadowDescendants) &&
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
  const elements = [...registered.values()];
  return (
    elements.find(element => isInComposedSubtree(element, activeElement)) ??
    event.composedPath().find(element => elements.includes(element))
  );
}

/**
 * Bridges Outline's nested web components to Norigin spatial navigation.
 *
 * @param {Document|DocumentFragment|Element} root
 * @return {() => void} cleanup callback
 */
export function installTvNavigation(root) {
  const eventTarget = root.ownerDocument ?? root;
  const focusKeys = new WeakMap();
  const registered = new Map();
  const observers = new Map();
  let nextFocusKey = 0;
  let scanPending = false;
  let scanFrame = null;
  let disposed = false;

  SpatialNavigation.init({
    distanceCalculationMethod: 'edges',
    layoutAdapter: GetBoundingClientRectAdapter,
    shouldFocusDOMNode: true,
    shouldUseNativeEvents: true,
  });
  // Android remotes can emit keydown and keyup in the same frame. The app
  // owns the capture-phase event handler below, so keep Norigin's registry
  // and navigation engine but disable its global DOM listeners.
  SpatialNavigation.unbindEventHandlers();

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
    collectTvFocusableInternal(
      root,
      elements,
      shadowRoots,
      new WeakMap(),
      focusScope
    );
    const visible = new Set(elements);

    const liveObservedRoots = new Set([root, ...shadowRoots]);
    for (const [observedRoot, observer] of observers) {
      if (liveObservedRoots.has(observedRoot)) continue;
      observer.disconnect();
      observers.delete(observedRoot);
    }
    observe(root);
    for (const shadowRoot of shadowRoots) observe(shadowRoot);

    for (const [focusKey, element] of registered) {
      if (visible.has(element)) continue;
      SpatialNavigation.removeFocusable({focusKey});
      registered.delete(focusKey);
    }

    for (const element of elements) {
      let focusKey = focusKeys.get(element);
      if (focusKey && registered.has(focusKey)) continue;

      focusKey ??= `outline-tv-${++nextFocusKey}`;
      focusKeys.set(element, focusKey);
      registered.set(focusKey, element);
      SpatialNavigation.addFocusable({
        focusKey,
        node: element,
        parentFocusKey: ROOT_FOCUS_KEY,
        onEnterPress: () => element.click(),
        onEnterRelease: () => {},
        onArrowPress: direction =>
          !isTextEntry(element) ||
          (direction !== 'left' && direction !== 'right'),
        onArrowRelease: () => {},
        onFocus: () => {},
        onBlur: () => {},
        onUpdateFocus: () => {},
        onUpdateHasFocusedChild: () => {},
        saveLastFocusedChild: false,
        trackChildren: false,
        autoRestoreFocus: false,
        forceFocus: true,
        focusable: true,
        isFocusBoundary: false,
      });
    }

    void SpatialNavigation.updateAllLayouts();

    const activeElement = getDeepActiveElement(eventTarget);
    const hasActiveFocusable = elements.some(element =>
      isInComposedSubtree(element, activeElement)
    );
    // Material menus and dialogs move focus asynchronously after opening. Do
    // not steal that focus back to the first page control while the overlay is
    // settling, even if its internal control is not yet in our focus registry.
    if (!hasActiveFocusable && !focusScope) {
      elements[0]?.focus();
    }
  };

  const handleFocus = event => {
    const focusKey = event
      .composedPath()
      .map(element => focusKeys.get(element))
      .find(Boolean);
    if (focusKey && SpatialNavigation.getCurrentFocusKey() !== focusKey) {
      SpatialNavigation.setCurrentFocusedKey(focusKey, {event});
    }
  };

  const handleKeydown = async event => {
    // Android WebView key events often have an empty `code`, while Material
    // Web's menu handlers depend on it. Handle menu navigation from `key` so
    // the D-pad can move, select, and dismiss menu items reliably.
    if (handleMenuKeydown(event)) return;
    if (handleRootNavigationKeydown(event)) return;

    const activeElement = getDeepActiveElement(eventTarget);
    const activeFocusable = getActiveFocusable(
      registered,
      activeElement,
      event
    );
    if (handleActivationKeydown(event, activeFocusable, activeElement)) return;

    const direction = DIRECTION_BY_KEY[event.key];
    if (!direction) return;

    // The access-key dialog owns the vertical transition from its Material
    // textarea to the action buttons. Let that component's handler run before
    // the global spatial route (the listener below is installed in capture
    // phase).
    if (
      direction === 'down' &&
      event
        .composedPath()
        .some(element => element.localName === 'md-filled-text-field')
    ) {
      return;
    }

    const textEntry = [activeElement, ...event.composedPath()].find(
      isTextEntry
    );
    if (textEntry && (direction === 'left' || direction === 'right')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Use one deterministic geometry route for DOM controls. Norigin still
    // owns the focus registry and provides a fallback for components that do
    // not expose a usable bounding box.
    const next = findNext([...registered.values()], activeFocusable, direction);
    if (next) {
      next.focus();
      return;
    }
    await SpatialNavigation.navigateByDirection(direction, {event});
  };

  scan();
  scheduleScan();
  eventTarget.addEventListener('focusin', handleFocus, true);
  eventTarget.addEventListener('keydown', handleKeydown, true);

  return () => {
    if (disposed) return;
    disposed = true;
    eventTarget.removeEventListener('focusin', handleFocus, true);
    eventTarget.removeEventListener('keydown', handleKeydown, true);
    if (scanFrame !== null) {
      globalThis.cancelAnimationFrame(scanFrame);
      scanFrame = null;
    }
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
    SpatialNavigation.destroy();
  };
}
