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

import type {IncomingMessage} from 'http';
import * as https from 'https';
import {TLSSocket} from 'tls';
import {urlToHttpOptions} from 'url';

import type {HttpRequest, HttpResponse} from '@outline/infrastructure/path_api';

export const fetchWithPin = async (
  req: HttpRequest,
  fingerprint: string
): Promise<HttpResponse> => {
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const options: https.RequestOptions = {
      ...urlToHttpOptions(new URL(req.url)),
      method: req.method,
      headers: req.headers,
      rejectUnauthorized: false, // Disable certificate chain validation.
      // A pooled socket does not emit secureConnect again. Use a fresh TLS
      // connection so every request validates its own expected fingerprint.
      agent: false,
    };
    const request = https.request(options, resolve).on('error', reject);
    // Bound the whole exchange, including a response body that never finishes.
    const timeout = setTimeout(() => {
      request.destroy(new Error('Management API request timed out'));
    }, 30000);
    request.once('close', () => clearTimeout(timeout));

    // Enforce certificate fingerprint match.
    request.on('socket', (socket: TLSSocket) =>
      socket.once('secureConnect', () => {
        const certificate = socket.getPeerCertificate();
        // Parse fingerprint in "AB:CD:EF" form.
        const sha2hex = certificate.fingerprint256?.replace(/:/g, '') ?? '';
        const sha2binary = Buffer.from(sha2hex, 'hex').toString('binary');
        if (!certificate.fingerprint256 || sha2binary !== fingerprint) {
          request.destroy(new Error('Fingerprint mismatch'));
          return;
        }
        // Do not send the management path, headers or body before the pin passes.
        request.end(req.body);
      })
    );
  });

  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(chunk);
  }

  return {
    status: response.statusCode,
    body: Buffer.concat(chunks).toString(),
  };
};
