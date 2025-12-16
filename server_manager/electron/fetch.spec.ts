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

import * as crypto from 'crypto';
import * as https from 'https';
import {AddressInfo} from 'net';
import * as tls from 'tls';

import * as forge from 'node-forge';

import {fetchWithPin} from './fetch';

describe('fetchWithPin', () => {
  it('throws on pin mismatch (remote)', async () => {
    const result = fetchWithPin(
      {url: 'https://www.gstatic.com/', method: 'GET'},
      'incorrect fingerprint'
    );
    await expectAsync(result).toBeRejectedWithError(
      Error,
      /Fingerprint mismatch/
    );
  });

  // Make a certificate.
  const {privateKey, publicKey} = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.sign(privateKey); // Self-signed cert

  // Serialize the certificate for `tls.createServer()`.
  const keyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  // Compute the certificate fingerprint.
  const certDer = forge.pki.pemToDer(certPem);
  const sha256 = crypto.createHash('sha256');
  const certSha256 = sha256
    .update(certDer.data, 'binary')
    .digest()
    .toString('binary');

  it('throws on pin mismatch (local)', async () => {
    const server = tls.createServer({key: keyPem, cert: certPem});
    await new Promise<void>(fulfill => server.listen(0, fulfill));

    const address = server.address() as AddressInfo;
    const req = {
      url: `https://localhost:${address.port}/foo`,
      method: 'GET',
    };

    // Fail if the TLS handshake completes.
    server.on('secureConnection', fail);

    const clientClosed = new Promise(fulfill =>
      server.on('connection', socket => socket.on('close', fulfill))
    );

    const result = fetchWithPin(req, 'incorrect fingerprint');
    await expectAsync(result).toBeRejectedWithError(
      Error,
      /Fingerprint mismatch/
    );

    // Don't stop the test until the client has closed the TCP socket.
    await clientClosed;
  });

  it('succeeds on pin match', async () => {
    const server = https.createServer({key: keyPem, cert: certPem});
    await new Promise<void>(fulfill => server.listen(0, fulfill));

    const address = server.address() as AddressInfo;
    const req = {
      url: `https://localhost:${address.port}/foo`,
      method: 'GET',
    };
    server.on('request', (incoming, response) => {
      expect(incoming.url).toBe('/foo');
      expect(incoming.method).toBe('GET');
      response.writeHead(200);
      response.write('test test');
      response.end();
    });

    const result = fetchWithPin(req, certSha256);
    await expectAsync(result).toBeResolvedTo({
      status: 200,
      body: 'test test',
    });
  });
});
