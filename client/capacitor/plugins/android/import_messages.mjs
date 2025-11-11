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

import {readFile, writeFile} from 'fs/promises';
import path from 'path';

import XML from 'xmlbuilder2';

// $WORKSPACE/client/src/cordova/plugin/android/res
const STRINGS_DIR = ['client', 'src', 'cordova', 'plugin', 'android', 'res'];
const STRINGS_FILENAME = 'strings.xml';
const XML_STRING_ID_PROPERTY = '@name';
const XML_TEXT_CONTENT = '#';

function escapeXmlCharacters(str) {
  // TODO: This is not a safe way to escape XML characters. We should do it properly.
  return str
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>;')
    .replace(/&/g, '\\&');
}

function getNativeLocale(locale) {
  switch (locale) {
    case 'es-419':
      return 'es';
    case 'sr-Latn':
      return 'b+sr+Latn';
    default:
      return locale.replace('-', '-r');
  }
}

/**
 * Retrieves a filepath for a given locale to read/write strings to.
 * @param {string} locale A locale for which to get a strings filepath.
 * @returns {string} The filepath.
 */
export function getStringsFilepath(locale) {
  const localeSuffix = locale ? `-${getNativeLocale(locale)}` : '';
  return path.join(...STRINGS_DIR, `values${localeSuffix}`, STRINGS_FILENAME);
}

/**
 * Reads messages that require translations.
 * @return {Map<string, string>} messages The messages to translate.
 */
export async function readMessages() {
  const strings = await XML.create(
    await readFile(getStringsFilepath(), 'utf8')
  ).end({format: 'object'}).resources.string;
  return strings.reduce((acc, string) => {
    return acc.set(string[XML_STRING_ID_PROPERTY], string[XML_TEXT_CONTENT]);
  }, new Map());
}

/**
 * Writes output messages to a given path in the Android expected format.
 * @param {string} path The path to write the messages to.
 * @param {Map<string, string>} messages The messages to write.
 */
export async function writeMessages(path, messages) {
  const output = Object.entries(messages).reduce((acc, [key, value]) => {
    acc.push({
      [XML_STRING_ID_PROPERTY]: key,
      [XML_TEXT_CONTENT]: escapeXmlCharacters(value),
    });
    return acc;
  }, []);

  await writeFile(
    path,
    XML.create({encoding: 'UTF-8'}, {resources: {string: output}}).end({
      prettyPrint: true,
      wellFormed: true,
    })
  );
}
