// Copyright 2020 The Outline Authors
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
  EventQueue,
  ServerAdded,
  ServerConnected,
  ServerDisconnected,
  ServerForgetUndone,
  ServerForgotten,
  ServerReconnecting,
  ServerRenamed,
} from './events';

describe('EventQueue', () => {
  it('subscribe registers listeners to corresponding event', () => {
    let serverAddedCount = 0;
    let serverForgottenCount = 0;
    let serverRenamedCount = 0;
    let serverForgetUndoneCount = 0;
    let serverConnectedCount = 0;
    let serverDisconnectedCount = 0;

    const queue = new EventQueue();
    queue.subscribe(ServerAdded, () => serverAddedCount++);
    queue.subscribe(ServerForgotten, () => serverForgottenCount++);
    queue.subscribe(ServerRenamed, () => serverRenamedCount++);
    queue.subscribe(ServerForgetUndone, () => serverForgetUndoneCount++);
    queue.subscribe(ServerConnected, () => serverConnectedCount++);
    queue.subscribe(ServerDisconnected, () => serverDisconnectedCount++);

    // Subscribes additional listeners to certain events
    queue.subscribe(ServerForgotten, () => serverForgottenCount++);
    queue.subscribe(ServerForgotten, () => serverForgottenCount++);
    queue.startPublishing();

    // Enqueue event with single listener
    queue.enqueue(new ServerAdded(null));
    expect(serverAddedCount).toEqual(1);
    expect(serverForgottenCount).toEqual(0);
    expect(serverRenamedCount).toEqual(0);
    expect(serverForgetUndoneCount).toEqual(0);
    expect(serverConnectedCount).toEqual(0);
    expect(serverDisconnectedCount).toEqual(0);

    // Enqueue event with multiple listeners
    queue.enqueue(new ServerForgotten(null));
    expect(serverAddedCount).toEqual(1);
    expect(serverForgottenCount).toEqual(3);
    expect(serverRenamedCount).toEqual(0);
    expect(serverForgetUndoneCount).toEqual(0);
    expect(serverConnectedCount).toEqual(0);
    expect(serverDisconnectedCount).toEqual(0);

    // Enqueue event with no listeners
    queue.enqueue(new ServerReconnecting(null));
    expect(serverAddedCount).toEqual(1);
    expect(serverForgottenCount).toEqual(3);
    expect(serverRenamedCount).toEqual(0);
    expect(serverForgetUndoneCount).toEqual(0);
    expect(serverConnectedCount).toEqual(0);
    expect(serverDisconnectedCount).toEqual(0);
  });
  it('events are not published until startPublishing is called', () => {
    let serverAddedCount = 0;

    const queue = new EventQueue();
    queue.subscribe(ServerAdded, () => serverAddedCount++);
    queue.subscribe(ServerAdded, () => serverAddedCount++);
    queue.enqueue(new ServerAdded(null));

    expect(serverAddedCount).toEqual(0);
    queue.startPublishing();
    expect(serverAddedCount).toEqual(2);
  });
  it('enqueue is reentrant', () => {
    let serverAddedCount = 0;

    const queue = new EventQueue();
    queue.subscribe(ServerAdded, () => {
      if (serverAddedCount < 5) {
        queue.enqueue(new ServerAdded(null));
      }
      serverAddedCount++;
    });

    queue.enqueue(new ServerAdded(null));
    queue.startPublishing();
    expect(serverAddedCount).toEqual(6);
  });
});
