import { registerPlugin } from '@capacitor/core';

import type { CapacitorGoPluginPlugin } from './definitions';

const CapacitorGoPlugin = registerPlugin<CapacitorGoPluginPlugin>('CapacitorGoPlugin', {
  web: () => import('./web').then((m) => new m.CapacitorGoPluginWeb()),
});

export * from './definitions';
export { CapacitorGoPlugin };
