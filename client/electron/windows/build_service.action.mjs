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

import path from 'path';
import {pathToFileURL} from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {signWindowsExecutable} from '@outline/infrastructure/build/sign_windows_executable.mjs';
import {spawnStream} from '@outline/infrastructure/build/spawn_stream.mjs';

async function main() {
  const serviceDir = path.join(getRootDir(), 'output/client/windows-service');
  const binDir = path.join(serviceDir, 'bin');
  const dnsBlock = path.join(binDir, 'smartdnsblock.exe');

  // Both the ia32 and arm64 installers deploy these two x86 executables.
  await spawnStream(
    'dotnet',
    'build',
    'client/electron/windows/OutlineService/OutlineService/OutlineService.csproj',
    '--configuration',
    'Release',
    '--no-incremental',
    '--output',
    binDir,
    '-p:Platform=x86',
    `-p:BaseIntermediateOutputPath=${path.join(serviceDir, 'obj')}/`
  );
  await spawnStream(
    'zig',
    'c++',
    '-target',
    'x86-windows-gnu',
    '-Os',
    '-s',
    'client/electron/windows/smartdnsblock/smartdnsblock/smartdnsblock.cpp',
    '-liphlpapi',
    '-lfwpuclnt',
    '-lrpcrt4',
    '-o',
    dnsBlock
  );
  await signWindowsExecutable(
    path.join(binDir, 'OutlineService.exe'),
    'sha256'
  );
  await signWindowsExecutable(dnsBlock, 'sha256');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
