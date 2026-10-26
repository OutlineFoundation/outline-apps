#!/usr/bin/env bash
#
# Copyright 2026 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Builds Capacitor.xcframework and Cordova.xcframework from the Capacitor
# sources, with a Mac Catalyst slice, into this directory.
#
# The upstream binary package (ionic-team/capacitor-swift-pm) ships iOS and
# iOS Simulator slices only, so it cannot link a Mac Catalyst app. This
# replicates its `build-cap` script (archive each scheme per platform, then
# `xcodebuild -create-xcframework`) and adds the
# "generic/platform=macOS,variant=Mac Catalyst" destination. The version is the
# installed @capacitor/ios npm package, so the frameworks match the JavaScript
# runtime that `cap sync` copies into the app.
#
# Usage: build_xcframeworks.sh [--force]
#
# Outputs (gitignored): ./Capacitor.xcframework, ./Cordova.xcframework and
# ./.built-version. Intermediate clones and archives live under
# output/client/apple/capacitor-xcframeworks/.
#
# If CAPACITOR_XCFRAMEWORK_SIGNING_IDENTITY is set (for example
# "Developer ID Application: Outline Foundation (WP4DKSWWZM)"), the
# xcframeworks are code signed with it. Capacitor is on Apple's list of
# privacy-impacting SDKs, for which App Store Connect expects a signature on
# the SDK binary; Xcode records the xcframework's signature in the archive
# (Signatures/*.signature), and the upstream package carries Ionic's. Release
# builds should set this; unsigned xcframeworks still build fine.

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$PACKAGE_DIR/../../../.." && pwd)"
WORK_DIR="$ROOT_DIR/output/client/apple/capacitor-xcframeworks"
FORCE="${1:-}"

VERSION="$(cd "$ROOT_DIR/client/capacitor" && node -p "require('@capacitor/ios/package.json').version")"
STAMP="$PACKAGE_DIR/.built-version"
STAMP_VALUE="$VERSION signed=${CAPACITOR_XCFRAMEWORK_SIGNING_IDENTITY:+yes}"

if [[ "$FORCE" != "--force" && -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_VALUE" \
      && -d "$PACKAGE_DIR/Capacitor.xcframework" && -d "$PACKAGE_DIR/Cordova.xcframework" ]]; then
  echo "Capacitor $VERSION xcframeworks are up to date in $PACKAGE_DIR"
  exit 0
fi

SRC_DIR="$WORK_DIR/capacitor-$VERSION"
if [[ ! -d "$SRC_DIR/ios/Capacitor" ]]; then
  rm -rf "$SRC_DIR"
  mkdir -p "$WORK_DIR"
  # The npm package ships the sources but not the Xcode projects, so fetch
  # the tagged release (ios/ only).
  git clone --quiet --depth 1 --branch "$VERSION" --filter=blob:none --sparse \
    https://github.com/ionic-team/capacitor.git "$SRC_DIR"
  git -C "$SRC_DIR" sparse-checkout set ios
fi

# Sanity check: the sources we compile are the ones npm installed.
diff -rq "$ROOT_DIR/client/node_modules/@capacitor/ios/Capacitor/Capacitor" "$SRC_DIR/ios/Capacitor/Capacitor" >/dev/null
diff -rq "$ROOT_DIR/client/node_modules/@capacitor/ios/CapacitorCordova/CapacitorCordova" "$SRC_DIR/ios/CapacitorCordova/CapacitorCordova" >/dev/null

BUILD_DIR="$WORK_DIR/build-$VERSION"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

archive() {
  local scheme="$1" slice="$2" destination="$3"
  xcodebuild archive \
    -workspace "$SRC_DIR/ios/Capacitor/Capacitor.xcworkspace" \
    -scheme "$scheme" \
    -destination "$destination" \
    -configuration Release \
    -archivePath "$BUILD_DIR/$scheme-$slice" \
    -quiet \
    SKIP_INSTALL=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=YES \
    SUPPORTS_MACCATALYST=YES \
    SWIFT_SERIALIZE_DEBUGGING_OPTIONS=NO \
    DEBUG_INFORMATION_FORMAT=dwarf-with-dsym \
    CODE_SIGN_IDENTITY= \
    CODE_SIGNING_ALLOWED=NO
  # Drop nested frameworks the archive may carry (as upstream does).
  rm -rf "$BUILD_DIR/$scheme-$slice.xcarchive/Products/Library/Frameworks/$scheme.framework/Frameworks"
}

create_xcframework() {
  local scheme="$1"
  local args=()
  for slice in iOS iOS-Simulator MacCatalyst; do
    args+=(-framework "$BUILD_DIR/$scheme-$slice.xcarchive/Products/Library/Frameworks/$scheme.framework")
    args+=(-debug-symbols "$BUILD_DIR/$scheme-$slice.xcarchive/dSYMs/$scheme.framework.dSYM")
  done
  rm -rf "$PACKAGE_DIR/$scheme.xcframework"
  xcodebuild -create-xcframework "${args[@]}" -output "$PACKAGE_DIR/$scheme.xcframework"
  if [[ -n "${CAPACITOR_XCFRAMEWORK_SIGNING_IDENTITY:-}" ]]; then
    codesign --timestamp -s "$CAPACITOR_XCFRAMEWORK_SIGNING_IDENTITY" "$PACKAGE_DIR/$scheme.xcframework"
  fi
}

for scheme in Capacitor Cordova; do
  echo "Archiving $scheme $VERSION (iOS, iOS Simulator, Mac Catalyst)..."
  archive "$scheme" iOS "generic/platform=iOS"
  archive "$scheme" iOS-Simulator "generic/platform=iOS Simulator"
  archive "$scheme" MacCatalyst "generic/platform=macOS,variant=Mac Catalyst"
  create_xcframework "$scheme"
done

echo "$STAMP_VALUE" > "$STAMP"
echo "Built Capacitor $VERSION xcframeworks into $PACKAGE_DIR"
