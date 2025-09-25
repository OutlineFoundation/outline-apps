import { WebPlugin } from '@capacitor/core';

import type { CapacitorGoPluginPlugin } from './definitions';

export class CapacitorGoPluginWeb extends WebPlugin implements CapacitorGoPluginPlugin {
  async echo(options: { value: string }): Promise<{ value: string }> {
    console.log('ECHO', options);
    return options;
  }
}
