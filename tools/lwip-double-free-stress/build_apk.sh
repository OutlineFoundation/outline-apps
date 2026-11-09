#!/usr/bin/env bash
# Builds the Capacitor Android debug APK from the current working tree and
# saves it as out/apks/<label>.apk, then prints which go-tun2socks module the
# bundled libgojni.so was built from. Run from anywhere; needs Node 22 on PATH
# (nvm use) and JDK 21.
#
# Usage: build_apk.sh <label>

set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../.." && pwd)"
label="${1:?usage: build_apk.sh <label>}"
mkdir -p "${here}/out/apks"

export JAVA_HOME="${JAVA_HOME_21:-$(/usr/libexec/java_home -v 21)}"
cd "${repo}"
npm run action client/capacitor/build android

apk="${here}/out/apks/${label}.apk"
cp client/capacitor/android/app/build/outputs/apk/debug/app-debug.apk "${apk}"
tmp="$(mktemp -d)"
unzip -q -o "${apk}" 'lib/arm64-v8a/libgojni.so' -d "${tmp}"
echo "== ${label}: go-tun2socks modules in libgojni.so (arm64)"
strings -a "${tmp}/lib/arm64-v8a/libgojni.so" \
  | grep -oE '(eycorsican|OutlineFoundation)/go-tun2socks(@v[^/]*)?' | sort | uniq -c
shasum -a 256 "${apk}" "${tmp}/lib/arm64-v8a/libgojni.so"
rm -rf "${tmp}"
