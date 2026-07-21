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

/**
 * The entry point which will be called by electron-builder signing module.
 * @param {Object} configuration a configuration containing signing information
 * @param {string} configuration.path the executable file path to be signed
 * @param {'sha1'|'sha256'} configuration.hash requested hash algorithm
 * @param {boolean} configuration.isNest whether it is a secondary signature
 * @param {Object} configuration.options a duplication of electron-builder.json
 */
async function electronBuilderEntryPoint(configuration) {
  // CommonJS module is required, ES6 module is not supported by electron-builder
  const {signWindowsExecutable} = await import(
    '../../../infrastructure/build/sign_windows_executable.mjs'
  );
  await signWindowsExecutable(configuration.path, configuration.hash, null);
}

exports.default = electronBuilderEntryPoint;
