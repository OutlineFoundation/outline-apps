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

export type UpdateListener = () => void;

export interface Updater {
  // Sets a callback to be invoked when an update is available.
  setListener(listener: UpdateListener): void;
}

export class AbstractUpdater implements Updater {
  private listener: UpdateListener | null = null;

  setListener(listener: UpdateListener) {
    this.listener = listener;
  }

  emitEvent() {
    if (this.listener) {
      this.listener();
    }
  }
}
