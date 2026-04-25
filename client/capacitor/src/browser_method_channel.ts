// Copyright 2026 The Outline Authors
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

import type {MethodChannel} from '../../web/app/method_channel';

/**
 * MethodChannel for Capacitor when running in the browser (webpack dev server).
 * The native Go backend is unavailable; this covers the subset needed to load
 * the UI and parse common static keys. Matches Go doParseTunnelConfig for those
 * cases (see client/go/outline/parse_test.go).
 */
export class CapacitorBrowserMethodChannel implements MethodChannel {
  async invokeMethod(methodName: string, params: string): Promise<string> {
    switch (methodName) {
      case 'ParseTunnelConfig':
        return parseTunnelConfigBrowser(params);
      case 'FetchResource': {
        const res = await fetch(params, {credentials: 'omit'});
        if (!res.ok) {
          throw new Error(`FetchResource failed: HTTP ${res.status}`);
        }
        return (await res.text()).trim();
      }
      case 'EraseServiceStorage':
        return '';
      default:
        throw new Error(
          `Capacitor browser preview: method "${methodName}" is not supported`
        );
    }
  }
}

function parseTunnelConfigBrowser(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('empty tunnel config');
  }

  const ssUrl = extractSsUrl(trimmed);
  if (ssUrl) {
    return ssUrlToFirstHopJson(ssUrl);
  }

  if (trimmed.startsWith('{')) {
    return legacyJsonTunnelToFirstHopJson(trimmed);
  }

  throw new Error(
    'Unsupported tunnel config in browser preview. Use an ss:// access key or run on a native build for full YAML support.'
  );
}

function extractSsUrl(s: string): string | null {
  const idx = s.indexOf('ss://');
  if (idx === -1) {
    return null;
  }
  const fromSs = s.slice(idx);
  const m = fromSs.match(/^ss:\/\/[^\s]+/);
  return m ? m[0] : null;
}

function ssUrlToFirstHopJson(ssUrl: string): string {
  const u = new URL(ssUrl);
  const host = u.hostname.includes(':') ? `[${u.hostname}]` : u.hostname;
  const port = u.port || '443';
  const firstHop = `${host}:${port}`;
  const clientInner = JSON.stringify({transport: ssUrl});
  return JSON.stringify({
    client: clientInner,
    firstHop,
    connectionType: 'tunneled',
  });
}

interface LegacyServerJson {
  server: string;
  server_port: number;
  method: string;
  password: string;
  prefix?: string;
}

function legacyJsonTunnelToFirstHopJson(jsonStr: string): string {
  const obj = JSON.parse(jsonStr) as LegacyServerJson;
  if (
    typeof obj.server !== 'string' ||
    typeof obj.server_port !== 'number' ||
    typeof obj.method !== 'string' ||
    typeof obj.password !== 'string'
  ) {
    throw new Error('Unrecognized legacy JSON tunnel config');
  }
  const transport: Record<string, unknown> = {
    method: obj.method,
    password: obj.password,
  };
  if (obj.prefix !== undefined) {
    transport.prefix = obj.prefix;
  }
  transport.server = obj.server;
  transport.server_port = obj.server_port;
  const clientInner = JSON.stringify({transport});
  const host = obj.server.includes(':') ? `[${obj.server}]` : obj.server;
  const firstHop = `${host}:${obj.server_port}`;
  return JSON.stringify({
    client: clientInner,
    firstHop,
    connectionType: 'tunneled',
  });
}
