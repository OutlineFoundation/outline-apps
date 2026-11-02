/*
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {css} from 'lit';

type FocusRingShape = 'corner' | 'circle';

const focusRingShapes = {
  none: css``,
  corner: css`
    border-radius: var(--outline-corner);
  `,
  circle: css`
    border-radius: 50%;
  `,
};

export function focusRing({
  offset,
  shape,
}: {
  offset: number;
  shape?: FocusRingShape;
}) {
  return css`
    ${focusRingShapes[shape ?? 'none']}
    outline: 4px solid var(--outline-primary);
    outline-offset: ${offset}px;
  `;
}
