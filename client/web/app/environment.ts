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

export interface EnvironmentVariables {
  APP_VERSION: string;
  APP_BUILD_NUMBER: string;
  SENTRY_DSN: string | undefined;
}

// According to http://caniuse.com/#feat=fetch fetch didn't land iOS Safari
// until v10.3 released 3/26/17, so use XMLHttpRequest instead.
export const onceEnvVars: Promise<EnvironmentVariables> = new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.onload = () => {
    try {
      const json = JSON.parse(xhr.responseText);
      console.debug('Resolving with envVars:', json);
      resolve(json as EnvironmentVariables);
    } catch (err) {
      reject(err);
    }
  };
  xhr.open('GET', 'environment.json', true);
  xhr.send();
});
