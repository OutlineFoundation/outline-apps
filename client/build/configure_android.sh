#!/usr/bin/env bash
# Copyright 2025 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

main() {
    declare java_home android_home android_ndk
    # Note: JAVA_HOME_17_{X64,arm64} are variables provided by the Github runners, so we add them here for convenience.
    case "$(uname)" in
        'Linux')
        java_home="${JAVA_HOME_17_X64:-${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}}"
        android_home="${ANDROID_HOME:-${HOME}/Android/Sdk}"
        ;;
        'Darwin')
        java_home="${JAVA_HOME_17_arm64:-${JAVA_HOME:-$(/usr/libexec/java_home -v 17.0)}}"
        android_home="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
        ;;
        'MINGW64_NT'* | 'CYGWIN'* | 'Windows_NT')
        # Assuming a bash-like shell (e.g., Git Bash) is used on Windows
        java_home="${JAVA_HOME_17_X64:-${JAVA_HOME:-C:/Program Files/Java/jdk-17}}"
        android_home="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
        ;;
    esac

    # Get the latest NDK
    for candidate in "${ANDROID_NDK}" "$(ls -d "${android_home}"/ndk/* | sort -V | tail -n 1)" "${android_home}/ndk-bundle"; do
        if [[ -d "$candidate" ]]; then
        android_ndk="$candidate"
        break
        fi
    done

    if [[ -d "$android_home" ]]; then
        echo "ANDROID_HOME=$android_home"
    fi
    if [[ -d "$android_ndk" ]]; then
        echo "ANDROID_NDK=$android_ndk"
    fi
    if [[ -d "$java_home" ]]; then
        echo "JAVA_HOME=$java_home"
    fi
}

main
