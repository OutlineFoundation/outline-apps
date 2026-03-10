// TODO(M3): Need to merge dependencies with parent package.json.


import '@capacitor/core';
import {
  Device
} from '@capacitor/device';

async function getDeviceInfo() {
  let info = await Device.getInfo();
  return info;
};

window.onload = start;
function start() {
  getDeviceInfo().then(info => {
    document.body.innerHTML = JSON.stringify(info, null, 4);
  });
}