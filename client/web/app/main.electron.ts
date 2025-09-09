// Copyright 2018 The Outline Authors
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

/// <reference types="../../electron/preload.d.ts" />

import 'web-animations-js/web-animations-next-lite.min.js';
import '@webcomponents/webcomponentsjs/webcomponents-bundle.js';

import * as Sentry from '@sentry/electron/renderer';

import {AbstractClipboard} from './clipboard';
import {getLocalizationFunction, main} from './main';
import {installDefaultMethodChannel, MethodChannel} from './method_channel';
import {VpnApi} from './outline_server_repository/vpn';
import {ElectronVpnApi} from './outline_server_repository/vpn.electron';
import {AbstractUpdater} from './updater';
import {UrlInterceptor} from './url_interceptor';
import {VpnInstaller} from './vpn_installer';
import {ErrorCode, OutlinePluginError} from '../model/errors';
import {deserializeError} from '../model/platform_error';
import {
  getSentryBrowserIntegrations,
  OutlineErrorReporter,
  Tags,
} from '../shared/error_reporter';

const isWindows = window.electron.os.platform === 'win32';
const isLinux = window.electron.os.platform === 'linux';
const isOsSupported = isWindows || isLinux;

const interceptor = new UrlInterceptor();
window.electron.methodChannel.on('add-server', (_: Event, url: string) => {
  interceptor.executeListeners(url);
});

window.electron.methodChannel.on(
  'localization-request',
  (_: Event, localizationKeys: string[]) => {
    const localize = getLocalizationFunction();
    if (!localize) {
      console.error('Localization function not available.');
      window.electron.methodChannel.send('localization-response', null);
      return;
    }
    const localizationResult: {[key: string]: string} = {};
    for (const key of localizationKeys) {
      localizationResult[key] = localize(key);
    }
    window.electron.methodChannel.send(
      'localization-response',
      localizationResult
    );
  }
);

// Pushes a clipboard event whenever the app window receives focus.
class ElectronClipboard extends AbstractClipboard {
  constructor() {
    super();
    window.electron.methodChannel.on(
      'push-clipboard',
      this.emitEvent.bind(this)
    );
  }

  getContents() {
    // navigator.clipboard might raise 'Document is not focused' DOMException
    // when you turn on F12 view.
    return Promise.resolve(window.electron.clipboard.readText());
  }
}

class ElectronUpdater extends AbstractUpdater {
  constructor() {
    super();
    window.electron.methodChannel.on(
      'update-downloaded',
      this.emitEvent.bind(this)
    );
  }
}

class ElectronVpnInstaller implements VpnInstaller {
  async installVpn(): Promise<void> {
    const err = await window.electron.methodChannel.invoke(
      'install-outline-services'
    );

    // catch custom errors (even simple as numbers) does not work for ipcRenderer:
    // https://github.com/electron/electron/issues/24427
    if (err !== ErrorCode.NO_ERROR) {
      throw new OutlinePluginError(err);
    }
  }
}

class ElectronErrorReporter implements OutlineErrorReporter {
  constructor() {
    // parameters are initialized in main process
    Sentry.init({
      integrations: getSentryBrowserIntegrations,
    });
  }

  report(
    userFeedback: string,
    feedbackCategory: string,
    userEmail?: string,
    tags?: Tags
  ): Promise<void> {
    Sentry.captureEvent({
      message: userFeedback,
      user: {email: userEmail},
      tags: {...tags, category: feedbackCategory},
    });
    return Promise.resolve();
  }
}

class ElectronMethodChannel implements MethodChannel {
  async invokeMethod(methodName: string, params: string): Promise<string> {
    try {
      return await window.electron.methodChannel.invoke(
        'invoke-method',
        methodName,
        params
      );
    } catch (e) {
      throw deserializeError(e);
    }
  }
}

installDefaultMethodChannel(new ElectronMethodChannel());

main({
  getVpnApi(): VpnApi | undefined {
    if (isOsSupported) {
      return new ElectronVpnApi();
    }
  },
  getUrlInterceptor: () => interceptor,
  getClipboard: () => new ElectronClipboard(),
  getErrorReporter: _ => new ElectronErrorReporter(),
  getUpdater: () => new ElectronUpdater(),
  getVpnServiceInstaller: () => new ElectronVpnInstaller(),
  quitApplication: () => window.electron.methodChannel.send('quit-app'),
});
