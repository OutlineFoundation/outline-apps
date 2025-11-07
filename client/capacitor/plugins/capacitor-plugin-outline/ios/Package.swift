// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorPluginOutline",
    platforms: [.iOS("15.5")],
    products: [
        .library(
            name: "CapacitorPluginOutline",
            targets: ["CapacitorPluginOutline"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "6.2.1"),
        .package(path: "../../apple/OutlineAppleLib")
    ],
    targets: [
        .target(
            name: "CapacitorPluginOutline",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "OutlineAppleLib", package: "OutlineAppleLib")
            ],
            path: "Sources/CapacitorPluginOutline"
        )
    ]
)

