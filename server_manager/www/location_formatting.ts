// Copyright 2021 The Outline Authors
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

import {
  CloudLocation,
  CloudLocationOption,
  GeoLocation,
} from '../model/location';

function formatGeoId(geoId: string): string {
  return geoId
    .split('-')
    .map(part => {
      if (!part) {
        return '';
      }
      if (part === part.toUpperCase()) {
        return part;
      }
      return `${part[0].toUpperCase()}${part.slice(1)}`;
    })
    .join(' ');
}

/**
 * Returns the localized place name, or the data center ID if the location is
 * unknown.
 */
export function getShortName(
  cloudLocation: CloudLocation,
  localize: (id: string) => string
): string {
  if (!cloudLocation) {
    return '';
  }
  if (!cloudLocation.location) {
    return cloudLocation.id;
  }
  const msgId = `geo-${cloudLocation.location.id.toLowerCase()}`;
  const localized = localize(msgId);
  if (localized && localized !== msgId) {
    return localized;
  }
  return formatGeoId(cloudLocation.location.id);
}

/**
 * Returns the localized country name, or "" if the country is unknown or
 * unnecessary.
 */
export function localizeCountry(
  geoLocation: GeoLocation,
  language: string
): string {
  if (!geoLocation) {
    return '';
  }
  // TODO: Remove typecast after https://github.com/microsoft/TypeScript/pull/44022
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const displayName = new (Intl as any).DisplayNames([language], {
    type: 'region',
  });
  return displayName.of(geoLocation.countryCode);
}

/**
 * Given an array of cloud location options, this function returns an array
 * containing one representative option for each GeoLocation.  Available
 * options are preferred within each location.  Available options with unknown
 * GeoLocation (e.g. newly added zones) are placed at the end of the array.
 */
export function filterOptions<T extends CloudLocationOption>(
  options: readonly T[]
): T[] {
  // Contains one available datacenter ID for each GeoLocation, or null if
  // there are datacenters for that GeoLocation but none are available.
  const map = new Map<string, T>();
  const unmappedOptions: T[] = [];

  options.forEach(option => {
    const geoLocation = option.cloudLocation.location;
    if (geoLocation) {
      if (option.available || !map.has(geoLocation.id)) {
        map.set(geoLocation.id, option);
      }
    } else if (option.available) {
      unmappedOptions.push(option);
    }
  });

  return [...map.values(), ...unmappedOptions];
}
