/**
 * Wrapper script for `npx cap sync android` that reapplies the Outline-specific
 * Android Gradle and source customisations after Capacitor regenerates them.
 */

import {spawn} from 'child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {dirname, relative, resolve} from 'path';
import {fileURLToPath} from 'url';

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

const settingsGradleContent = `include ':app'
include ':capacitor-cordova-android-plugins'
project(':capacitor-cordova-android-plugins').projectDir = new File('./capacitor-cordova-android-plugins/')
includeBuild '${relativeOutlineAndroidLibPath}'

apply from: 'capacitor.settings.gradle'
`;

const buildGradleContent = `// Top-level build file where you can add configuration options common to all sub-projects/modules.
buildscript {
    
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.3'
        classpath 'com.google.gms:google-services:4.4.2'
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.23"
    }
}

apply from: "variables.gradle"

allprojects {
    repositories {
        maven { url uri("$rootDir/../../../output/client/android") }
        google()
        mavenCentral()
    }

    tasks.withType(JavaCompile).configureEach {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    afterEvaluate { p ->
        if (p.extensions.findByName("android") != null) {
            p.extensions.getByName("android").compileOptions {
                sourceCompatibility = JavaVersion.VERSION_17
                targetCompatibility = JavaVersion.VERSION_17
            }
            def kotlinExt = p.extensions.findByName("kotlinOptions")
            if (kotlinExt != null) {
                kotlinExt.jvmTarget = "17"
            }
        }
    }
}

task clean(type: Delete) {
    delete rootProject.buildDir
}
`;

const appBuildGradleContent = `apply plugin: 'com.android.application'
apply plugin: 'org.jetbrains.kotlin.android'

android {
    namespace "org.outline.client"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "org.outline.client"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        aaptOptions {
             // Files and dirs to omit from the packaged assets dir, modified to accommodate modern web apps.
             // Default: https://android.googlesource.com/platform/frameworks/base/+/282e181b58cf72b6ca770dc7ca5f91f135444502/tools/aapt/AaptAssets.cpp#61
            ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~'
        }
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

repositories {
    // flatDir is used for Capacitor Cordova plugins that don't support Maven metadata
    // This warning can be safely ignored as it's required for plugin compatibility
    flatDir{
        dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "org.jetbrains.kotlin:kotlin-stdlib:1.9.23"
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
    implementation project(':capacitor-android')
    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
    implementation 'org.outline:outline:0.0'
    implementation('org.getoutline.client:tun2socks:0.0.1') {
        exclude group: 'com.android.support'
    }
    implementation 'io.sentry:sentry-android:2.0.2'
    implementation project(':capacitor-cordova-android-plugins')
}

apply from: 'capacitor.build.gradle'

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
`;

const androidManifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="org.outline.client">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CHANGE_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation"
            android:label="@string/title_activity_main"
            android:launchMode="singleTask"
            android:theme="@style/AppTheme.NoActionBarLaunch">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

        <service
            android:name="org.outline.vpn.VpnTunnelService"
            android:exported="false"
            android:foregroundServiceType="systemExempted"
            android:label="@string/app_name"
            android:permission="android.permission.BIND_VPN_SERVICE"
            android:process=":vpn">
            <intent-filter>
                <action android:name="android.net.VpnService" />
            </intent-filter>
        </service>

        <receiver
            android:name="org.outline.vpn.VpnServiceStarter"
            android:enabled="true"
            android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>

        <meta-data
            android:name="io.sentry.auto-init"
            android:value="false" />
    </application>

</manifest>
`;

function applyAndroidPatches() {
  writeFileSync(
    resolve(androidRoot, 'settings.gradle'),
    settingsGradleContent,
    'utf8'
  );
  writeFileSync(
    resolve(androidRoot, 'build.gradle'),
    buildGradleContent,
    'utf8'
  );
  writeFileSync(
    resolve(androidRoot, 'app', 'build.gradle'),
    appBuildGradleContent,
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

  const mainSrcDir = resolve(androidRoot, 'app', 'src');
  const manifestDir = resolve(mainSrcDir, 'main');
  mkdirSync(manifestDir, {recursive: true});
  writeFileSync(
    resolve(manifestDir, 'AndroidManifest.xml'),
    androidManifestContent,
    'utf8'
  );

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
