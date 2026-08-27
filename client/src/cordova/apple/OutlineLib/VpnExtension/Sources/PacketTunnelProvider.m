// Copyright 2018 The Outline Authors
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

#import "PacketTunnelProvider.h"
#import "VpnExtension-Swift.h"

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <netdb.h>

@import Tun2socks;

#ifdef DEBUG
const DDLogLevel ddLogLevel = DDLogLevelDebug;
#else
const DDLogLevel ddLogLevel = DDLogLevelInfo;
#endif

NSString *const kDefaultPathKey = @"defaultPath";

@interface PacketTunnelProvider ()<Tun2socksTunWriter>
@property Tun2socksRemoteDevice *remoteDevice;
@property (nonatomic, copy) void (^startCompletion)(NSNumber *);
@property (nonatomic, copy) void (^stopCompletion)(NSNumber *);
@property (nonatomic) DDFileLogger *fileLogger;
@property (nonatomic, nullable) NSString *tunnelId;
@property (nonatomic, nullable) NSString *transportConfig;
@property (nonatomic) dispatch_queue_t packetQueue;
// Device replacement, packet writes and prepared-switch state belong to packetQueue.
@property (nonatomic) BOOL stopping;
@property (nonatomic) NSUInteger sessionGeneration;
@property (nonatomic, nullable) NSString *preparedToken;
@property (nonatomic, nullable) NSString *preparedId;
@property (nonatomic, nullable) NSString *preparedTransport;
@property (nonatomic, nullable) OutlineClient *preparedClient;
@property (nonatomic, nullable) NSString *committedToken;
@end

@implementation PacketTunnelProvider

- (id)init {
  self = [super init];
  NSString *appGroup = @"group.org.getoutline.client";
  NSURL *containerUrl = [[NSFileManager defaultManager]
                         containerURLForSecurityApplicationGroupIdentifier:appGroup];
  NSString *logsDirectory = [[containerUrl path] stringByAppendingPathComponent:@"Logs"];
  id<DDLogFileManager> logFileManager = [[DDLogFileManagerDefault alloc]
                                         initWithLogsDirectory:logsDirectory];
  _fileLogger = [[DDFileLogger alloc] initWithLogFileManager:logFileManager];
  [DDLog addLogger:[DDOSLogger sharedInstance]];
  [DDLog addLogger:_fileLogger];

  _packetQueue = dispatch_queue_create("org.getoutline.packetqueue", DISPATCH_QUEUE_SERIAL);

  return self;
}

- (void)startTunnelWithOptions:(NSDictionary *)options
             completionHandler:(void (^)(NSError *))completion {
  dispatch_async(self.packetQueue, ^{
    self.stopping = NO;
    self.sessionGeneration++;
    self.committedToken = nil;
    [self startTunnelOnPacketQueueWithOptions:options completionHandler:completion];
  });
}

- (void)startTunnelOnPacketQueueWithOptions:(NSDictionary *)options
                        completionHandler:(void (^)(NSError *))completion {
  DDLogInfo(@"Starting tunnel");
  DDLogDebug(@"Options are %@", options);

  // mimics fetchLastDisconnectErrorWithCompletionHandler on older systems
  void (^startDone)(NSError *) = ^(NSError *err) {
    [SwiftBridge saveLastErrorWithNsError:err];
    completion(err);
  };

  // MARK: Process Config.
  if (self.protocolConfiguration == nil) {
    DDLogError(@"Failed to retrieve NETunnelProviderProtocol.");
    return startDone([SwiftBridge newInvalidConfigOutlineErrorWithMessage:@"no config specified"]);
  }
  NETunnelProviderProtocol *protocol = (NETunnelProviderProtocol *)self.protocolConfiguration;
  NSDictionary *configuration = protocol.providerConfiguration;
  NSDictionary *pending = configuration[@"pendingSwitch"];
  if ([pending isKindOfClass:[NSDictionary class]] &&
      [pending[@"token"] isKindOfClass:[NSString class]] &&
      [pending[@"token"] isEqual:[SwiftBridge lastCommittedSwitchToken]]) {
    configuration = pending;
    self.committedToken = pending[@"token"];
  }
  NSString *tunnelId = configuration[@"id"];
  if (![tunnelId isKindOfClass:[NSString class]]) {
    DDLogError(@"Failed to retrieve the tunnel id.");
    return startDone([SwiftBridge newInternalOutlineErrorWithMessage:@"no tunnal ID specified"]);
  }

  NSString *transportConfig = configuration[@"transport"];
  if (![transportConfig isKindOfClass:[NSString class]]) {
    DDLogError(@"Failed to retrieve the transport configuration.");
    return startDone([SwiftBridge newInvalidConfigOutlineErrorWithMessage:@"config is not a String"]);
  }
  self.tunnelId = tunnelId;
  self.transportConfig = transportConfig;

  // startTunnel has 3 cases:
  // - When started from the app, we get options != nil, with no ["is-on-demand"] entry.
  // - When started on-demand, we get option != nil, with ["is-on-demand"] = 1;.
  // - When started from the VPN settings, we get options == nil
  NSNumber *isOnDemandNumber = options == nil ? nil : options[@"is-on-demand"];
  bool isOnDemand = isOnDemandNumber != nil && [isOnDemandNumber intValue] == 1;
  DDLogDebug(@"isOnDemand is %d", isOnDemand);

  BOOL isRestart = self.remoteDevice != nil;
  if (isRestart) {
    [self.remoteDevice close];
  }
  DDLogDebug(@"isRestart is %d", isRestart);

  PlaterrorsPlatformError *deviceErr = [self connectRemoteDevice:isOnDemand];
  if (deviceErr != nil) {
    return startDone([SwiftBridge newOutlineErrorFromPlatformError:deviceErr]);
  }

  NSUInteger generation = self.sessionGeneration;
  [self startRouting:[SwiftBridge getTunnelNetworkSettings]
          completion:^(NSError *_Nullable error) {
            if (self.stopping || self.sessionGeneration != generation) {
              return startDone([SwiftBridge newInternalOutlineErrorWithMessage:@"VPN start cancelled"]);
            }
            if (error != nil) {
              return startDone([SwiftBridge newOutlineErrorFromNsError:error]);
            }
            PlaterrorsPlatformError *relayErr = [self relayTraffic:isRestart];
            if (relayErr != nil) {
              return startDone([SwiftBridge newOutlineErrorFromPlatformError:relayErr]);
            }
            [self listenForNetworkChanges];
            startDone(nil);
          }];
}

- (void)stopTunnelWithReason:(NEProviderStopReason)reason
           completionHandler:(void (^)(void))completionHandler {
  dispatch_async(self.packetQueue, ^{
    DDLogInfo(@"Stopping tunnel, reason: %ld", (long)reason);
    self.stopping = YES;
    self.sessionGeneration++;
    [self discardPreparedSwitch];
    [self stopListeningForNetworkChanges];
    PlaterrorsPlatformError *err = [self.remoteDevice close];
    self.remoteDevice = nil;
    if (err != nil) {
      DDLogWarn(@"Failed to close remote device: %@", err.error);
    }
    completionHandler();
  });
}

# pragma mark - Network

- (void)startRouting:(NEPacketTunnelNetworkSettings *)settings
           completion:(void (^)(NSError *))completionHandler {
  NSUInteger generation = self.sessionGeneration;
  __weak typeof(self) weakSelf = self;
  [self setTunnelNetworkSettings:settings completionHandler:^(NSError * _Nullable error) {
    typeof(self) strongSelf = weakSelf;
    if (strongSelf == nil) {
      return completionHandler(error);
    }
    dispatch_async(strongSelf.packetQueue, ^{
      if (!strongSelf.stopping && strongSelf.sessionGeneration == generation && error == nil) {
        DDLogInfo(@"Routing started");
        strongSelf.reasserting = strongSelf.remoteDevice == nil;
      }
      completionHandler(error);
    });
  }];
}

// Registers KVO for the `defaultPath` property to receive network connectivity changes.
- (void)listenForNetworkChanges {
  [self stopListeningForNetworkChanges];
  [self addObserver:self
         forKeyPath:kDefaultPathKey
            options:NSKeyValueObservingOptionOld
            context:nil];
}

// Unregisters KVO for `defaultPath`.
- (void)stopListeningForNetworkChanges {
  @try {
    [self removeObserver:self forKeyPath:kDefaultPathKey];
  } @catch (id exception) {
    // Observer not registered, ignore.
  }
}

- (void)observeValueForKeyPath:(nullable NSString *)keyPath
                      ofObject:(nullable id)object
                        change:(nullable NSDictionary<NSString *, id> *)change
                       context:(nullable void *)context {
  if (![kDefaultPathKey isEqualToString:keyPath]) {
    return;
  }
  // Since iOS 11, we have observed that this KVO event fires repeatedly when connecting over Wifi,
  // even though the underlying network has not changed (i.e. `isEqualToPath` returns false),
  // leading to "wakeup crashes" due to excessive network activity. Guard against false positives by
  // comparing the paths' string description, which includes properties not exposed by the class.
  NWPath *lastPath = change[NSKeyValueChangeOldKey];
  if (lastPath == nil || [lastPath isEqualToPath:self.defaultPath] ||
      [lastPath.description isEqualToString:self.defaultPath.description]) {
    return;
  }

  dispatch_async(self.packetQueue, ^{
    [self handleNetworkChange:self.defaultPath];
  });
}

- (void)handleNetworkChange:(NWPath *)newDefaultPath {
  if (self.stopping) {
    return;
  }
  DDLogInfo(@"Network connectivity changed");
  if (newDefaultPath.status == NWPathStatusSatisfied) {
    [self.remoteDevice notifyNetworkChanged];
    [self reconnectTunnel];
  } else {
    // Keep routes and DNS installed while offline. Clearing them opens a direct
    // network window when the underlying network returns.
    self.reasserting = YES;
  }
}

/**
 Converts a struct sockaddr address |sa| to a string. Expects |maxbytes| to be allocated for |s|.
 @return whether the operation succeeded.
*/
bool getIpAddressString(const struct sockaddr *sa, char *s, socklen_t maxbytes) {
  if (!sa || !s) {
    DDLogError(@"Failed to get IP address string: invalid argument");
    return false;
  }
  switch (sa->sa_family) {
    case AF_INET:
      inet_ntop(AF_INET, &(((struct sockaddr_in *)sa)->sin_addr), s, maxbytes);
      break;
    case AF_INET6:
      inet_ntop(AF_INET6, &(((struct sockaddr_in6 *)sa)->sin6_addr), s, maxbytes);
      break;
    default:
      DDLogError(@"Cannot get IP address string: unknown address family");
      return false;
  }
  return true;
}

#pragma mark - tun2socks

/** Restarts tun2socks if |configChanged| or the host's IP address has changed in the network. */
- (void)reconnectTunnel {
  if (!self.transportConfig || !self.remoteDevice) {
    DDLogError(@"Failed to reconnect tunnel, missing tunnel configuration.");
    return;
  }
  // Nothing changed. Connect the tunnel with the current settings.
  [self startRouting:[SwiftBridge getTunnelNetworkSettings]
         completion:^(NSError *_Nullable error) {
           if (error != nil) {
             // A routing refresh failure must not tear down the protected session.
             self.reasserting = YES;
             DDLogError(@"Failed to refresh tunnel settings: %@", error.localizedDescription);
           }
         }];
}

- (BOOL)close:(NSError *_Nullable *)error {
  return YES;
}

- (BOOL)write:(NSData *_Nullable)packet n:(long *)n error:(NSError *_Nullable *)error {
  [self.packetFlow writePackets:@[ packet ] withProtocols:@[ @(AF_INET) ]];
  *n = packet.length;
  return YES;
}

// Writes packets from the VPN to the tunnel.
- (void)processPackets {
  if (self.stopping) {
    return;
  }
  __weak typeof(self) weakSelf = self;
  [self.packetFlow readPacketsWithCompletionHandler:^(NSArray<NSData *> *packets,
                                                      NSArray<NSNumber *> *protocols) {
    typeof(self) strongSelf = weakSelf;
    if (strongSelf == nil) {
      return;
    }
    dispatch_async(strongSelf.packetQueue, ^{
      if (strongSelf.stopping) {
        return;
      }
      long bytesWritten = 0;
      for (NSData *packet in packets) {
        // A missing device intentionally drops packets; routes still point to TUN.
        [strongSelf.remoteDevice write:packet ret0_:&bytesWritten error:nil];
      }
      [strongSelf processPackets];
    });
  }];
}

- (PlaterrorsPlatformError*)connectRemoteDevice:(BOOL)isOnDemand {
  OutlineNewClientResult* clientResult = [SwiftBridge newClientWithId: self.tunnelId transportConfig:self.transportConfig];
  if (clientResult.error != nil) {
    return clientResult.error;
  }
  Tun2socksConnectRemoteDeviceResult *result = Tun2socksConnectRemoteDevice(clientResult.client);
  if (result.error != nil) {
    DDLogError(@"Failed to connect remote device: %@", result.error);
    return result.error;
  }
  self.remoteDevice = result.device;

  if (!isOnDemand) {
    PlaterrorsPlatformError *healthErr = [self.remoteDevice getHealthStatus];
    if (healthErr != nil) {
      DDLogError(@"Remote device is not healthy: %@", healthErr.error);
      [self.remoteDevice close];
      return healthErr;
    }
    DDLogInfo(@"Remote device is healthy.");
  } else {
    // Bypass health checks for auto-connect. If the tunnel configuration is no longer
    // valid, the connectivity checks will fail. The system will keep calling this method due to
    // On Demand being enabled (the VPN process does not have permission to change it), rendering the
    // network unusable with no indication to the user. By bypassing the checks, the network would
    // still be unusable, but at least the user will have a visual indication that Outline is the
    // culprit and can explicitly disconnect.
    DDLogInfo(@"Auto-start VPN, skip health check");
  }
  return nil;
}

- (PlaterrorsPlatformError*)relayTraffic:(BOOL)isRestart {
  __weak PacketTunnelProvider *weakSelf = self;
  PlaterrorsPlatformError *relayErr = Tun2socksGoRelayTrafficOneWay(weakSelf, self.remoteDevice);
  if (relayErr != nil) {
    DDLogError(@"Failed to relay traffic from remote device to TUN: %@", relayErr.error);
    return relayErr;
  }
  DDLogInfo(@"Relaying traffic from remote device to TUN");

  if (!isRestart) {
    dispatch_async(self.packetQueue, ^{
      [weakSelf processPackets];
    });
  }
  return nil;
}

#pragma mark - fetch last disconnect error

// TODO: Remove this code once we only support newer systems (macOS 13.0+, iOS 16.0+)

NSString *const kFetchLastErrorIPCName = @"fetchLastDisconnectDetailedJsonError";

// Versioned handover IPC. Never log the request: it contains access credentials.
- (void)handleAppMessage:(NSData *)messageData completionHandler:(void (^)(NSData * _Nullable))completion {
  if (completion == nil) {
    return;
  }
  NSString *ipcName = [[NSString alloc] initWithData:messageData encoding:NSUTF8StringEncoding];
  if ([ipcName isEqualToString:kFetchLastErrorIPCName]) {
    return completion([SwiftBridge loadLastErrorToIPCResponse]);
  }
  id request = [NSJSONSerialization JSONObjectWithData:messageData options:0 error:nil];
  if (![request isKindOfClass:[NSDictionary class]]) {
    return completion(nil);
  }
  dispatch_async(self.packetQueue, ^{
    NSString *action = request[@"action"];
    if ([action isEqual:@"getTunnelId.v1"]) {
      return completion([SwiftBridge switchResponseWithId:self.tunnelId token:self.committedToken error:nil]);
    }
    if ([action isEqual:@"abortSwitch.v1"]) {
      if ([self.preparedToken isEqual:request[@"token"]]) {
        [self discardPreparedSwitch];
      }
      return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil error:nil]);
    }
    if ([action isEqual:@"prepareSwitch.v1"]) {
      return [self prepareSwitch:request completion:completion];
    }
    if ([action isEqual:@"commitSwitch.v1"]) {
      return [self commitSwitch:request completion:completion];
    }
    completion(nil);
  });
}

- (void)discardPreparedSwitch {
  self.preparedToken = nil;
  self.preparedId = nil;
  self.preparedTransport = nil;
  self.preparedClient = nil;
}

- (void)prepareSwitch:(NSDictionary *)request completion:(void (^)(NSData *))completion {
  NSString *token = request[@"token"];
  NSString *tunnelId = request[@"id"];
  NSString *transport = request[@"transport"];
  if (self.stopping || self.tunnelId == nil || self.preparedToken != nil ||
      ![token isKindOfClass:[NSString class]] || token.length == 0 ||
      ![tunnelId isKindOfClass:[NSString class]] || tunnelId.length == 0 ||
      ![transport isKindOfClass:[NSString class]] ||
      ![self.tunnelId isEqual:request[@"expectedId"]]) {
    return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil
        error:[SwiftBridge newInternalOutlineErrorWithMessage:@"VPN switch is unavailable or stale"]]);
  }
  self.preparedToken = token;
  NSUInteger generation = self.sessionGeneration;
  // Expire abandoned preparations even if the app exits or loses its IPC reply.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), self.packetQueue, ^{
    if ([self.preparedToken isEqual:token]) {
      [self discardPreparedSwitch];
    }
  });
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    OutlineNewClientResult *candidate = [SwiftBridge newClientWithId:tunnelId transportConfig:transport];
    PlaterrorsPlatformError *error = candidate.error;
    if (error == nil) {
      error = Tun2socksCheckClientConnectivity(candidate.client);
    }
    dispatch_async(self.packetQueue, ^{
      if (self.stopping || self.sessionGeneration != generation || ![self.preparedToken isEqual:token]) {
        return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil
            error:[SwiftBridge newInternalOutlineErrorWithMessage:@"VPN switch cancelled"]]);
      }
      if (error != nil) {
        [self discardPreparedSwitch];
        return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil
            error:[SwiftBridge newOutlineErrorFromPlatformError:error]]);
      }
      self.preparedClient = candidate.client;
      self.preparedId = tunnelId;
      self.preparedTransport = transport;
      completion([SwiftBridge switchResponseWithId:self.tunnelId token:token error:nil]);
    });
  });
}

- (void)commitSwitch:(NSDictionary *)request completion:(void (^)(NSData *))completion {
  if (self.stopping || self.preparedClient == nil || ![self.preparedToken isEqual:request[@"token"]]) {
    return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil
        error:[SwiftBridge newInternalOutlineErrorWithMessage:@"VPN switch preparation expired"]]);
  }
  OutlineClient *client = self.preparedClient;
  NSString *tunnelId = self.preparedId;
  NSString *transport = self.preparedTransport;
  [self discardPreparedSwitch];

  // lwIP is a singleton. Replace it only after preflight, on the same queue as
  // packet writes. The system VPN, routes, DNS and packetFlow reader stay alive.
  [self.remoteDevice close];
  self.remoteDevice = nil;
  Tun2socksConnectRemoteDeviceResult *result = Tun2socksConnectRemoteDevice(client);
  PlaterrorsPlatformError *error = result.error;
  if (error == nil) {
    self.remoteDevice = result.device;
    error = [self relayTraffic:YES];
  }
  if (error != nil) {
    [self.remoteDevice close];
    self.remoteDevice = nil;
    self.reasserting = YES;
    // Preserve the previous logical ID so the app can still Disconnect or retry.
    return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil
        error:[SwiftBridge newOutlineErrorFromPlatformError:error]]);
  }
  NSError *persistenceError = [SwiftBridge recordCommittedSwitchWithToken:request[@"token"]];
  if (persistenceError != nil) {
    [self.remoteDevice close];
    self.remoteDevice = nil;
    self.reasserting = YES;
    return completion([SwiftBridge switchResponseWithId:self.tunnelId token:nil error:persistenceError]);
  }
  self.tunnelId = tunnelId;
  self.transportConfig = transport;
  self.committedToken = request[@"token"];
  self.reasserting = self.defaultPath.status != NWPathStatusSatisfied;
  completion([SwiftBridge switchResponseWithId:self.tunnelId token:self.committedToken error:nil]);
}

- (void)cancelTunnelWithError:(nullable NSError *)error {
  [SwiftBridge saveLastErrorWithNsError:error];
  [super cancelTunnelWithError:error];
}

@end
