// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(name: "capacitor", path: "../../../../../node_modules/@capacitor/ios"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../../../node_modules/@capacitor/browser"),
        .package(name: "CapacitorSplashScreen", path: "../../../../../node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorPluginOutline", path: "../../../plugins/capacitor-plugin-outline")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorPluginOutline", package: "CapacitorPluginOutline")
            ]
        )
    ]
)
