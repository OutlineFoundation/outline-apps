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

import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { getRootDir } from '@outline/infrastructure/build/get_root_dir.mjs';
import { runAction } from '@outline/infrastructure/build/run_action.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iosTemplatesRoot = resolve(__dirname, 'templates', 'ios');

function readTemplate(templateName) {
  return readFileSync(resolve(iosTemplatesRoot, templateName), 'utf8');
}

function fixCapAppPackageSwift() {
  const packageSwiftPath = resolve(
    __dirname,
    '../ios/App/CapApp-SPM/Package.swift'
  );

  try {
    const template = readTemplate('CapApp-SPM.Package.swift.template');
    writeFileSync(packageSwiftPath, template, 'utf8');
    console.log(' CapApp-SPM Package.swift restored from template');
  } catch (error) {
    console.error(' Failed to fix CapApp-SPM Package.swift:', error.message);
    process.exit(1);
  }
}

function fixCordovaPluginPackageSwift() {
  const packageSwiftPath = resolve(
    __dirname,
    '../ios/capacitor-cordova-ios-plugins/sources/CordovaPluginOutline/Package.swift'
  );

  if (!existsSync(packageSwiftPath)) {
    return;
  }

  try {
    const template = readTemplate(
      'CordovaPluginOutline.Package.swift.template'
    );
    writeFileSync(packageSwiftPath, template, 'utf8');
    console.log(
      ' CordovaPluginOutline Package.swift restored from template'
    );
  } catch (error) {
    console.error(
      ' Failed to fix CordovaPluginOutline Package.swift:',
      error.message
    );
  }
}

function fixOutlinePluginSwift() {
  const outlinePluginPath = resolve(
    __dirname,
    '../ios/capacitor-cordova-ios-plugins/sources/CordovaPluginOutline/OutlinePlugin.swift'
  );

  if (!existsSync(outlinePluginPath)) {
    return;
  }

  try {
    const template = readTemplate('OutlinePlugin.swift.template');
    writeFileSync(outlinePluginPath, template, 'utf8');
    console.log(' OutlinePlugin.swift restored from template');
  } catch (error) {
    console.error(' Failed to fix OutlinePlugin.swift:', error.message);
  }
}

async function checkTun2socksFramework() {
  const rootDir = getRootDir();
  const frameworkPath = resolve(
    rootDir,
    'output',
    'client',
    'apple',
    'Tun2socks.xcframework'
  );

  if (!existsSync(frameworkPath)) {
    console.warn('  Tun2socks.xcframework not found at:', frameworkPath);
    console.log('📦 Building Tun2socks.xcframework...');
    try {
      await runAction('client/go/build', 'ios');
      if (!existsSync(frameworkPath)) {
        throw new Error('XCFramework was not created after build');
      }
      console.log(' Tun2socks.xcframework built successfully!');
    } catch (error) {
      console.error(' Failed to build Tun2socks.xcframework:', error.message);
      console.error('💡 Please run: npm run action client/go/build ios');
      process.exit(1);
    }
  } else {
    console.log(' Tun2socks.xcframework found at:', frameworkPath);
  }

  const sourceRoot = resolve(__dirname, '../ios/App');
  const relativePath = '../../../../output/client/apple/Tun2socks.xcframework';
  const resolvedPath = resolve(sourceRoot, relativePath);

  if (!existsSync(resolvedPath)) {
    console.error(' Xcode project path resolution failed!');
    console.error(`   SOURCE_ROOT: ${sourceRoot}`);
    console.error(`   Resolved path: ${resolvedPath}`);
    console.error(`   Actual framework: ${frameworkPath}`);
    console.error('   The relative path in project.pbxproj may be incorrect.');
    throw new Error(`XCFramework not found at resolved path: ${resolvedPath}`);
  }

  console.log(' Xcode project path resolves correctly to:', resolvedPath);
}

function verifyVpnExtensionSetup() {
  const vpnExtensionPath = resolve(__dirname, '../ios/App/VpnExtension');
  const requiredFiles = [
    'Sources/PacketTunnelProvider.h',
    'Sources/PacketTunnelProvider.m',
    'Sources/PacketTunnelProvider.swift',
    'Sources/VpnExtension-Bridging-Header.h',
    'Info.plist',
    'VpnExtension.entitlements',
  ];

  const missingFiles = [];
  for (const file of requiredFiles) {
    const filePath = resolve(vpnExtensionPath, file);
    if (!existsSync(filePath)) {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    console.warn('  VPN Extension files missing:', missingFiles.join(', '));
    console.warn('   The VPN extension may not build correctly.');
  } else {
    console.log(' VPN Extension files verified');
  }
}

await checkTun2socksFramework();
verifyVpnExtensionSetup();

const syncProcess = spawn('npx', ['cap', 'sync', 'ios'], {
  cwd: join(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
});

syncProcess.on('close', async code => {
  fixCapAppPackageSwift();
  fixCordovaPluginPackageSwift();
  fixOutlinePluginSwift();
  console.log(' Capacitor sync completed');
});

syncProcess.on('error', error => {
  console.error(' Failed to start Capacitor sync:', error);
  process.exit(1);
});
