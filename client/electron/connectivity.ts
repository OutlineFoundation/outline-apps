// Copyright 2019 The Outline Authors
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

import * as dns from 'dns';

import {timeoutPromise} from '@outline/infrastructure/timeout_promise';

import * as errors from '../web/model/errors';

const DNS_LOOKUP_TIMEOUT_MS = 10000;

// Uses the OS' built-in functions, i.e. /etc/hosts, et al.:
// https://nodejs.org/dist/latest-v10.x/docs/api/dns.html#dns_dns
//
// Effectively a no-op if hostname is already an IP.
export function lookupIp(hostname: string): Promise<string> {
  return timeoutPromise(
    new Promise<string>((fulfill, reject) => {
      dns.lookup(hostname, 4, (e, address) => {
        if (e) {
          return reject(
            new errors.ServerUnreachable(
              'could not resolve proxy server hostname'
            )
          );
        }
        fulfill(address);
      });
    }),
    DNS_LOOKUP_TIMEOUT_MS,
    'DNS lookup'
  );
}
