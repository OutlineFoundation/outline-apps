import {WebPlugin} from '@capacitor/core';

import type {CapacitorPluginOutline} from './definitions';

export class CapacitorPluginOutlineWeb
  extends WebPlugin
  implements CapacitorPluginOutline
{
  async invokeMethod(_options: {
    method: string;
    input: string;
  }): Promise<{value: string}> {
    throw this.unimplemented('Not implemented on web.');
  }

  async start(_options: {
    tunnelId: string;
    serverName: string;
    transportConfig: string;
  }): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async stop(_options: {tunnelId: string}): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async isRunning(_options: {tunnelId: string}): Promise<{isRunning: boolean}> {
    throw this.unimplemented('Not implemented on web.');
  }

  async initializeErrorReporting(_options: {apiKey: string}): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async reportEvents(_options: {uuid: string}): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }

  async quitApplication(): Promise<void> {
    throw this.unimplemented('Not implemented on web.');
  }
}
