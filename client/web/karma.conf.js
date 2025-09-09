// Copyright 2022 The Outline Authors
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

const path = require('path');

module.exports = async function(config) {
  const testConfig = await import('./webpack_test.mjs');

  config.set({
    browsers: ['ChromiumHeadless'],
    colors: true,
    files: ['**/*.spec.ts'],
    frameworks: ['webpack', 'jasmine'],
    preprocessors: {
      '**/*.spec.ts': ['webpack'],
    },
    reporters: ['progress', 'coverage-istanbul'],
    restartOnFileChange: true,
    webpack: testConfig.default,
    coverageIstanbulReporter: {
      reports: ['html', 'json', 'text-summary'],
      dir: path.join(process.env?.COVERAGE_DIR ?? __dirname, 'www'),
    },
  });
};
