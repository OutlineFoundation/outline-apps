// swift-tools-version:5.9

// Copyright 2026 The Outline Authors
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

// Local replacement for https://github.com/ionic-team/capacitor-swift-pm.
//
// Capacitor's own SPM package vends prebuilt Capacitor.xcframework and
// Cordova.xcframework with iOS and iOS Simulator slices only, which cannot
// link a Mac Catalyst app. This package has the same name and products, so
// Xcode uses it in place of the remote package for every package in the
// graph that depends on "capacitor-swift-pm" (CapApp-SPM and the Capacitor
// plugins). The xcframeworks it vends are built from the same Capacitor
// sources by build_xcframeworks.sh, with a Mac Catalyst slice added.

import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(
            name: "Capacitor",
            targets: ["Capacitor"]
        ),
        .library(
            name: "Cordova",
            targets: ["Cordova"]
        )
    ],
    dependencies: [],
    targets: [
        .binaryTarget(
            name: "Capacitor",
            path: "Capacitor.xcframework"
        ),
        .binaryTarget(
            name: "Cordova",
            path: "Cordova.xcframework"
        )
    ]
)
