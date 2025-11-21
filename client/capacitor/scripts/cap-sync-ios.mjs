import {spawn} from 'child_process';
import {existsSync, readFileSync, writeFileSync} from 'fs';
import {rm} from 'fs/promises';
import {dirname, join, resolve} from 'path';
import {fileURLToPath} from 'url';

import {getRootDir} from '@outline/infrastructure/build/get_root_dir.mjs';
import {runAction} from '@outline/infrastructure/build/run_action.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function fixCapAppPackageSwift() {
  const packageSwiftPath = resolve(
    __dirname,
    '../ios/App/CapApp-SPM/Package.swift'
  );

  try {
    let content = readFileSync(packageSwiftPath, 'utf8');

    content = content.replace(
      /platforms: \[\.iOS\(\.v15\)\]/,
      'platforms: [.iOS("15.5")]'
    );

    content = content.replace(
      /,\s*\.package\(path: "\.\.\/\.\.\/\.\.\/\.\.\/capacitor\/plugins\/capacitor-plugin-outline\/ios"\)/g,
      ''
    );
    content = content.replace(
      /,\s*\.product\(name: "CapacitorPluginOutline", package: "ios"\)/g,
      ''
    );

    if (!content.includes('CocoaLumberjack')) {
      content = content.replace(
        /dependencies: \[\s*\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", exact: "[^"]+"\)/,
        `dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "6.2.1"),
        .package(url: "https://github.com/CocoaLumberjack/CocoaLumberjack.git", from: "3.8.5")`
      );
    }

    content = content.replace(
      /,\s*\.package\(path: "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/cordova\/apple\/OutlineAppleLib"\)/g,
      ''
    );

    if (
      !content.includes('CocoaLumberjack') &&
      content.includes('dependencies: [')
    ) {
      content = content.replace(
        /dependencies: \[\s*\.product\(name: "Capacitor", package: "capacitor-swift-pm"\),\s*\.product\(name: "Cordova", package: "capacitor-swift-pm"\)/,
        `dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CocoaLumberjack", package: "CocoaLumberjack"),
                .product(name: "CocoaLumberjackSwift", package: "CocoaLumberjack")`
      );
    }

    writeFileSync(packageSwiftPath, content, 'utf8');
    console.log(' CapApp-SPM Package.swift fixed');
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
    let content = readFileSync(packageSwiftPath, 'utf8');

    content = content.replace(
      /platforms: \[\.iOS\(\.v15\)\]/,
      'platforms: [.iOS("15.5")]'
    );

    if (!content.includes('CocoaLumberjack')) {
      content = content.replace(
        /dependencies: \[\s*\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", from: "6\.2\.1"\)/,
        `dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.2.1"),
        .package(url: "https://github.com/CocoaLumberjack/CocoaLumberjack.git", from: "3.8.5")`
      );
    }

    if (!content.includes('sentry-cocoa')) {
      content = content.replace(
        /dependencies: \[\s*\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", from: "6\.2\.1"\)/,
        `dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.2.1"),
        .package(url: "https://github.com/getsentry/sentry-cocoa", from: "8.26.0")`
      );
    }

    if (!content.includes('OutlineAppleLib')) {
      content = content.replace(
        /dependencies: \[\s*\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", from: "6\.2\.1"\)/,
        `dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "6.2.1"),
        .package(path: "../../../../../src/cordova/apple/OutlineAppleLib")`
      );
    }

    const targetDepsPattern = /dependencies:\s*\[([^\]]*)\]/;
    const targetMatch = content.match(
      /\.target\s*\(\s*name:\s*"CordovaPluginOutline",\s*dependencies:\s*\[([^\]]*)\]/s
    );
    if (targetMatch) {
      const existingDeps = targetMatch[1];
      let newDeps = '.product(name: "Cordova", package: "capacitor-swift-pm")';

      if (!existingDeps.includes('CocoaLumberjack')) {
        newDeps +=
          ',\n                .product(name: "CocoaLumberjack", package: "CocoaLumberjack"),\n                .product(name: "CocoaLumberjackSwift", package: "CocoaLumberjack")';
      }
      if (!existingDeps.includes('Sentry')) {
        newDeps +=
          ',\n                .product(name: "Sentry", package: "sentry-cocoa")';
      }
      if (!existingDeps.includes('OutlineAppleLib')) {
        newDeps +=
          ',\n                .product(name: "OutlineAppleLib", package: "OutlineAppleLib")';
      }

      content = content.replace(
        /\.target\s*\(\s*name:\s*"CordovaPluginOutline",\s*dependencies:\s*\[[^\]]*\]/s,
        `.target(
            name: "CordovaPluginOutline",
            dependencies: [
                ${newDeps}
            ]`
      );
    }

    writeFileSync(packageSwiftPath, content, 'utf8');
    console.log(' CordovaPluginOutline Package.swift fixed');
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
    let content = readFileSync(outlinePluginPath, 'utf8');

    content = content.replace(
      /(@objcMembers\s*\n\s*)+(@objc\(OutlinePlugin\)\s*\n\s*)+(@objcMembers\s*\n\s*)*(class|public class) OutlinePlugin: CDVPlugin/g,
      '@objc(OutlinePlugin)\n@objcMembers\n$4 OutlinePlugin: CDVPlugin'
    );
    content = content.replace(
      /(@objc\(OutlinePlugin\)\s*\n\s*)+(@objcMembers\s*\n\s*)+(@objc\(OutlinePlugin\)\s*\n\s*)*(class|public class) OutlinePlugin: CDVPlugin/g,
      '@objc(OutlinePlugin)\n@objcMembers\n$4 OutlinePlugin: CDVPlugin'
    );
    content = content.replace(
      /(@objcMembers\s*\n\s*)+(@objcMembers\s*\n\s*)*(class|public class) OutlinePlugin: CDVPlugin/g,
      '@objc(OutlinePlugin)\n@objcMembers\n$3 OutlinePlugin: CDVPlugin'
    );

    if (
      content.includes('class OutlinePlugin: CDVPlugin') ||
      content.includes('public class OutlinePlugin: CDVPlugin')
    ) {
      if (
        !content.match(
          /@objc\(OutlinePlugin\)\s*\n\s*@objcMembers\s*\n\s*(public )?class OutlinePlugin: CDVPlugin/
        )
      ) {
        content = content.replace(
          /((@objc\(OutlinePlugin\)\s*\n\s*)*(@objcMembers\s*\n\s*)*)(public )?class OutlinePlugin: CDVPlugin/,
          '@objc(OutlinePlugin)\n@objcMembers\n$4class OutlinePlugin: CDVPlugin'
        );
      }
    }

    if (
      content.includes('class OutlinePlugin: CDVPlugin') &&
      !content.includes('public class OutlinePlugin: CDVPlugin')
    ) {
      content = content.replace(
        /(@objc\(OutlinePlugin\)\s*\n\s*@objcMembers\s*\n\s*)class OutlinePlugin: CDVPlugin/,
        '$1public class OutlinePlugin: CDVPlugin'
      );
    }

    if (
      content.includes('override func pluginInitialize()') &&
      !content.includes('public override func pluginInitialize()')
    ) {
      content = content.replace(
        /(\s+)(override func pluginInitialize\(\))/,
        '$1public override func pluginInitialize()'
      );
    }

    writeFileSync(outlinePluginPath, content, 'utf8');
    console.log(' OutlinePlugin.swift fixed');
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

async function removePluginsFolder() {
  const pluginsPath = resolve(__dirname, '../ios/App/App/Plugins');

  try {
    await rm(pluginsPath, {recursive: true, force: true});
    console.log('Plugins folder removed successfully!');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(' Failed to remove Plugins folder:', error.message);
    }
  }
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

function backupProjectPbxproj() {
  const projectPbxprojPath = resolve(
    __dirname,
    '../ios/App/App.xcodeproj/project.pbxproj'
  );
  const backupPath = resolve(
    __dirname,
    '../ios/App/App.xcodeproj/project.pbxproj.backup'
  );

  try {
    if (existsSync(projectPbxprojPath)) {
      const currentContent = readFileSync(projectPbxprojPath, 'utf8');
      writeFileSync(backupPath, currentContent, 'utf8');
      console.log(
        ' Backed up working project.pbxproj (will restore after sync)'
      );
      return true;
    } else {
      console.warn('  project.pbxproj not found, cannot backup');
      return false;
    }
  } catch (error) {
    console.warn('  Could not backup project.pbxproj:', error.message);
    return false;
  }
}

async function restoreProjectPbxproj() {
  const projectPbxprojPath = resolve(
    __dirname,
    '../ios/App/App.xcodeproj/project.pbxproj'
  );
  const backupPath = resolve(
    __dirname,
    '../ios/App/App.xcodeproj/project.pbxproj.backup'
  );

  try {
    if (existsSync(backupPath)) {
      let backupContent = readFileSync(backupPath, 'utf8');

      backupContent = backupContent.replace(
        /relativePath = \.\.\/\.\.\/plugins\/apple\/OutlineAppleLib;/g,
        'relativePath = ../../../src/cordova/apple/OutlineAppleLib;'
      );

      if (!backupContent.includes('package = 6318D1DE2EB1235E006D5B40')) {
        backupContent = backupContent.replace(
          /(6318D1DF2EB1235E006D5B40 \/\* OutlineAppleLib \*\/ = \{[\s\S]*?isa = XCSwiftPackageProductDependency;)([\s\S]*?productName = OutlineAppleLib;)/,
          `$1
			package = 6318D1DE2EB1235E006D5B40 /* XCLocalSwiftPackageReference "../../../src/cordova/apple/OutlineAppleLib" */;$2`
        );
        backupContent = backupContent.replace(
          /(6318D1E12EB1235E006D5B40 \/\* OutlineVPNExtensionLib \*\/ = \{[\s\S]*?isa = XCSwiftPackageProductDependency;)([\s\S]*?productName = OutlineVPNExtensionLib;)/,
          `$1
			package = 6318D1DE2EB1235E006D5B40 /* XCLocalSwiftPackageReference "../../../src/cordova/apple/OutlineAppleLib" */;$2`
        );
      }

      backupContent = backupContent.replace(
        /XCLocalSwiftPackageReference "\.\.\/\.\.\/plugins\/apple\/OutlineAppleLib"/g,
        'XCLocalSwiftPackageReference "../../../src/cordova/apple/OutlineAppleLib"'
      );

      writeFileSync(projectPbxprojPath, backupContent, 'utf8');
      console.log(' Restored project.pbxproj to working version');

      try {
        await rm(backupPath);
      } catch (rmError) {}
      return true;
    } else {
      console.warn('  Backup file not found, cannot restore project.pbxproj');
      return false;
    }
  } catch (error) {
    console.error(' Could not restore project.pbxproj:', error.message);
    return false;
  }
}

await checkTun2socksFramework();
verifyVpnExtensionSetup();
const hadBackup = backupProjectPbxproj();

const syncProcess = spawn('npx', ['cap', 'sync', 'ios'], {
  cwd: join(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
});

syncProcess.on('close', async code => {
  if (code !== 0) {
    console.error(`\n❌ Capacitor sync failed with code ${code}`);
    if (hadBackup) {
      await restoreProjectPbxproj();
    }
    process.exit(code);
  }

  if (hadBackup) {
    await restoreProjectPbxproj();
  }

  fixCapAppPackageSwift();
  fixCordovaPluginPackageSwift();
  fixOutlinePluginSwift();
  await removePluginsFolder();
  console.log(' Capacitor sync completed');
});

syncProcess.on('error', error => {
  console.error(' Failed to start Capacitor sync:', error);
  process.exit(1);
});
