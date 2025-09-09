/*
  Copyright 2022 The Outline Authors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import type {FormattableMessage, Localizer} from '@outline/infrastructure/i18n';
import IntlMessageFormat from 'intl-messageformat';

import englishMessages from '../messages/en.json';

export const localize: Localizer = (
  messageID: string,
  ...formatKeyValueList: FormattableMessage[]
): string => {
  const message = (englishMessages as {[messageID: string]: string})[messageID];
  const formatConfigObject: Record<string, FormattableMessage> = {};

  for (let index = 0; index < formatKeyValueList.length; index += 2) {
    const [key, value] = formatKeyValueList.slice(index, index + 2);

    formatConfigObject[String(key)] = value;
  }

  if (!message) {
    return `${messageID}(${JSON.stringify(formatConfigObject)})`;
  }

  try {
    // We support only english messages for now.
    // Blocked on modern-web.dev adding support for addons:
    // https://github.com/modernweb-dev/web/issues/1341
    return String(
      new IntlMessageFormat(message, 'en').format(formatConfigObject)
    );
  } catch (error) {
    return message;
  }
};
