// Copyright 2025 The Outline Authors
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

/**
 * Wrapper script for `npx cap sync android` that reapplies the Outline-specific
 * Android Gradle and source customisations after Capacitor regenerates them.
 */

import { spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const capacitorRoot = resolve(__dirname, '..');
const androidRoot = resolve(capacitorRoot, 'android');
const outlineAndroidLibRoot = resolve(
  capacitorRoot,
  '..',
  'src',
  'cordova',
  'android',
  'OutlineAndroidLib'
);

const relativeOutlineAndroidLibPath = relative(
  androidRoot,
  outlineAndroidLibRoot
);

const templatesRoot = resolve(__dirname, 'templates', 'android');

const settingsGradleTemplate = readFileSync(
  resolve(templatesRoot, 'settings.gradle.template'),
  'utf8'
);
const buildGradleTemplate = readFileSync(
  resolve(templatesRoot, 'build.gradle.template'),
  'utf8'
);
const appBuildGradleTemplate = readFileSync(
  resolve(templatesRoot, 'app.build.gradle.template'),
  'utf8'
);

function applyAndroidPatches() {
  const settingsGradleContent = settingsGradleTemplate.replace(
    '__OUTLINE_ANDROID_LIB_PATH__',
    relativeOutlineAndroidLibPath
  );
  writeFileSync(
    resolve(androidRoot, 'settings.gradle'),
    settingsGradleContent,
    'utf8'
  );
  writeFileSync(
    resolve(androidRoot, 'build.gradle'),
    buildGradleTemplate,
    'utf8'
  );
  writeFileSync(
    resolve(androidRoot, 'app', 'build.gradle'),
    appBuildGradleTemplate,
    'utf8'
  );

  const originalBuildExtrasPath = resolve(
    capacitorRoot,
    '..',
    'src',
    'cordova',
    'plugin',
    'android',
    'build-extras.gradle'
  );
  let buildExtrasContent = readFileSync(originalBuildExtrasPath, 'utf8');
  buildExtrasContent = buildExtrasContent.replace(
    /url = uri\(layout\.settingsDirectory\.dir\("\.\.\/\.\.\/\.\.\/output\/client\/android"\)\)/,
    'url = uri("${rootProject.projectDir}/../../../output/client/android")'
  );
  buildExtrasContent = buildExtrasContent.replace(
    / {2}implementation 'com\.android\.support:appcompat-v7:23\.4\.0'\n/,
    ''
  );
  buildExtrasContent = buildExtrasContent.replace(
    / {2}implementation 'org\.getoutline\.client:tun2socks:0\.0\.1'/,
    `  implementation('org.getoutline.client:tun2socks:0.0.1') {
    exclude group: 'com.android.support'
  }`
  );

  buildExtrasContent = buildExtrasContent.replace(
    / {2}\/\/ From public Maven\./,
    `  // From public Maven.
  // Note: AndroidX dependencies (like appcompat) are provided by Capacitor`
  );

  const capacitorBuildGradlePath = resolve(
    androidRoot,
    'app',
    'capacitor.build.gradle'
  );
  try {
    let capacitorBuildGradleContent = readFileSync(
      capacitorBuildGradlePath,
      'utf8'
    );
    capacitorBuildGradleContent = capacitorBuildGradleContent.replace(
      /apply from: "\.\.\/\.\.\/\.\.\/src\/cordova\/plugin\/android\/build-extras\.gradle"/,
      buildExtrasContent
    );
    writeFileSync(
      capacitorBuildGradlePath,
      capacitorBuildGradleContent,
      'utf8'
    );
    console.log(
      'Patched capacitor.build.gradle with Capacitor-compatible build-extras.'
    );
  } catch (error) {
    console.warn('Could not patch capacitor.build.gradle:', error.message);
  }

  const cordovaPluginsBuildGradlePath = resolve(
    androidRoot,
    'capacitor-cordova-android-plugins',
    'build.gradle'
  );
  try {
    let cordovaPluginsBuildGradleContent = readFileSync(
      cordovaPluginsBuildGradlePath,
      'utf8'
    );
    cordovaPluginsBuildGradleContent = cordovaPluginsBuildGradleContent.replace(
      /apply from: "\.\.\/\.\.\/\.\.\/src\/cordova\/plugin\/android\/build-extras\.gradle"/,
      buildExtrasContent
    );
    writeFileSync(
      cordovaPluginsBuildGradlePath,
      cordovaPluginsBuildGradleContent,
      'utf8'
    );
    console.log(
      'Patched capacitor-cordova-android-plugins/build.gradle with Capacitor-compatible build-extras.'
    );
  } catch (error) {
    console.warn(
      'Could not patch capacitor-cordova-android-plugins/build.gradle:',
      error.message
    );
  }

  console.log('Applied Outline Android Gradle and source customisations.');
}

async function syncAndroid() {
  return new Promise((resolve, reject) => {
    const syncProcess = spawn('npx', ['cap', 'sync', 'android'], {
      cwd: capacitorRoot,
      stdio: 'inherit',
      shell: true,
    });

    syncProcess.on('close', code => {
      if (code !== 0) {
        console.error(`\nCapacitor sync failed with code ${code}`);
        reject(new Error(`Capacitor sync failed with code ${code}`));
        return;
      }

      try {
        applyAndroidPatches();
        resolve();
      } catch (error) {
        console.error(
          'Failed to apply Outline Android patches:',
          error.message
        );
        reject(error);
      }
    });

    syncProcess.on('error', error => {
      console.error('Failed to start Capacitor sync:', error);
      reject(error);
    });
  });
}

await syncAndroid();
