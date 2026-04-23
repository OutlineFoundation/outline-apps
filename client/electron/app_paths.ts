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

import * as os from 'os';
import * as path from 'path';

import {app} from 'electron';

const IS_WINDOWS = os.platform() === 'win32';

/**
 * Get the unpacked asar folder path.
 *   - For Debian, `/opt/Outline/resources/app.asar.unpacked`
 *   - For Windows, `C:\Program Files (x86)\Outline\`
 * @returns A string representing the path of the unpacked asar folder.
 */
function unpackedAppPath() {
  return app.getAppPath().replace('app.asar', 'app.asar.unpacked');
}

/**
 * Get the parent directory path of the current application binary.
 *   - For Debian, `/opt/Outline/resources/app.asar`
 *   - For Windows, `C:\Program Files (x86)\Outline\`
 * @returns A string representing the path of the application directory.
 */
export function getAppPath() {
  const electronAppPath = app.getAppPath();
  if (IS_WINDOWS && electronAppPath.includes('app.asar')) {
    return path.dirname(app.getPath('exe'));
  }
  return electronAppPath;
}

export function pathToEmbeddedTun2socksBinary() {
  return path.join(
    unpackedAppPath(),
    'output',
    'client',
    IS_WINDOWS ? 'windows-386' : 'linux-amd64',
    IS_WINDOWS ? 'tun2socks.exe' : 'tun2socks'
  );
}

export function pathToBackendLibrary() {
  return path.join(
    unpackedAppPath(),
    'output',
    'client',
    IS_WINDOWS ? 'windows-386' : 'linux-amd64',
    IS_WINDOWS ? 'backend.dll' : 'libbackend.so'
  );
}

/**
 * Get the directory containing the Windows background service binaries
 * (`OutlineService.exe` and `install_windows_service.bat`).
 * @returns A string representing the path of the directory that contains service binaries.
 */
export function pathToEmbeddedOutlineService() {
  return getAppPath();
}
