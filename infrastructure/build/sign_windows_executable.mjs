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

import {constants} from 'fs';
import {access, mkdtemp, rm, writeFile} from 'fs/promises';
import {tmpdir} from 'os';
import {join, resolve} from 'path';
import {format} from 'util';

import {jsign} from '../../third_party/jsign/index.mjs';

function assert(condition, msg) {
  if (!condition) {
    throw new Error(msg);
  }
}

async function assertFileExists(file, msg) {
  try {
    await access(file, constants.R_OK | constants.W_OK);
  } catch (err) {
    throw new Error(format(msg, file), {cause: err});
  }
}

/**
 * Get the required option value from either cliValue or environment variable.
 * @param {object} options the CLI options object.
 * @param {string} argName the CLI argument name.
 * @param {string} envName the environment variable name for this option.
 * @param {boolean} required indicates whether this option is required.
 * @returns {string} the value of the option
 */
function getOptionValue(options, argName, envName, required) {
  const cliValue = options ? options[argName] : null;
  const v = cliValue ?? process.env[envName];
  if (required) {
    assert(!!v, `either --${argName} or ${envName} is required`);
  }
  return v;
}

function appendGcpHsmJsignArgs(args, options) {
  // Google Cloud Key Management HSM based certificate
  args.push('--storetype', 'GOOGLECLOUD');

  const keyRing = getOptionValue(
    options,
    'gcp-keyring',
    'WINDOWS_SIGNING_GCP_KEYRING',
    true
  );
  args.push('--keystore', keyRing);

  const keyName = getOptionValue(
    options,
    'gcp-private-key',
    'WINDOWS_SIGNING_GCP_PRIVATE_KEY',
    true
  );
  args.push('--alias', keyName);

  const certFile = getOptionValue(
    options,
    'gcp-public-cert',
    'WINDOWS_SIGNING_GCP_PUBLIC_CERT',
    true
  );
  args.push('--certfile', certFile);
}

/**
 * Sign the target exeFile using a specific algorithm and options.
 * @param {string} exeFile the full path of the exe file to be signed.
 * @param {'sha1'|'sha256'} algorithm the algorithm used for signing.
 * @param {object} options additional options (cli arguments) for signing.
 *                         the options will also be read from environment
 *                         variables.
 */
export async function signWindowsExecutable(exeFile, algorithm, options) {
  const type = getOptionValue(
    options,
    'certtype',
    'WINDOWS_SIGNING_CERT_TYPE',
    false
  );
  if (!type || type === 'none') {
    console.info(`skip signing "${exeFile}"`);
    return;
  }

  assert(!!exeFile, 'executable path is required');
  assert(
    algorithm === 'sha1' || algorithm === 'sha256',
    'hashing algorithm must be either "sha1" or "sha256"'
  );

  exeFile = resolve(exeFile);
  await assertFileExists(exeFile, 'executable file "%s" does not exist');

  // String() because minimist parses an all-digit CLI password (such as a
  // token PIN) as a number.
  const password = String(
    getOptionValue(options, 'password', 'WINDOWS_SIGNING_CERT_PASSWORD', true)
  );

  // jsign trims file-sourced passwords, so surrounding whitespace would be
  // silently altered before authentication; fail fast instead.
  assert(
    password === password.trim(),
    'signing passwords with leading or trailing whitespace are not supported'
  );

  // Hand the password (which may be a short-lived GCP access token) to jsign
  // through a private temp file rather than argv, where it would be visible
  // to other local processes (`ps`) for the duration of the signing.
  const tempDir = await mkdtemp(join(tmpdir(), 'outline-jsign-'));
  const passwordFile = join(tempDir, 'storepass');

  try {
    await writeFile(passwordFile, password, {mode: 0o600});

    const jsignArgs = [
      '--alg',
      algorithm === 'sha256' ? 'SHA-256' : 'SHA-1',
      '--tsaurl',
      'http://timestamp.digicert.com',
      '--storepass',
      `file:${passwordFile}`,
    ];

    switch (type) {
      case 'gcp-hsm':
        appendGcpHsmJsignArgs(jsignArgs, options);
        break;
      default:
        throw new Error(`cert type ${type} is not supported`);
    }

    let exitCode;
    try {
      exitCode = await jsign(exeFile, jsignArgs);
    } catch (err) {
      throw new Error('failed to run jsign', {cause: err});
    }

    if (exitCode === 0) {
      console.info(`successfully signed "${exeFile}"`);
    } else {
      console.error(`jsign exited with error code ${exitCode}`);
      throw new Error(`failed to sign "${exeFile}"`);
    }
  } finally {
    try {
      await rm(tempDir, {recursive: true, force: true});
    } catch (cleanupErr) {
      // don't let a cleanup failure mask the signing error
      console.error(
        `failed to remove temporary signing directory "${tempDir}"`,
        cleanupErr
      );
    }
  }
}
