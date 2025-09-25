// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OutlineGoPlugin",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "OutlineGoPlugin",
            targets: ["CapacitorGoPluginPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "CapacitorGoPluginPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CapacitorGoPluginPlugin"),
        .testTarget(
            name: "CapacitorGoPluginPluginTests",
            dependencies: ["CapacitorGoPluginPlugin"],
            path: "ios/Tests/CapacitorGoPluginPluginTests")
    ]
)