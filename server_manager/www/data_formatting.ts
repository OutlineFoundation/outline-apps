/*
  Copyright 2020 The Outline Authors

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

// Utility functions for internationalizing numbers and units

const TERABYTE = 10 ** 12;
const GIGABYTE = 10 ** 9;
const MEGABYTE = 10 ** 6;
const KILOBYTE = 10 ** 3;

const TEBIBYTE = 1024 ** 4;
const GIBIBYTE = 1024 ** 3;
const MEBIBYTE = 1024 ** 2;
const KIBIBYTE = 1024;

const inWebApp =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';
interface FormatParams {
  value: number;
  unit: 'terabyte' | 'gigabyte' | 'megabyte' | 'kilobyte' | 'byte';
  decimalPlaces: number;
}

interface BinaryFormatParams {
  value: number;
  unit: 'TiB' | 'GiB' | 'MiB' | 'KiB' | 'B';
  decimalPlaces: number;
}

/**
 * Returns the Intl.NumberFormat options based on the magnitude of bytes passed in
 *
 * @param numBytes the bytes to format
 * @returns {FormatParams}
 */
export function getDataFormattingParams(numBytes: number): FormatParams {
  if (numBytes >= TERABYTE) {
    return {value: numBytes / TERABYTE, unit: 'terabyte', decimalPlaces: 2};
  } else if (numBytes >= GIGABYTE) {
    return {value: numBytes / GIGABYTE, unit: 'gigabyte', decimalPlaces: 2};
  } else if (numBytes >= MEGABYTE) {
    return {value: numBytes / MEGABYTE, unit: 'megabyte', decimalPlaces: 1};
  } else if (numBytes >= KILOBYTE) {
    return {value: numBytes / KILOBYTE, unit: 'kilobyte', decimalPlaces: 0};
  }
  return {value: numBytes, unit: 'byte', decimalPlaces: 0};
}

/**
 * Returns the binary formatting parameter based on the magnitude of bytes passed in
 *
 * @param numBytes the bytes to format
 * @returns {BinaryFormatParams}
 */
export function getBinaryDataFormattingParams(
  numBytes: number
): BinaryFormatParams {
  if (numBytes >= TEBIBYTE) {
    return {value: numBytes / TEBIBYTE, unit: 'TiB', decimalPlaces: 2};
  } else if (numBytes >= GIBIBYTE) {
    return {value: numBytes / GIBIBYTE, unit: 'GiB', decimalPlaces: 2};
  } else if (numBytes >= MEBIBYTE) {
    return {value: numBytes / MEBIBYTE, unit: 'MiB', decimalPlaces: 1};
  } else if (numBytes >= KIBIBYTE) {
    return {value: numBytes / KIBIBYTE, unit: 'KiB', decimalPlaces: 0};
  }
  return {value: numBytes, unit: 'B', decimalPlaces: 0};
}

function makeDataAmountFormatter(language: string, params: FormatParams) {
  // We need to cast through `unknown` since `tsc` mistakenly omits the 'unit' field in
  // `NumberFormatOptions`.
  const options = {
    style: 'unit',
    unit: params.unit,
    unitDisplay: 'short',
    maximumFractionDigits: params.decimalPlaces,
  } as unknown as Intl.NumberFormatOptions;
  return new Intl.NumberFormat(language, options);
}

interface DataAmountParts {
  value: string;
  unit: string;
}

/**
 * Returns a localized amount of bytes as a separate value and unit.  This is useful for styling
 * the unit and the value differently, or if you need them in separate nodes in the layout.
 *
 * @param {number} numBytes An amount of data to format.
 * @param {string} language The ISO language code for the lanugage to translate to, eg 'en'.
 */
export function formatBytesParts(
  numBytes: number,
  language: string
): DataAmountParts {
  if (!inWebApp) {
    throw new Error(
      "formatBytesParts only works in web app code. Node usage isn't supported."
    );
  }
  const params = getDataFormattingParams(numBytes);
  const parts = makeDataAmountFormatter(language, params).formatToParts(
    params.value
  );
  // Cast away the type since `tsc` mistakenly omits the possibility for a 'unit' part
  const isUnit = (part: Intl.NumberFormatPart) =>
    (part as {type: string}).type === 'unit';
  const unitText = parts.find(isUnit).value;
  return {
    value: parts
      .filter((part: Intl.NumberFormatPart) => !isUnit(part))
      .map((part: Intl.NumberFormatPart) => part.value)
      .join('')
      .trim(),
    // Special case for "byte", since we'd rather be consistent with "KB", etc.  "byte" is
    // presumably used due to the example in the Unicode standard,
    // http://unicode.org/reports/tr35/tr35-general.html#Example_Units
    unit: unitText === 'byte' ? 'B' : unitText,
  };
}

/**
 * Returns a localized amount of bytes (binary units) as separate value and unit.
 * This is useful for styling the unit and the value differently.
 *
 * Note: Intl.NumberFormat doesn't support binary units (KiB, MiB, etc.) in its
 * unit style, so we format the number and append the unit manually.
 *
 * @param {number} numBytes An amount of data to format.
 * @param {string} language The ISO language code for the lanugage to translate to, eg 'en'.
 */
export function formatBinaryBytesParts(
  numBytes: number,
  language: string
): DataAmountParts {
  if (!inWebApp) {
    throw new Error(
      "formatBinaryBytesParts only works in web app code. Node usage isn't supported."
    );
  }
  const params = getBinaryDataFormattingParams(numBytes);

  // Binary units aren't supported by Intl.NumberFormat's unit style,
  // so we format just the number with proper locale-specific formatting
  const numberFormatter = new Intl.NumberFormat(language, {
    minimumFractionDigits: params.decimalPlaces,
    maximumFractionDigits: params.decimalPlaces,
  });

  return {
    value: numberFormatter.format(params.value),
    unit: params.unit,
  };
}

/**
 * Returns a string representation of a number of bytes, translated into the given language
 *
 * @param {Number} numBytes An amount of data to format.
 * @param {string} language The ISO language code for the lanugage to translate to, eg 'en'.
 * @returns {string} The formatted data amount.
 */
export function formatBytes(numBytes: number, language: string): string {
  if (!inWebApp) {
    throw new Error(
      "formatBytes only works in web app code. Node usage isn't supported."
    );
  }
  const params = getDataFormattingParams(numBytes);
  return (
    makeDataAmountFormatter(language, params)
      .format(params.value)
      // Special case for "byte", since we'd rather be consistent with "KB", etc.  "byte" is
      // presumably used due to the example in the Unicode standard,
      // http://unicode.org/reports/tr35/tr35-general.html#Example_Units
      .replace(/\s+bytes?/, ' B')
  );
}

/**
 * Returns a string representation of a number of bytes using binary units (KiB, MiB, GiB, TiB),
 * translated into the given language
 *
 * @param {Number} numBytes An amount of data to format.
 * @param {string} language The ISO language code for the language to translate to, eg 'en'.
 * @returns {string} The formatted data amount with binary units.
 */
export function formatBinaryBytes(numBytes: number, language: string): string {
  if (!inWebApp) {
    throw new Error(
      "formatBytes only works in web app code. Node usage isn't supported."
    );
  }

  const parts = formatBinaryBytesParts(numBytes, language);
  return `${parts.value} ${parts.unit}`;
}

// TODO(JonathanDCohen222) Differentiate between this type, which is an input data limit, and
// a more general DisplayDataAmount with a string-typed unit and value which respects i18n.
export interface DisplayDataAmount {
  unit: 'MB' | 'GB';
  value: number;
}

/**
 * @param dataAmount
 * @returns The number of bytes represented by dataAmount
 */
export function displayDataAmountToBytes(
  dataAmount: DisplayDataAmount
): number {
  if (!dataAmount) {
    return null;
  }
  if (dataAmount.unit === 'GB') {
    return dataAmount.value * 10 ** 9;
  } else if (dataAmount.unit === 'MB') {
    return dataAmount.value * 10 ** 6;
  }
}

/**
 * @param bytes
 * @returns A DisplayDataAmount representing the number of bytes
 */
export function bytesToDisplayDataAmount(bytes: number): DisplayDataAmount {
  if (bytes === null || bytes === undefined) {
    return null;
  }
  if (bytes >= 10 ** 9) {
    return {value: Math.floor(bytes / 10 ** 9), unit: 'GB'};
  }
  return {value: Math.floor(bytes / 10 ** 6), unit: 'MB'};
}
