/*
  Copyright 2021 The Outline Authors
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

import {html, css, LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';

// TODO(daniellacosse): fix webpack copy such that we can co-locate this image asset with this folder
import circle from '../../../assets/circle.png';

export const SERVER_CONNECTION_INDICATOR_DURATION_MS = 1750;
export const SERVER_CONNECTION_INDICATOR_DELAY_MS = 500;

export enum ServerConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
}

const CIRCLE_SIZES = [css`large`, css`medium`, css`small`];

@customElement('server-connection-indicator')
export class ServerConnectionIndicator extends LitElement {
  @property({attribute: 'connection-state'})
  connectionState: ServerConnectionState;

  @property({type: Boolean, reflect: true})
  darkMode: boolean;

  @state() private animationState: ServerConnectionState =
    ServerConnectionState.DISCONNECTED;
  private animationStartMS: number;

  static styles = [
    css`
      :host {
        height: 100%;
        outline: 0;
        position: relative;
        display: inline-block;
        aspect-ratio: 1;

        --duration: ${SERVER_CONNECTION_INDICATOR_DURATION_MS}ms;
        --timing-function: ease-out;

        --circle-large-scale: scale(1);
        --circle-large-delay: ${SERVER_CONNECTION_INDICATOR_DELAY_MS}ms;

        --circle-medium-scale: scale(0.66);
        --circle-medium-delay: ${SERVER_CONNECTION_INDICATOR_DELAY_MS / 2}ms;

        --circle-small-scale: scale(0.33);
        --circle-small-delay: 0ms;

        --circle-connected-opacity: 1;
        --circle-connected-color: grayscale(0);

        --circle-disconnected-opacity: 1;
        --circle-disconnected-color: grayscale(1);
      }

      :host([darkMode]) {
        --circle-connected-color: grayscale(0) brightness(1);
        --circle-disconnected-color: grayscale(1) brightness(0.5);
      }

      .circle {
        display: inline-block;

        /* 
          setting translate3d can have weird behavior on certain platforms, so 
          hiding the element backface becomes necessary - 
          https://developer.mozilla.org/en-US/docs/Web/CSS/backface-visibility 
        */
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;

        transition-property: transform, filter, opacity;
        transition-duration: var(--duration);
        transition-timing-function: var(--timing-function);

        animation-duration: var(--duration);
        animation-timing-function: var(--timing-function);
        animation-iteration-count: infinite;
        -webkit-animation-duration: var(--duration);
        -webkit-animation-timing-function: var(--timing-function);
        -webkit-animation-iteration-count: infinite;
      }

      /* 
        these are not applied to circle-large so that 
        that image can drive the implicit width 
      */
      .circle-medium,
      .circle-small {
        left: 0;
        outline: 0;
        position: absolute;
        top: 0;
      }

      .circle-connected,
      .circle-reconnecting,
      .circle-disconnecting {
        opacity: var(--circle-connected-opacity);
        filter: var(--circle-connected-color);
        -webkit-filter: var(--circle-connected-color);
      }

      .circle-disconnected,
      .circle-connecting {
        opacity: var(--circle-disconnected-opacity);
        filter: var(--circle-disconnected-color);
        -webkit-filter: var(--circle-disconnected-color);
      }

      .circle-disconnecting {
        animation-direction: reverse;
        --timing-function: ease-in;
      }
    `,
    ...CIRCLE_SIZES.map(
      /* prettier-ignore */
      circleSize => css`
        .circle-${circleSize} {
          transform: translate3d(0, 0, 0) var(--circle-${circleSize}-scale);
          animation-delay: var(--circle-${circleSize}-delay);
        }

        .circle-${circleSize}.circle-connecting,
        .circle-${circleSize}.circle-reconnecting,
        .circle-${circleSize}.circle-disconnecting {
          animation-name: circle-${circleSize}-rotate-with-pause;
        }

        /* Do not mirror animation for RTL languages */
        /* rtl:begin:ignore */
        @keyframes circle-${circleSize}-rotate-with-pause {
          0% {
            transform: translate3d(0, 0, 0) rotate(0deg) var(--circle-${circleSize}-scale);
          }
          60%,
          100% {
            transform: translate3d(0, 0, 0) rotate(360deg) var(--circle-${circleSize}-scale);
          }
        }
        /* rtl:end:ignore */
      `
    ),
  ];

  willUpdate(
    changedProperties: Map<
      keyof ServerConnectionIndicator,
      ServerConnectionState
    >
  ) {
    if (!changedProperties.has('connectionState')) {
      return;
    }

    if (this.isAnimationState(this.connectionState)) {
      // start the animation and the animation timer
      this.animationStartMS = Date.now();

      this.animationState = this.connectionState;
    } else if (this.isAnimationState(this.animationState)) {
      // schedule the end of the animation
      // based on when the animation loop started
      const elapsedAnimationMS = Date.now() - this.animationStartMS;

      // While the animation is reversed, the animation delay
      // is included in the total play time.
      const animationDurationMS =
        this.animationState === ServerConnectionState.DISCONNECTING
          ? SERVER_CONNECTION_INDICATOR_DURATION_MS +
            SERVER_CONNECTION_INDICATOR_DELAY_MS
          : SERVER_CONNECTION_INDICATOR_DURATION_MS;

      const remainingAnimationMS =
        animationDurationMS - (elapsedAnimationMS % animationDurationMS);

      setTimeout(
        () => (this.animationState = this.connectionState),
        remainingAnimationMS
      );
    } else {
      this.animationState = this.connectionState;
    }
  }

  render() {
    return html`
      ${CIRCLE_SIZES.map(
        circleSize => html`
          <img
            class="circle circle-${circleSize} circle-${this.animationState}"
            src="${circle}"
            height="100%"
            draggable="false"
          />
        `
      )}
    `;
  }

  private isAnimationState(state: ServerConnectionState): boolean {
    return [
      ServerConnectionState.CONNECTING,
      ServerConnectionState.RECONNECTING,
      ServerConnectionState.DISCONNECTING,
    ].includes(state);
  }
}
