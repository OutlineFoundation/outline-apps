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

import * as fs from 'fs';
import * as path from 'path';

interface AutoStartOnLoginSettings {
  enabled: boolean;
}

export class AutoStartOnLoginStore {
  private storagePath: string;

  constructor(storagePath: string) {
    fs.mkdirSync(storagePath, {recursive: true});
    this.storagePath = path.join(storagePath, 'auto_start_on_login_store');
  }

  save(enabled: boolean): Promise<void> {
    const settings: AutoStartOnLoginSettings = {enabled};
    return new Promise((resolve, reject) => {
      fs.writeFile(
        this.storagePath,
        JSON.stringify(settings),
        'utf8',
        error => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
  }

  load(): Promise<boolean> {
    return new Promise(resolve => {
      fs.readFile(this.storagePath, 'utf8', (_error, data) => {
        if (!data) {
          resolve(true);
          return;
        }

        try {
          const settings = JSON.parse(data) as AutoStartOnLoginSettings;
          resolve(settings.enabled !== false);
        } catch {
          resolve(true);
        }
      });
    });
  }
}
