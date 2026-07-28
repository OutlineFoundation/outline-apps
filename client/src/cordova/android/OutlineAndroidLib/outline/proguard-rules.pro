# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Keep rules for the library's own R8 pass (this module builds with
# minifyEnabled). These replace a blunt `-keep class org.outline.** { *; }`.
# Outline classes cross boundaries R8 cannot see, so keep the surface that must
# survive; unlisted, purely-internal members may be shrunk.
#
# NOTE: keep rules that must reach the *consuming* app's R8 run (Cordova
# plugins, gomobile/JNI, AIDL/Parcelable, manifest components) live in
# consumer-rules.pro. This file is only the library-module pass.

# API the Cordova app module (OutlinePlugin) links against by name. The two
# public enums are nested types (separate classes for R8), so they need their
# own keep rules; the private nested helpers (NetworkConnectivityMonitor,
# Subnet) are internal and left shrinkable.
-keep class org.outline.vpn.VpnTunnelService { *; }
-keep class org.outline.vpn.VpnTunnelService$MessageData { *; }
-keep class org.outline.vpn.VpnTunnelService$TunnelStatus { *; }
-keep class org.outline.vpn.VpnServiceStarter { *; }
-keep class org.outline.vpn.Errors { *; }
-keep class org.outline.log.OutlineLogger { *; }
-keep class org.outline.log.SentryErrorReporter { *; }

# Bound by the system via the merged manifest.
-keep class org.outline.vpn.QuickSettingsTileService { *; }

# AIDL interface (Stub/Proxy) and Parcelable data classes crossing the :vpn
# process boundary.
-keep class org.outline.IVpnTunnelService { *; }
-keep class org.outline.IVpnTunnelService$* { *; }
-keep class org.outline.TunnelConfig { *; }
-keep class org.outline.DetailedJsonError { *; }

# Internal helper, but it derives a SharedPreferences store name from its own
# class name at runtime (VpnTunnelStore.class.getName()); obfuscating the name
# would orphan users' persisted data across an update. Pin the name; allow
# member shrinking.
-keepnames class org.outline.vpn.VpnTunnelStore
