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

import {pathToFileURL} from 'url';

import minimist from 'minimist';

import {signWindowsExecutable} from '../../../infrastructure/build/sign_windows_executable.mjs';

async function main() {
  const {target, algorithm, ...options} = minimist(process.argv);
  await signWindowsExecutable(target, algorithm, options);
}

// Call this action through CLI to sign a Windows executable:
//   npm run action client/electron/windows/sign_windows_executable --
//     --target <exe-path-to-sign>
//     --algorithm <sha1|sha256>
//     --certtype <none|gcp-hsm>
//     --password <gcp-access-token>
// The following options are for --certtype == gcp-hsm
//     --gcp-keyring <full-id: https://cloud.google.com/kms/docs/resource-hierarchy#retrieve_resource_id>
//     --gcp-private-key <name-of-the-key-in-key-ring>
//     --gcp-public-cert <full-path-of-the-public-certificate-file>
//
// You can also use environment variables to specify some arguments:
//   WINDOWS_SIGNING_CERT_TYPE       <=> --certtype
//   WINDOWS_SIGNING_CERT_PASSWORD   <=> --password
//   WINDOWS_SIGNING_GCP_KEYRING     <=> --gcp-keyring
//   WINDOWS_SIGNING_GCP_PRIVATE_KEY <=> --gcp-private-key
//   WINDOWS_SIGNING_GCP_PUBLIC_CERT <=> --gcp-public-cert
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
