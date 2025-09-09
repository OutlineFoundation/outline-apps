// Copyright 2023 The Outline Authors
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

import {readFile, readdir, mkdir} from 'fs/promises';
import path from 'path';
import url from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import chalk from 'chalk';
import minimist from 'minimist';

import * as ANDROID_IMPORTER from './android/import_messages.mjs';
import * as IOS_IMPORTER from './apple/import_messages.mjs';

const ANDROID = 'android';
const IOS = 'ios';
const VALID_PLATFORMS = [ANDROID, IOS];

const SOURCE_MESSAGES_DIR = 'client/web/messages';

/**
 * Parses and verifies the action parameters and returns the specified platform.
 * @param {string[]} parameters The list of action arguments passed in.
 * @returns {Object} Object containing the specified platform.
 */
function getActionParameters(cliArguments) {
  const {
    _: [platform = ''],
  } = minimist(cliArguments);

  if (!VALID_PLATFORMS.includes(platform)) {
    throw new TypeError(
      `Platform "${platform}" is not a valid target for importing messages. ` +
        `Must be one of "${VALID_PLATFORMS.join('", "')}"`
    );
  }

  return {platform};
}

/**
 * Retrieves the source messages in all available translations.
 * @returns {Map<str, Object<str, str>} A map of locale->messages.
 */
async function loadMessages() {
  const messages = new Map();

  const messagesDir = path.join(getRootDir(), SOURCE_MESSAGES_DIR);
  for (const messagesFilename of await readdir(messagesDir)) {
    const lang = path.basename(
      messagesFilename,
      path.extname(messagesFilename)
    );
    const messagesFilepath = path.join(messagesDir, messagesFilename);
    const messageData = JSON.parse(await readFile(messagesFilepath, 'utf8'));
    messages.set(lang, messageData);
  }

  return messages;
}

/**
 * Imports message translations.
 * @param {function(string): string} getStringsFilepath A function to get a
 *     filepath to read/write strings for a given locale.
 * @param {function(): Map<string, string>} readMessages A function to read
 *     required messages.
 * @param {function(string, Map<string, string>)} writeMessages A function to
 *     write the output messages.
 */
async function importMessages(getStringsFilepath, readMessages, writeMessages) {
  const requiredMessages = await readMessages();

  for (const [locale, messageData] of await loadMessages()) {
    console.log(chalk.gray(`Importing \`${locale}\``));

    const outputMessages = {};
    for (const [key, value] of requiredMessages.entries()) {
      const messageId = key.replaceAll('_', '-');
      outputMessages[key] = messageData[messageId] ?? value;
    }

    const outputPath = getStringsFilepath(locale);
    console.log(
      chalk.gray(
        `Writing ${
          Object.values(outputMessages).length
        } messages to \`${outputPath}\``
      )
    );
    await mkdir(path.dirname(outputPath), {recursive: true});
    writeMessages(outputPath, outputMessages);
  }
}

/**
 * Imports message translations for the specified Cordova project.
 * @param {string[]} parameters The list of action arguments passed in.
 */
async function main(...parameters) {
  const {platform} = getActionParameters(parameters);
  console.group(chalk.white(`▶ importing ${platform} messages:`));

  switch (platform) {
    case ANDROID:
      await importMessages(
        ANDROID_IMPORTER.getStringsFilepath,
        ANDROID_IMPORTER.readMessages,
        ANDROID_IMPORTER.writeMessages
      );
      break;
    case IOS:
      await importMessages(
        IOS_IMPORTER.getStringsFilepath,
        IOS_IMPORTER.readMessages,
        IOS_IMPORTER.writeMessages
      );
      break;
    default:
      throw new Error(
        `Message import not implemented for platform "${platform}"`
      );
  }

  console.groupEnd();
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
