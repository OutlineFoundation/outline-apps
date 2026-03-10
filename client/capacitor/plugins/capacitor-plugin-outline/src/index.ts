import {registerPlugin} from '@capacitor/core';

import type {CapacitorPluginOutline} from './definitions';

const CapacitorPluginOutline = registerPlugin<CapacitorPluginOutline>(
  'CapacitorPluginOutline',
  {
    web: () => import('./web').then(m => new m.CapacitorPluginOutlineWeb()),
  }
);

export * from './definitions';
export {CapacitorPluginOutline};
