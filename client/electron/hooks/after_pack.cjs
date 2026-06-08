// Copyright 2025 The Outline Authors
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

// CommonJS module is required, ES6 module is not supported by electron-builder

const {execSync} = require('node:child_process');
const {join} = require('node:path');

/**
 * Patches the RPATH of the Linux Outline binary.
 *
 * For Debian, this is necessary because setting capabilities (setcap) on the
 * binary disables `LD_LIBRARY_PATH` and relative RPATH (e.g., `$ORIGIN`),
 * preventing the app from finding libraries (like libffmpeg.so) in the install
 * directory.
 * So we need to add the absolute path of the install directory to RPATH.
 *
 * We also need to patch the RPATH at build time because the user's system
 * might not have a compatible `patchelf` at runtime.
 *
 * @param {string} binDir The directory containing the built Outline binary.
 * @throws {Error} If `patchelf` is not found or if the RPATH modification fails.
 */
function patchLinuxRPath(binDir) {
  const outlineBinFile = join(binDir, 'Outline');

  try {
    console.log(`Patching RPATH for ${outlineBinFile}`);
    execSync('patchelf --version', {stdio: 'inherit'});
  } catch (e) {
    console.error('`patchelf --version` failed, `patchelf` 0.14+ is required');
    console.error('Install `patchelf` using:');
    console.error('\tDebian:  sudo apt install patchelf');
    console.error('\tmacOS:   brew install patchelf');
    console.error('\tWindows: https://github.com/NixOS/patchelf/releases');
    throw e;
  }

  try {
    const DebianInstallFolder = '/opt/Outline';
    execSync(
      `patchelf --add-rpath "${DebianInstallFolder}" "${outlineBinFile}"`,
      {
        stdio: 'inherit',
      }
    );
    console.info(`RPATH patched for ${outlineBinFile}`);
  } catch (e) {
    console.error(`Failed to patch RPATH for ${outlineBinFile}`);
    throw e;
  }
}

/**
 * Runs after pack into .asar and before pack into distributable file (.exe/.deb).
 */
exports.default = function (buildResult) {
  if (buildResult.electronPlatformName === 'linux') {
    patchLinuxRPath(buildResult.appOutDir);
  }
};
