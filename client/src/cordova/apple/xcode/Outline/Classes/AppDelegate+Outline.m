// Copyright 2023 The Outline Authors
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

#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <signal.h>
#import "AppDelegate+Outline.h"
#import "Outline-Swift.h"

#if TARGET_OS_MACCATALYST
@import OutlineCatalystApp;
@import ServiceManagement;
#endif

@implementation AppDelegate (Outline)

#pragma mark - Lifecycle

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:
        (NSDictionary<UIApplicationLaunchOptionsKey, id> *)launchOptions {
  // Sockets owned by this process (Go/Tun2socks fetches, WebKit, Sentry
  // uploads) can be torn down by the OS when the VPN starts or the app is
  // suspended. Without this, a later write to such a socket raises SIGPIPE,
  // whose default action terminates the app. Ignoring it makes the write fail
  // with EPIPE instead, which callers already handle as a regular error.
  // Other fatal signals remain handled and reported by Sentry.
  signal(SIGPIPE, SIG_IGN);

#if TARGET_OS_MACCATALYST
    [OutlineCatalystApp initApp];
#endif

  [super application:application didFinishLaunchingWithOptions:launchOptions];

  return YES;
}

@end
