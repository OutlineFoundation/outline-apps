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

import {createConnection, Socket} from 'net';
import {createHash} from 'node:crypto';
import {platform, userInfo} from 'os';
import * as path from 'path';

import * as fsextra from 'fs-extra';
import * as sudo from 'sudo-prompt';

import {pathToEmbeddedOutlineService} from './app_paths';
import {TunnelStatus} from '../web/app/outline_server_repository/vpn';
import {ErrorCode} from '../web/model/errors';
import {PlatformError, GoErrorCode} from '../web/model/platform_error';

const isLinux = platform() === 'linux';
const isWindows = platform() === 'win32';
const SERVICE_NAME = isWindows
  ? '\\\\.\\pipe\\OutlineServicePipe'
  : '/var/run/outline_controller';

interface RoutingServiceRequest {
  action: string;
  parameters: {[parameter: string]: string | boolean};
}

interface RoutingServiceResponse {
  action: RoutingServiceAction; // Matches RoutingServiceRequest.action
  statusCode: RoutingServiceStatusCode;
  errorMessage?: string;
  connectionStatus: TunnelStatus;
  gatewayAdapterIndex?: string;
}

enum RoutingServiceAction {
  CONFIGURE_ROUTING = 'configureRouting',
  RESET_ROUTING = 'resetRouting',
  STATUS_CHANGED = 'statusChanged',
}

enum RoutingServiceStatusCode {
  SUCCESS = 0,
  GENERIC_FAILURE = 1,
  UNSUPPORTED_ROUTING_TABLE = 2,
}

// Communicates with the Outline routing daemon via a Unix socket.
//
// A minimal life-cycle is supported:
//  - CONFIGURE_ROUTING is *always* the first message sent on the pipe.
//  - The only subsequent supported operation is RESET_ROUTING.
//  - In the meantime, the client may receive zero or more STATUS_CHANGED events.
//
// That's it! This helps us connect to the service for *as short a time as possible* which is
// important when trying to implement a Promise-like interface over what is essentially a pipe *and*
// on Windows where only one client may be connected to the service at any given time.
//
// To test:
//  - Linux: systemctl start|stop outline_proxy_controller.service
//  - Windows: net start|stop OutlineService
export class RoutingDaemon {
  private socket: Socket | null | undefined;

  private stopping = false;

  private fulfillDisconnect!: () => void;

  private disconnected = new Promise<void>(F => {
    this.fulfillDisconnect = F;
  });

  private networkChangeListener?: (
    status: TunnelStatus,
    gatewayIndex?: string
  ) => void;

  constructor(
    private proxyAddress: string,
    private isAutoConnect: boolean
  ) {}

  // Fulfills once a connection is established with the routing daemon *and* it has successfully
  // configured the system's routing table.
  // Returns a string representing the network adapter index that connects to the gateway.
  async start() {
    return new Promise<string>((fulfill, reject) => {
      const newSocket = (this.socket = createConnection(SERVICE_NAME, () => {
        newSocket.removeListener('error', initialErrorHandler);
        const cleanup = () => {
          newSocket.removeAllListeners();
          this.socket = null;
          this.fulfillDisconnect();
        };
        newSocket.once('close', cleanup);
        newSocket.once('error', cleanup);

        newSocket.once('data', data => {
          const message = this.parseRoutingServiceResponse(data);
          if (
            !message ||
            message.action !== RoutingServiceAction.CONFIGURE_ROUTING ||
            message.statusCode !== RoutingServiceStatusCode.SUCCESS
          ) {
            // NOTE: This will rarely occur because the connectivity tests
            //       performed when the user clicks "CONNECT" should detect when
            //       the system is offline and that, currently, is pretty much
            //       the only time the routing service will fail.
            reject(
              new Error(
                message
                  ? message.errorMessage
                  : 'empty routing service response'
              )
            );
            newSocket.end();
            return;
          }

          newSocket.on('data', this.dataHandler.bind(this));

          // Potential race condition: this routing daemon might already be stopped by the tunnel
          // when one of the dependencies (ss-local/tun2socks) exited
          // TODO(junyi): better handling this case in the next installation logic fix
          if (this.stopping) {
            cleanup();
            newSocket.destroy();
            const perr = new PlatformError(
              GoErrorCode.ROUTING_SERVICE_NOT_RUNNING,
              'routing daemon service stopped before started'
            );
            reject(new Error(perr.toJSON()));
          } else {
            fulfill(message.gatewayAdapterIndex);
          }
        });

        newSocket.write(
          JSON.stringify({
            action: RoutingServiceAction.CONFIGURE_ROUTING,
            parameters: {
              proxyIp: this.proxyAddress,
              isAutoConnect: this.isAutoConnect,
            },
          } as RoutingServiceRequest)
        );
      }));

      const initialErrorHandler = (err: Error) => {
        console.error('Routing daemon socket setup failed', err);
        this.socket = null;
        const perr = new PlatformError(
          GoErrorCode.ROUTING_SERVICE_NOT_RUNNING,
          'routing daemon is not running',
          {cause: err}
        );
        reject(new Error(perr.toJSON()));
      };
      newSocket.once('error', initialErrorHandler);
    });
  }

  private dataHandler(data: Buffer) {
    const message = this.parseRoutingServiceResponse(data);
    if (!message) {
      return;
    }
    switch (message.action) {
      case RoutingServiceAction.STATUS_CHANGED:
        if (this.networkChangeListener) {
          this.networkChangeListener(
            message.connectionStatus,
            message.gatewayAdapterIndex
          );
        }
        break;
      case RoutingServiceAction.RESET_ROUTING:
        // TODO: examine statusCode
        if (this.socket) {
          this.socket.end();
        }
        break;
      default:
        console.error(
          `unexpected message from background service: ${data.toString()}`
        );
    }
  }

  // Parses JSON `data` as a `RoutingServiceResponse`. Logs the error and returns undefined on
  // failure.
  private parseRoutingServiceResponse(
    data: Buffer
  ): RoutingServiceResponse | undefined {
    if (!data) {
      console.error('received empty response from routing service');
      return undefined;
    }
    let response: RoutingServiceResponse | undefined = undefined;
    try {
      response = JSON.parse(data.toString());
    } catch {
      console.error(
        `failed to parse routing service response: ${data.toString()}`
      );
    }
    return response;
  }

  private async writeReset() {
    return new Promise<void>((resolve, reject) => {
      const written = this.socket?.write(
        JSON.stringify({
          action: RoutingServiceAction.RESET_ROUTING,
          parameters: {},
        } as RoutingServiceRequest),
        err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
      if (!written) {
        reject(new Error('Write failed'));
      }
    });
  }

  // stop() resolves when the stop command has been sent.
  // Use #onceDisconnected to be notified when the connection terminates.
  async stop() {
    if (!this.socket) {
      // Never started.
      this.fulfillDisconnect();
      return;
    }
    if (this.stopping) {
      // Already stopped.
      return;
    }
    this.stopping = true;

    return this.writeReset();
  }

  get onceDisconnected() {
    return this.disconnected;
  }

  set onNetworkChange(
    newListener: (
      status: TunnelStatus,
      gatewayIndex?: string
    ) => void | undefined
  ) {
    this.networkChangeListener = newListener;
  }
}

//#region routing service installation

/**
 * Execute arbitary shell `command` as root.
 * @param command command Any valid shell command(s).
 */
function executeCommandAsRoot(command: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    sudo.exec(command, {name: 'Outline'}, (sudoError, stdout, stderr) => {
      console.info(stdout);
      console.error(stderr);

      if (sudoError) {
        // This error message is an un-exported constant defined here:
        //   - https://github.com/jorangreef/sudo-prompt/blob/v9.2.1/index.js#L670
        if (sudoError.message?.includes('did not grant permission')) {
          console.error('user rejected to run command as root');
          reject(ErrorCode.NO_ADMIN_PERMISSIONS);
        } else {
          console.error('command is running as root but failed: ', sudoError);
          reject(ErrorCode.UNEXPECTED);
        }
      } else {
        resolve();
      }
    });
  });
}

function installWindowsRoutingServices(): Promise<void> {
  const WINDOWS_INSTALLER_FILENAME = 'install_windows_service.bat';

  // Locating the script is tricky: when packaged, this basically boils down to:
  //   c:\program files\Outline\
  // but during development:
  //   build/windows
  //
  // Surrounding quotes important, consider "c:\program files"!
  const script = `"${path.join(
    pathToEmbeddedOutlineService(),
    WINDOWS_INSTALLER_FILENAME
  )}"`;
  return executeCommandAsRoot(script);
}

async function installLinuxRoutingServices(): Promise<void> {
  const LINUX_INSTALLER_FILENAME = 'install_linux_service.sh';
  const installationFileDescriptors: Array<{
    filename: string;
    executable: boolean;
    sha256: string;
  }> = [
    {filename: LINUX_INSTALLER_FILENAME, executable: true, sha256: ''},
    {filename: 'OutlineProxyController', executable: true, sha256: ''},
    {
      filename: 'outline_proxy_controller.service',
      executable: false,
      sha256: '',
    },
  ];

  // These Linux service files are located in a mounted folder of the AppImage, typically
  // located at /tmp/.mount_Outlinxxxxxx/resources/. These files can only be accessed by
  // the user who launched Outline.AppImage, so even root cannot access the files or folders.
  // Therefore we have to copy these files to a normal temporary folder, and execute them
  // as root.
  //
  // Also, we are copying individual files instead of the entire folder because they are in
  // electron's "asar" archive (which is returned by getAppPath). Electron tries to inject
  // some logic to node's fs API and make sure the caller can access files in the archive.
  // However directories are not supported.
  //
  // References:
  // - https://github.com/AppImage/AppImageKit/issues/146
  // - https://xwartz.gitbooks.io/electron-gitbook/content/en/tutorial/application-packaging.html
  const tmp = await fsextra.mkdtemp('/tmp/');
  const srcFolderPath = pathToEmbeddedOutlineService();

  console.log(`copying service installation files to ${tmp}`);
  for (const descriptor of installationFileDescriptors) {
    const src = path.join(srcFolderPath, descriptor.filename);

    const srcContent = await fsextra.readFile(src);
    descriptor.sha256 = createHash('sha256').update(srcContent).digest('hex');

    const dest = path.join(tmp, descriptor.filename);
    await fsextra.copy(src, dest, {overwrite: true});

    if (descriptor.executable) {
      await fsextra.chmod(dest, 0o700);
    }
  }
  console.log(`all service installation files copied to ${tmp} successfully`);

  // At this time, the user running Outline (who is not root) could replace these installation
  // files in "/tmp/xxx" folder with any arbitrary scripts (because "/tmp/xxx" folder and its
  // contents are writable by this user). Our system will then run it using root and cause a
  // potential security breach. Therefore we need to make sure the files are the ones provided
  // by us:
  //   1. `chattr +i`, set the immutable flag, the flag can only be cleared by root
  //   2. `shasum -c`, check them against our checksums calculated from the scripts in AppImage
  //   3. Run the installation script
  //   4. `chattr -i`, always clear the immutable flag, so they can be deleted later
  let command = `trap "/usr/bin/chattr -R -i ${tmp}" EXIT`;
  command += `; /usr/bin/chattr -R +i ${tmp}`;
  command +=
    ' && ' +
    installationFileDescriptors
      .map(
        ({filename, sha256}) =>
          `/usr/bin/echo "${sha256}  ${path.join(
            tmp,
            filename
          )}" | /usr/bin/shasum -a 256 -c`
      )
      .join(' && ');
  command += ` && "${path.join(tmp, LINUX_INSTALLER_FILENAME)}" "${
    userInfo().username
  }"`;

  console.log('trying to run command as root: ', command);
  await executeCommandAsRoot(command);
}

export async function installRoutingServices(): Promise<void> {
  console.info('installing outline routing service...');
  if (isWindows) {
    await installWindowsRoutingServices();
  } else if (isLinux) {
    await installLinuxRoutingServices();
  } else {
    throw new Error('unsupported os');
  }
  console.info('outline routing service installed successfully');
}

//#endregion routing service installation
