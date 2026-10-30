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
  // Ignore SIGPIPE so that writing to a socket or pipe whose peer has gone away (e.g. sockets
  // reclaimed by iOS while the app was suspended, or IPC with terminated WebKit processes)
  // fails with EPIPE instead of terminating the app. This must run before the Go runtime
  // (Tun2socks) is used, so that it observes SIGPIPE as ignored and does not forward it to the
  // default (fatal) handler.
  signal(SIGPIPE, SIG_IGN);

#if TARGET_OS_MACCATALYST
    [OutlineCatalystApp initApp];
#endif

  [super application:application didFinishLaunchingWithOptions:launchOptions];

  return YES;
}

@end
