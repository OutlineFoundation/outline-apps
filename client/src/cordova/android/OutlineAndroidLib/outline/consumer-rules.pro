# Consumer ProGuard/R8 rules for OutlineAndroidLib.
#
# These rules are packaged into the library's AAR and applied to the R8 run of
# any module that consumes it -- most importantly the Cordova-generated app
# module, which now shrinks with R8 (see build-extras.gradle). They keep every
# type that R8 cannot see is reachable because it is instantiated reflectively,
# bound over JNI, referenced from the manifest, or crosses the AIDL boundary.
#
# When adding code that is only reachable via one of those mechanisms, add a
# keep rule here.

# --- Cordova plugin entry points -------------------------------------------
# CordovaLib instantiates plugins by class name from config.xml (reflection),
# so keep every plugin class and its no-arg constructor. This covers
# org.outline.OutlinePlugin (which lives in the app module) as well as the
# third-party Cordova plugins we bundle.
-keep public class * extends org.apache.cordova.CordovaPlugin { public <init>(); }

# The Cordova framework itself is pervasively reflective: MainActivity.onCreate
# instantiates the WebView engine via
# SystemWebViewEngine(Context, CordovaPreferences) looked up with
# getConstructor(), config values are resolved by class name, etc. Without this
# R8 renames/removes those members and the app crashes on launch with
# "Failed to create webview" (NoSuchMethodException on the constructor). Keep
# the whole framework -- narrower rules just turn into launch-time whack-a-mole.
-keep class org.apache.cordova.** { *; }

# --- gomobile / tun2socks (JNI) --------------------------------------------
# The gomobile-generated bindings and the Go runtime call back into these
# classes by name over JNI; obfuscating or removing them breaks the tunnel.
-keep class tun2socks.** { *; }
-keep class go.** { *; }

# Keep every native method and the class that declares it.
-keepclasseswithmembernames class * {
  native <methods>;
}

# --- AIDL / Parcelable boundary --------------------------------------------
# The VPN service runs in a separate (:vpn) process and communicates over AIDL.
# Keep the generated interface (Stub/Proxy) and the Parcelable data classes,
# including their CREATOR fields.
-keep class org.outline.IVpnTunnelService { *; }
-keep class org.outline.IVpnTunnelService$* { *; }
-keep class org.outline.TunnelConfig { *; }
-keep class org.outline.DetailedJsonError { *; }

-keepclassmembers class * implements android.os.Parcelable {
  public static final android.os.Parcelable$Creator CREATOR;
}

# --- Manifest-declared components ------------------------------------------
# AGP already generates keep rules for classes named in the merged manifest,
# but keep them explicitly so the contract is visible and robust to manifest
# processing changes. These are the VPN service (bound by the system and by
# OutlinePlugin), its boot/replace receiver, and the Quick Settings tile.
-keep class org.outline.vpn.VpnTunnelService { *; }
-keep class org.outline.vpn.VpnServiceStarter { *; }
-keep class org.outline.vpn.QuickSettingsTileService { *; }
