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

interface StorageSettings {
  [setting: string]: string;
}

// Setting keys supported by the `Settings` class.
export enum SettingsKey {
  VPN_WARNING_DISMISSED = 'vpn-warning-dismissed',
  AUTO_CONNECT_DIALOG_DISMISSED = 'auto-connect-dialog-dismissed',
  PRIVACY_ACK = 'privacy-ack',
  APPEARANCE = 'appearance',
}

// Theme options
export enum Appearance {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system',
}

// Persistent storage for user settings that supports a limited set of keys.
export class Settings {
  static readonly STORAGE_KEY = 'settings';

  private readonly settings = new Map<string, string>();

  constructor(
    private storage: Storage = window.localStorage,
    private validKeys: string[] = Object.values(SettingsKey)
  ) {
    this.loadSettings();
  }

  get(key: string) {
    return this.settings.get(key);
  }

  set(key: string, value: string) {
    if (!this.isValidSetting(key)) {
      throw new Error(`Cannot set invalid key ${key}`);
    }
    this.settings.set(key, value);
    this.storeSettings();
  }

  remove(key: string) {
    this.settings.delete(key);
    this.storeSettings();
  }

  isValidSetting(key: string) {
    return this.validKeys.includes(key);
  }

  private loadSettings() {
    const settingsJson = this.storage.getItem(Settings.STORAGE_KEY);
    if (!settingsJson) {
      console.debug('No settings found in storage');
      return;
    }
    const storageSettings = JSON.parse(settingsJson);
    for (const key in storageSettings) {
      this.settings.set(key, storageSettings[key]);
    }
  }

  private storeSettings() {
    const storageSettings: StorageSettings = {};
    for (const [key, value] of this.settings) {
      storageSettings[key] = value;
    }
    const storageSettingsJson = JSON.stringify(storageSettings);
    this.storage.setItem(Settings.STORAGE_KEY, storageSettingsJson);
  }
}
