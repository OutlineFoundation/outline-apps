/*
  Copyright 2025 The Outline Authors
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

import {html} from 'lit';
import '@material/web/all';

import './index';
import type {ErrorDetailsDialog} from './index';

const dummyStackTrace = `Error: Failed to connect to server
    at Connection.connect (connection.ts:123)
    at Server.connect (server.ts:456)
    at App.connectServer (app.ts:789)
    at HTMLButtonElement.<anonymous> (app-root.js:1011)
    at HTMLButtonElement.dispatchEvent (event-target.js:134)
    at HTMLElement.handleEvent (polymer-element.js:567)
    at Polymer.Base._fire (polymer-element.js:678)
    at Polymer.Base._notifyChange (polymer-element.js:890)
    at Polymer.Base._compute (polymer-element.js:912)
    at Polymer.Base._flushProperties (polymer-element.js:934)
    at Polymer.Base._flushProperties (polymer-element.js:956)
    at Polymer.Base._flushProperties (polymer-element.js:978)
    at Polymer.Base._flushProperties (polymer-element.js:1000)
    at Polymer.Base._flushProperties (polymer-element.js:1022)
    at Polymer.Base._flushProperties (polymer-element.js:1044)
    at Polymer.Base._flushProperties (polymer-element.js:1066)
    at Polymer.Base._flushProperties (polymer-element.js:1088)
    at Polymer.Base._flushProperties (polymer-element.js:1110)
    at ZoneDelegate.invokeTask (zone.js:421)
    at NgZone.runTask (ng-zone.ts:234)
    at ZoneTask.invoke (zone.js:492)
    at timer (zone.js:1234)
    at <anonymous>`;

const longErrorDetails =
  `Error Name: ConnectionError
Error Message: Failed to establish a secure connection to the server.
Error Code: 503

Server Details:
  Server ID: server-xyz123
  Server Name: My Awesome Server
  Server Address: 192.168.1.100
  Port: 443
  Protocol: Shadowsocks

Connection Attempt Details:
  Attempt Time: 2024-10-27T10:00:00Z
  Client IP: 10.0.0.1
  Client Port: 54321
  Last Successful Connection: 2024-10-26T18:00:00Z
  Number of Attempts: 5

Network Diagnostics:
  Ping to server: Timeout
  Traceroute:
    1. 10.0.0.1 (0.1ms)
    2. 192.168.0.1 (1.2ms)
    3. 172.16.0.1 (10.5ms)
    4. *
    5. *
    6. *
    7. Destination unreachable.
  DNS Resolution: Server address resolved to 192.168.1.100.
  Firewall Status: Likely blocking outgoing connections on port 443.
  VPN interface: Up
  VPN address: 10.11.12.13

System Information:
  OS: macOS 14.0
  Outline Client Version: 1.2.3
  Build Number: 456
  Hardware: M2 Chip

Shadowsocks Configuration:
  Cipher: aes-256-gcm
  Password: SuperSecretPassword
  Method: chacha20-ietf-poly1305
  Plugin: obfs-tls

Possible Causes:
  1. Server is currently offline or unreachable.
  2. Network firewall is blocking traffic on port 443.
  3. There might be a problem with your Shadowsocks configuration.
  4. DNS resolution failure or incorrect IP address.
  5. Client/server time desync.
  6. Antivirus block or other network interference.
  7. VPN interface failure

Troubleshooting Steps:
  1. Verify that the server is online and reachable.
  2. Check your network firewall settings.
  3. Review your Shadowsocks configuration for correctness.
  4. Restart your device and try again.
  5. Disable and then re-enable the VPN
  6. Confirm the client time and server time are in sync
  7. Contact the support team with these details.
` +
  '\n\nStack Trace:\n' +
  dummyStackTrace;

export default {
  title: 'Client/Root View/Error Details Dialog',
  component: 'add-access-key-dialog',
  args: {
    open: true,
    errorDetails: longErrorDetails,
    localize: (messageId: string) => {
      return {
        'error-details-dialog-header': 'Error Details',
        'error-details-dialog-dismiss': 'Dismiss',
        'error-details-dialog-copy': 'Copy',
        'error-details-dialog-copied': 'Copied',
      }[messageId];
    },
  },
};

export const Example = ({open, localize, errorDetails}: ErrorDetailsDialog) =>
  html`<error-details-dialog
    .open=${open}
    .localize=${localize}
    .errorDetails=${errorDetails}
  ></error-details-dialog>`;
