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

import {Zone} from './gcp';
import * as location from './location';

describe('Zone', () => {
  const knownRegions = [
    'africa-south1',
    'asia-east1',
    'asia-east2',
    'asia-northeast1',
    'asia-northeast2',
    'asia-northeast3',
    'asia-south1',
    'asia-south2',
    'asia-southeast1',
    'asia-southeast2',
    'asia-southeast3',
    'australia-southeast1',
    'australia-southeast2',
    'europe-central2',
    'europe-north1',
    'europe-north2',
    'europe-southwest1',
    'europe-west1',
    'europe-west2',
    'europe-west3',
    'europe-west4',
    'europe-west6',
    'europe-west8',
    'europe-west9',
    'europe-west10',
    'europe-west12',
    'me-central1',
    'me-central2',
    'me-west1',
    'northamerica-northeast1',
    'northamerica-northeast2',
    'northamerica-south1',
    'southamerica-east1',
    'southamerica-west1',
    'us-central1',
    'us-east1',
    'us-east4',
    'us-east5',
    'us-south1',
    'us-west1',
    'us-west2',
    'us-west3',
    'us-west4',
  ];

  it('extracts the region from the zone id', () => {
    expect(new Zone('africa-south1-b').regionId).toEqual('africa-south1');
  });

  it('maps all known regions to a location', () => {
    knownRegions.forEach(regionId => {
      expect(new Zone(`${regionId}-a`).location).toBeTruthy();
    });
  });

  it('maps africa-south1 to Johannesburg', () => {
    expect(new Zone('africa-south1-a').location).toBe(location.JOHANNESBURG);
  });

  it('maps asia-southeast3 to Kuala Lumpur', () => {
    expect(new Zone('asia-southeast3-b').location).toBe(location.KUALA_LUMPUR);
  });

  it('maps europe-west10 to Berlin', () => {
    expect(new Zone('europe-west10-a').location).toBe(location.BERLIN);
  });

  it('maps me-central1 to Doha', () => {
    expect(new Zone('me-central1-a').location).toBe(location.DOHA);
  });

  it('maps northamerica-south1 to Queretaro', () => {
    expect(new Zone('northamerica-south1-a').location).toBe(location.QUERETARO);
  });

  it('maps us-east5 to Columbus', () => {
    expect(new Zone('us-east5-a').location).toBe(location.COLUMBUS);
  });
});
