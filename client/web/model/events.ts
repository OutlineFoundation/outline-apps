// Copyright 2018 The Outline Authors
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

import {Server} from './server';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OutlineEvent {}

export type OutlineEventListener<T extends OutlineEvent> = (event: T) => void;

export class ServerAdded implements OutlineEvent {
  constructor(readonly server: Server) {}
}

export class ServerForgotten implements OutlineEvent {
  constructor(readonly server: Server) {}
}

export class ServerForgetUndone implements OutlineEvent {
  constructor(readonly server: Server) {}
}

export class ServerRenamed implements OutlineEvent {
  constructor(readonly server: Server) {}
}

export class ServerConnected implements OutlineEvent {
  constructor(readonly serverId: string) {}
}

export class ServerDisconnecting implements OutlineEvent {
  constructor(readonly serverId: string) {}
}

export class ServerDisconnected implements OutlineEvent {
  constructor(readonly serverId: string) {}
}

export class ServerReconnecting implements OutlineEvent {
  constructor(readonly serverId: string) {}
}

// Simple publisher-subscriber queue.
export class EventQueue {
  private queuedEvents: OutlineEvent[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listenersByEventType = new Map<Function, any[]>();
  private isStarted = false;
  private isPublishing = false;

  startPublishing() {
    this.isStarted = true;
    this.publishQueuedEvents();
  }

  // Registers a listener for events of the type of the given constructor.
  subscribe<T extends OutlineEvent>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventConstructor: {new (...args: any[]): T},
    listener: OutlineEventListener<T>
  ): void {
    let listeners = this.listenersByEventType.get(eventConstructor);
    if (!listeners) {
      listeners = [];
      this.listenersByEventType.set(eventConstructor, listeners);
    }
    listeners.push(listener);
  }

  // Enqueues the given event for publishing and publishes all queued events if
  // publishing is not already happening.
  //
  // The enqueue method is reentrant: it may be called by an event listener
  // during the publishing of the events. In that case the method adds the event
  // to the end of the queue and returns immediately.
  //
  // This guarantees that events are published and handled in the order that
  // they are queued.
  //
  // There's no guarantee that the subscribers for the event have been called by
  // the time this function returns.
  enqueue(event: OutlineEvent) {
    this.queuedEvents.push(event);
    if (this.isStarted) {
      this.publishQueuedEvents();
    }
  }

  // Triggers the subscribers for all the enqueued events.
  private publishQueuedEvents() {
    if (this.isPublishing) return;
    this.isPublishing = true;
    while (this.queuedEvents.length > 0) {
      const event = this.queuedEvents.shift() as OutlineEvent;
      // The 'new' operator assigns a property to the new object that links to
      // the constructor function's prototype object. Therefore, events created
      // via the 'new' operator will have the event specific constructor, which
      // is used to look up registered listeners.
      const listeners = this.listenersByEventType.get(event.constructor);
      if (!listeners) {
        console.warn('Dropping event with no listeners:', event);
        continue;
      }
      for (const listener of listeners) {
        listener(event);
      }
    }
    this.isPublishing = false;
  }
}
