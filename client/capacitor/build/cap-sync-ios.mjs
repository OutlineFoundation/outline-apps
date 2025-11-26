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

function resizeSplashImages() {
    const splashImagesetPath = resolve(__dirname, '../ios/App/App/Assets.xcassets/Splash.imageset');
    
    if (!existsSync(splashImagesetPath)) {
        return false;
    }
    
    try {
        const images = [
            'Default@1x~universal~anyany.png',
            'Default@1x~universal~anyany-dark.png',
            'Default@2x~universal~anyany.png',
            'Default@2x~universal~anyany-dark.png',
            'Default@3x~universal~anyany.png',
            'Default@3x~universal~anyany-dark.png'
        ];
        
        let resized = false;
        for (const image of images) {
            const imagePath = resolve(splashImagesetPath, image);
            if (existsSync(imagePath)) {
                try {
                    const sizeInfo = execSync(`sips -g pixelWidth "${imagePath}"`, { encoding: 'utf8' });
                    const widthMatch = sizeInfo.match(/pixelWidth: (\d+)/);
                    if (widthMatch) {
                        const width = parseInt(widthMatch[1]);
                        if (image.includes('@1x')) {
                            if (width > 512) {
                                execSync(`sips -Z 512 "${imagePath}"`, { stdio: 'ignore' });
                                resized = true;
                            }
                        } else if (image.includes('@2x')) {
                            if (width > 1024) {
                                execSync(`sips -Z 1024 "${imagePath}"`, { stdio: 'ignore' });
                                resized = true;
                            }
                        } else if (image.includes('@3x')) {
                            if (width > 1536) {
                                execSync(`sips -Z 1536 "${imagePath}"`, { stdio: 'ignore' });
                                resized = true;
                            }
                        }
                    }
                } catch (error) {
                }
            }
        }
        
        if (resized) {
            console.log(' Resized splash images to meet iOS launch screen memory limits');
        }
        return resized;
    } catch (error) {
        console.warn('  Could not resize splash images:', error.message);
        return false;
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
  resizeSplashImages();
  fixCapAppPackageSwift();
  fixCordovaPluginPackageSwift();
  console.log(' Capacitor sync completed');
});

syncProcess.on('error', error => {
  console.error(' Failed to start Capacitor sync:', error);
  process.exit(1);
});
