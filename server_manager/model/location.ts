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

/**
 * Unified server location model for all cloud providers.
 *
 * Keys are GeoIds, identifying the location.  Values are ISO country codes.
 *
 * Each key identifies a location as displayed in the Outline
 * user interface.  To minimize confusion, Outline attempts to
 * present each location in a manner consistent with the cloud
 * provider's own interface and documentation.  When cloud providers
 * present a location in similar fashion, they may share an element
 * (e.g. 'frankfurt' for GCP and DO), but if they present a similar
 * location in different terms, they will need to be represented
 * separately (e.g. 'SG' for DO, 'jurong-west' for GCP).
 *
 * When the key and value are equal, this indicates that they are redundant.
 */
export class GeoLocation {
  constructor(
    readonly id: string,
    public readonly countryCode: string
  ) {}

  countryIsRedundant(): boolean {
    return this.countryCode === this.id;
  }
}

export const AMSTERDAM = new GeoLocation('amsterdam', 'NL');
export const NORTHERN_VIRGINIA = new GeoLocation('northern-virginia', 'US');
export const BANGALORE = new GeoLocation('bangalore', 'IN');
export const IOWA = new GeoLocation('iowa', 'US');
export const CHANGHUA_COUNTY = new GeoLocation('changhua-county', 'TW');
export const DELHI = new GeoLocation('delhi', 'IN');
export const EEMSHAVEN = new GeoLocation('eemshaven', 'NL');
export const FRANKFURT = new GeoLocation('frankfurt', 'DE');
export const HAMINA = new GeoLocation('hamina', 'FI');
export const HONG_KONG = new GeoLocation('HK', 'HK');
export const JAKARTA = new GeoLocation('jakarta', 'ID');
export const JURONG_WEST = new GeoLocation('jurong-west', 'SG');
export const JOHANNESBURG = new GeoLocation('johannesburg', 'ZA');
export const KUALA_LUMPUR = new GeoLocation('kuala-lumpur', 'MY');
export const LAS_VEGAS = new GeoLocation('las-vegas', 'US');
export const LONDON = new GeoLocation('london', 'GB');
export const LOS_ANGELES = new GeoLocation('los-angeles', 'US');
export const OREGON = new GeoLocation('oregon', 'US');
export const MELBOURNE = new GeoLocation('melbourne', 'AU');
export const MONTREAL = new GeoLocation('montreal', 'CA');
export const MUMBAI = new GeoLocation('mumbai', 'IN');
export const NEW_YORK_CITY = new GeoLocation('new-york-city', 'US');
export const SAN_FRANCISCO = new GeoLocation('san-francisco', 'US');
export const SINGAPORE = new GeoLocation('SG', 'SG');
export const OSAKA = new GeoLocation('osaka', 'JP');
export const STOCKHOLM = new GeoLocation('stockholm', 'SE');
export const MADRID = new GeoLocation('madrid', 'ES');
export const MILAN = new GeoLocation('milan', 'IT');
export const PARIS = new GeoLocation('paris', 'FR');
export const BERLIN = new GeoLocation('berlin', 'DE');
export const TURIN = new GeoLocation('turin', 'IT');
export const DOHA = new GeoLocation('doha', 'QA');
export const DAMMAM = new GeoLocation('dammam', 'SA');
export const TEL_AVIV = new GeoLocation('tel-aviv', 'IL');
export const QUERETARO = new GeoLocation('queretaro', 'MX');
export const SAO_PAULO = new GeoLocation('sao-paulo', 'BR');
export const SANTIAGO = new GeoLocation('santiago', 'CL');
export const COLUMBUS = new GeoLocation('columbus', 'US');
export const DALLAS = new GeoLocation('dallas', 'US');
export const SALT_LAKE_CITY = new GeoLocation('salt-lake-city', 'US');
export const SEOUL = new GeoLocation('seoul', 'KR');
export const ST_GHISLAIN = new GeoLocation('st-ghislain', 'BE');
export const SYDNEY = new GeoLocation('sydney', 'AU');
export const SOUTH_CAROLINA = new GeoLocation('south-carolina', 'US');
export const TOKYO = new GeoLocation('tokyo', 'JP');
export const TORONTO = new GeoLocation('toronto', 'CA');
export const WARSAW = new GeoLocation('warsaw', 'PL');
export const ZURICH = new GeoLocation('zurich', 'CH');

export interface CloudLocation {
  /**
   * The cloud-specific ID used for this location, or null to represent
   * a GeoId that lacks a usable datacenter.
   */
  readonly id: string;

  /**
   * The physical location of this datacenter, or null if its location is
   * unknown.
   */
  readonly location: GeoLocation;
}

export interface CloudLocationOption {
  readonly cloudLocation: CloudLocation;
  readonly available: boolean;
}
