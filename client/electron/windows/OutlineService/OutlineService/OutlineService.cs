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

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using Newtonsoft.Json;

/*
 * Windows Service, part of the Outline Windows client, to configure routing.
 * Modifying the system routes requires admin permissions, so this service must be installed
 * and started as admin.
 *
 * The service listens on a named pipe and supports the following JSON API:
 *
 * Requests
 *
 * configureRouting: Modifies the system's routing table to route all traffic through the TAP device.
 * Disables IPv6 traffic. proxyIp is used to find the best gateway adapter.
 *    { action: "configureRouting", parameters: {"proxyIp": <IPv4 address>, "isAutoConnect": "false" }}
 *
 *  resetRouting: Restores the system's default routing.
 *    { action: "resetRouting"}
 *
 * Response
 *
 *  { statusCode:<int>, action:<string>, errorMessage?:<string>, gatewayAdapterIndex?:<string> }
 *
 *  The service will send connection status updates if the pipe connection is kept
 *  open by the client. Such responses have the form:
 *
 *  { statusCode:<int>, action:"statusChanged", connectionStatus:<int>, gatewayAdapterIndex?:<string> }
 *
 * View logs with this PowerShell query:
 * get-eventlog -logname Application -source OutlineService -newest 20 | format-table -property timegenerated,entrytype,message -autosize
 */
namespace OutlineService
{
    public partial class OutlineService : ServiceBase
    {
        private const string EVENT_LOG_SOURCE = "OutlineService";
        private const string EVENT_LOG_NAME = "Application";
        // Must be kept in sync with the Electron code.
        private const string PIPE_NAME = "OutlineServicePipe";
        private const string TAP_DEVICE_NAME = "outline-tap0";
        private const string TAP_DEVICE_IP = "10.0.85.1";

        private const string ACTION_CONFIGURE_ROUTING = "configureRouting";
        private const string ACTION_RESET_ROUTING = "resetRouting";
        private const string ACTION_STATUS_CHANGED = "statusChanged";
        private const string PARAM_PROXY_IP = "proxyIp";
        private const string PARAM_AUTO_CONNECT = "isAutoConnect";

        // Explicitly route "fake" DNS traffic to 169.254.113.53/32 through the TUN device.
        // This is necessary because the 169.254.0.0/16 is in IPV4_RESERVED_SUBNETS.
        private static string[] IPV4_SUBNETS = { "0.0.0.0/1", "128.0.0.0/1", "169.254.113.53/32" };
        private static string[] IPV6_SUBNETS = { "fc00::/7", "2000::/4", "3000::/4" };
        private static string[] IPV4_RESERVED_SUBNETS = {
            "0.0.0.0/8",
            "10.0.0.0/8",
            "100.64.0.0/10",
            "169.254.0.0/16",
            "172.16.0.0/12",
            "192.0.0.0/24",
            "192.0.2.0/24",
            "192.31.196.0/24",
            "192.52.193.0/24",
            "192.88.99.0/24",
            "192.168.0.0/16",
            "192.175.48.0/24",
            "198.18.0.0/15",
            "198.51.100.0/24",
            "203.0.113.0/24",
            "240.0.0.0/4"
        };
        private const string CMD_NETSH = "netsh";
        private const string CMD_ROUTE = "route";

        private const uint BUFFER_SIZE_BYTES = 1024;

        private EventLog eventLog;
        private NamedPipeServerStream pipe;
        private string proxyIp;
        private string gatewayIp;
        private int gatewayInterfaceIndex;

        // Time, in ms, to wait until considering smartdnsblock.exe to have successfully launched.
        private const int SMART_DNS_BLOCK_TIMEOUT_MS = 1000;

        // https://docs.microsoft.com/en-us/windows/desktop/api/ipmib/ns-ipmib-_mib_ipforwardrow
        [StructLayout(LayoutKind.Sequential)]
        internal class MIB_IPFORWARDROW
        {
            internal uint dwForwardDest;
            internal uint dwForwardMask;
            internal uint dwForwardPolicy;
            internal uint dwForwardNextHop;
            internal int dwForwardIfIndex;
            internal uint dwForwardType;
            internal uint dwForwardProto;
            internal uint dwForwardAge;
            internal uint dwForwardNextHopAS;
            internal uint dwForwardMetric1;
            internal uint dwForwardMetric2;
            internal uint dwForwardMetric3;
            internal uint dwForwardMetric4;
            internal uint dwForwardMetric5;
        }

        // https://docs.microsoft.com/en-us/windows/desktop/api/ipmib/ns-ipmib-_mib_ipforwardtable
        //
        // NOTE: Because of the variable-length array, Marshal.PtrToStructure
        //       will *not* populate the table field. Additionally, we have seen
        //       crashes following suspend/resume while trying to marshal this
        //       structure. See #GetSystemIpv4Gateway for more on this, as well
        //       as for how to traverse the table.
        [StructLayout(LayoutKind.Sequential)]
        internal class MIB_IPFORWARDTABLE
        {
            internal uint dwNumEntries;
            internal MIB_IPFORWARDROW[] table;
        };

        // https://docs.microsoft.com/en-us/windows/desktop/api/iphlpapi/nf-iphlpapi-getipforwardtable
        [DllImport("iphlpapi", CharSet = CharSet.Auto)]
        private extern static int GetIpForwardTable(IntPtr pIpForwardTable, ref int pdwSize, bool bOrder);

        // https://docs.microsoft.com/en-us/windows/desktop/debug/system-error-codes--0-499-
        private static int ERROR_INSUFFICIENT_BUFFER = 122;

        // Do as little as possible here because any error thrown will cause "net start" to fail
        // without anything being added to the application log.
        public OutlineService()
        {
            InitializeComponent();

            eventLog = new EventLog();
            if (!EventLog.SourceExists(EVENT_LOG_SOURCE))
            {
                EventLog.CreateEventSource(EVENT_LOG_SOURCE, EVENT_LOG_NAME);
            }
            eventLog.Source = EVENT_LOG_SOURCE;
            eventLog.Log = EVENT_LOG_NAME;
        }

        protected override void OnStart(string[] args)
        {
            eventLog.WriteEntry("OutlineService starting");
            NetworkChange.NetworkAddressChanged +=
                new NetworkAddressChangedEventHandler(NetworkAddressChanged);
            CreatePipe();
        }

        protected override void OnStop()
        {
            eventLog.WriteEntry("OutlineService stopping");
            DestroyPipe();
            NetworkChange.NetworkAddressChanged -= NetworkAddressChanged;
        }

        private void CreatePipe()
        {
            var pipeSecurity = new PipeSecurity();
            pipeSecurity.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(
                WellKnownSidType.CreatorOwnerSid, null),
                PipeAccessRights.FullControl, AccessControlType.Allow));
            pipeSecurity.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(
                WellKnownSidType.AuthenticatedUserSid, null),
                PipeAccessRights.ReadWrite, AccessControlType.Allow));

            pipe = new NamedPipeServerStream(PIPE_NAME, PipeDirection.InOut, -1, PipeTransmissionMode.Message,
                                             PipeOptions.Asynchronous, (int)BUFFER_SIZE_BYTES, (int)BUFFER_SIZE_BYTES, pipeSecurity);
            pipe.BeginWaitForConnection(HandleConnection, null);
        }

        private void DestroyPipe()
        {
            if (pipe == null)
            {
                return;
            }
            try
            {
                if (pipe.IsConnected)
                {
                    pipe.Disconnect();
                }
                pipe.Close();
                pipe = null;
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"Got an exception while destroying the pipe: {e.ToString()}",
                                    EventLogEntryType.Warning);
            }
        }

        private void HandleConnection(IAsyncResult result)
        {
            eventLog.WriteEntry("Got incoming connection");

            // Save the network config before we do anything. If the request fails
            // it will be sent to the client for inclusion in Sentry reports.
            var beforeNetworkInfo = GetNetworkInfo();

            try
            {
                pipe.EndWaitForConnection(result);
                // Keep the pipe connected to send connection status updates.
                while (pipe.IsConnected)
                {
                    ServiceResponse response = new ServiceResponse();
                    var request = ReadRequest();
                    if (request == null)
                    {
                        response.statusCode = (int)ErrorCode.GenericFailure;
                    }
                    else
                    {
                        response.action = request.action;
                        try
                        {
                            HandleRequest(request, response);
                        }
                        catch (Exception e)
                        {
                            response.statusCode = (int)ErrorCode.GenericFailure;
                            response.errorMessage = $"{e.Message} (network config: {beforeNetworkInfo})";
                            eventLog.WriteEntry($"request failed: {e.Message}", EventLogEntryType.Error);
                        }
                    }
                    WriteResponse(response);
                }
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"Failed to handle connection: {e.ToString()}", EventLogEntryType.Error);
            }
            finally
            {
                // Pipe streams are one-to-one connections. Recreate the pipe to handle subsequent requests.
                DestroyPipe();
                CreatePipe();
            }
        }

        private ServiceRequest ReadRequest()
        {
            var stringBuilder = new StringBuilder();
            var buffer = new byte[BUFFER_SIZE_BYTES];
            var memoryStream = new MemoryStream();
            do
            {
                var readBytes = pipe.Read(buffer, 0, buffer.Length);
                memoryStream.Write(buffer, 0, readBytes);
            } while (!pipe.IsMessageComplete);
            var msg = Encoding.UTF8.GetString(buffer);
            if (String.IsNullOrWhiteSpace(msg))
            {
                eventLog.WriteEntry("Failed to read request", EventLogEntryType.Error);
                return null;
            }
            eventLog.WriteEntry($"incoming message: {msg}");
            return ParseRequest(msg);
        }

        private ServiceRequest ParseRequest(string jsonRequest)
        {
            try
            {
                return JsonConvert.DeserializeObject<ServiceRequest>(jsonRequest);
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"Failed to parse request: {e.ToString()}");
            }
            return null;
        }

        private void WriteResponse(ServiceResponse response)
        {
            var jsonResponse = SerializeResponse(response);
            if (jsonResponse == null)
            {
                eventLog.WriteEntry("Failed to serialize response.", EventLogEntryType.Error);
                return;
            }
            eventLog.WriteEntry($"outgoing message: {jsonResponse}");
            var jsonResponseBytes = Encoding.UTF8.GetBytes(jsonResponse);
            pipe.Write(jsonResponseBytes, 0, jsonResponseBytes.Length);
            pipe.Flush();
            pipe.WaitForPipeDrain();
        }

        private string SerializeResponse(ServiceResponse response)
        {
            try
            {
                return JsonConvert.SerializeObject(response);
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"Failed to serialize response: {e.ToString()}");
            }
            return null;
        }

        private void HandleRequest(ServiceRequest request, ServiceResponse response)
        {
            switch (request.action)
            {
                case ACTION_CONFIGURE_ROUTING:
                    ConfigureRouting(request.parameters[PARAM_PROXY_IP], Boolean.Parse(request.parameters[PARAM_AUTO_CONNECT]));
                    response.gatewayAdapterIndex = gatewayInterfaceIndex.ToString();
                    break;
                case ACTION_RESET_ROUTING:
                    ResetRouting(proxyIp, gatewayInterfaceIndex);
                    break;
                default:
                    eventLog.WriteEntry($"Received invalid request: {request.action}", EventLogEntryType.Error);
                    break;
            }
        }

        // Routes all traffic *except that destined for the proxy server*
        // through the TAP device, creating the illusion of a system-wide VPN.
        //
        // The two key steps are:
        //  - Route all IPv4 traffic through the TAP device.
        //  - Find a gateway and route traffic *to the proxy server only* (a /32
        //    mask) through it.
        //
        // Finding a gateway, in particular, is complex: for more on how it
        // works, see #GetSystemIpv4Gateway.
        //
        // On top of this foundation, we take some steps to help prevent
        // "leaking" traffic:
        // - IPv6 traffic is "blocked", as Outline does not currently support
        //   servers on IPv6 addresses.
        // - "Smart Multi-Homed Name Resolution" is disabled, as it can cause
        //   the system's "regular" - and potentially filtered - DNS servers to
        //   be used (particularly on Windows 10).
        //
        // Preventing leaks significantly complicates things. In particular, *if
        // autostart is true and a gateway cannot be found then the IPv4
        // redirect and IPv6 block remain in place and no exception is thrown*.
        // When a gateway re-appears following a network change (see
        // #NetworkAddressChanged), we will reconnect.
        //
        // Lastly, a set of routes is added through the gateway *to non-routable
        // ("LAN") addresses*. This allows common hardware such as Chromecast to
        // function while Outline is active.
        //
        // Note:
        //  - Currently, this function does not "clean up" in the event of
        //    failure. Instead, we rely on the client to call ResetRouting
        //    following a connection failure.
        //  - There's limited protection against "nested connections", i.e.
        //    connecting to Outline while another VPN, e.g. OpenVPN, is already
        //    active. There's no simple API we can use to tell whether a VPN is
        //    already active and *given the difficulty in identifying this
        //    reliably* (multiple active network interfaces, for example, are
        //    very common, e.g. it happens - briefly - every time a user
        //    switches between a wired and wireless network) we err on the side
        //    of working. Since the user presumably knows whether another VPN is
        //    already active and *we make no persistent changes to the routing
        //    table* this seems reasonable.
        //
        // TODO: The client needs to handle certain autoconnect failures better,
        //       e.g. if IPv4 redirect fails then the client is not really in
        //       the reconnecting state; the system is leaking traffic.
        public void ConfigureRouting(string proxyIp, bool isAutoConnect)
        {
            try
            {
                StartSmartDnsBlock();
                eventLog.WriteEntry($"started smartdnsblock");
            }
            catch (Exception e)
            {
                throw new Exception($"could not start smartdnsblock: {e.Message}");
            }

            try
            {
                GetSystemIpv4Gateway(proxyIp);

                eventLog.WriteEntry($"connecting via gateway at {gatewayIp} on interface {gatewayInterfaceIndex}");
                this.proxyIp = proxyIp;

                try
                {
                    AddOrUpdateReservedSubnetBypass(gatewayIp, gatewayInterfaceIndex);
                    eventLog.WriteEntry($"created LAN bypass routes");
                }
                catch (Exception e)
                {
                    throw new Exception($"could not create LAN bypass routes: {e.Message}");
                }
            }
            catch (Exception e) when (isAutoConnect)
            {
                eventLog.WriteEntry($"could not reconnect during auto-connect: {e.Message}", EventLogEntryType.Warning);
            }

            try
            {
                StopRoutingIpv6();
                eventLog.WriteEntry($"blocked IPv6 traffic");
            }
            catch (Exception e)
            {
                throw new Exception($"could not block IPv6 traffic: {e.Message}");
            }

            try
            {
                AddIpv4TapRedirect();
                eventLog.WriteEntry($"redirected IPv4 traffic");
            }
            catch (Exception e)
            {
                throw new Exception($"could not redirect IPv4 traffic: {e.Message}");
            }
        }

        // Undoes and removes as many as possible of the routes and other
        // changes to the system previously made by #ConfigureRouting.
        //
        // As per #ConfigureRouting, this function is largely idempodent:
        // calling it multiple times in succession should be safe and result in
        // the same system configuration.
        //
        // Notes:
        //  - *This function does not set any error code when any step fails*.
        //    It probably should, as the system may in some rare cases still be
        //    connected (or, worse but less likely, bricked).
        //  - If the service does not know the IP address of the proxy server
        //    then it *cannot remove that route*. This can happen if the service
        //    is restarted while Outline is connected *or* (more likely) if this
        //    function is called while Outline is not connected. This route is
        //    mostly harmless because it only affects traffic to the proxy and
        //    if/when the user reconnects to it the route will be updated.
        public void ResetRouting(string proxyIp, int gatewayInterfaceIndex)
        {
            try
            {
                RemoveIpv4TapRedirect();
                eventLog.WriteEntry($"removed IPv4 redirect");
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"failed to remove IPv4 redirect: {e.Message}", EventLogEntryType.Error);
            }

            try
            {
                // This is only necessary when disconecting without network connectivity.
                StartRoutingIpv4();
            }
            catch (Exception) {}

            try
            {
                StartRoutingIpv6();
                eventLog.WriteEntry($"unblocked IPv6");
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"failed to unblock IPv6: {e.Message}", EventLogEntryType.Error);
            }

            this.proxyIp = null;

            try
            {
                RemoveReservedSubnetBypass();
                eventLog.WriteEntry($"deleted LAN bypass routes");
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"failed to delete LAN bypass routes: {e.Message}", EventLogEntryType.Error);
            }
            this.gatewayIp = null;

            try
            {
                StopSmartDnsBlock();
                eventLog.WriteEntry($"stopped smartdnsblock");
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"failed to stop smartdnsblock: {e.Message}",
                    EventLogEntryType.Warning);
            }
        }

        // Disable "Smart Multi-Homed Name Resolution", to ensure the system uses only the
        // (non-filtered) DNS server(s) associated with the TAP device.
        //
        // Notes:
        //  - To show the current firewall rules:
        //      netsh wfp show filters
        //  - This website is an easy way to quickly verify there are no DNS leaks:
        //      https://ipleak.net/
        //  - Because .Net provides *no way* to associate the new process with this one, the
        //    new process will continue to run even if this service is interrupted or crashes.
        //    Fortunately, since the changes it makes are *not* persistent, the system can, in
        //    the worst case, be fixed by rebooting.
        private void StartSmartDnsBlock()
        {
            // smartdnsblock.exe must be a sibling of OutlineService.exe.
            Process smartDnsBlock = new Process();
            smartDnsBlock.StartInfo.FileName = new DirectoryInfo(Process.GetCurrentProcess().MainModule.FileName).Parent.FullName +
                Path.DirectorySeparatorChar + "smartdnsblock.exe";
            smartDnsBlock.StartInfo.UseShellExecute = false;

            smartDnsBlock.StartInfo.RedirectStandardError = true;
            smartDnsBlock.StartInfo.RedirectStandardOutput = true;

            // This is for Windows 7: without it, the process exits immediately, presumably
            // because stdin isn't connected to anything:
            //   https://github.com/OutlineFoundation/outline-apps/issues/415
            //
            // This seems to make no difference on Windows 8 and 10.
            smartDnsBlock.StartInfo.RedirectStandardInput = true;

            ArrayList stdout = new ArrayList();
            ArrayList stderr = new ArrayList();
            smartDnsBlock.OutputDataReceived += (object sender, DataReceivedEventArgs e) =>
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    stdout.Add(e.Data);
                }
            };
            smartDnsBlock.ErrorDataReceived += (object sender, DataReceivedEventArgs e) =>
            {
                if (!String.IsNullOrEmpty(e.Data))
                {
                    stderr.Add(e.Data);
                }
            };

            try
            {
                smartDnsBlock.Start();
                smartDnsBlock.BeginOutputReadLine();
                smartDnsBlock.BeginErrorReadLine();
            }
            catch (Exception e)
            {
                throw new Exception($"could not launch smartdnsblock at {smartDnsBlock.StartInfo.FileName}: { e.Message}");
            }

            // This does *not* throw if the process is still running after Nms.
            smartDnsBlock.WaitForExit(SMART_DNS_BLOCK_TIMEOUT_MS);
            if (smartDnsBlock.HasExited)
            {
                throw new Exception($"smartdnsblock failed " + $"(stdout: {String.Join(Environment.NewLine, stdout.ToArray())}, " +
                    $"(stderr: {String.Join(Environment.NewLine, stderr.ToArray())})");
            }
        }

        private static void StopSmartDnsBlock()
        {
            var errors = new List<string>(0);
            foreach (var process in Process.GetProcessesByName("smartdnsblock"))
            {
                try
                {
                    process.Kill();
                }
                catch (Exception e)
                {
                    errors.Add(e.Message);
                }
            }

            if (errors.Count > 0)
            {
                throw new Exception($"could not stop smartdnsblock: {string.Join("; ", errors)}");
            }
        }

        // Route IPv4 traffic through the TAP device. Instead of deleting the
        // default IPv4 gateway (0.0.0.0/0), we resort to creating two more
        // specific routes (see IPV4_SUBNETS) that take precedence over the
        // default gateway. This way, we need not worry about the default
        // gateway being recreated with a lower metric upon device sleep.
        //
        // This 'hack' was inspired by OpenVPN; see:
        // https://github.com/OpenVPN/openvpn3/commit/d08cc059e7132a3d3aee3dcd946fce4c35b1ced3#diff-1d76f0fd7ec04c6d1398288214a879c5R358
        //
        // TODO: If these routes exist on a gateway that's not our TAP device,
        //       it might be a good signal that OpenVPN is active?
        private void AddIpv4TapRedirect()
        {
            foreach (string subnet in IPV4_SUBNETS)
            {
                try
                {
                    RunCommand(CMD_NETSH, $"interface ipv4 add route {subnet} nexthop={TAP_DEVICE_IP} interface={TAP_DEVICE_NAME} metric=0 store=active");
                }
                catch (Exception)
                {
                    RunCommand(CMD_NETSH, $"interface ipv4 set route {subnet} nexthop={TAP_DEVICE_IP} interface={TAP_DEVICE_NAME} metric=0 store=active");
                }
            }
        }

        private void RemoveIpv4TapRedirect()
        {
            foreach (string subnet in IPV4_SUBNETS)
            {
                RunCommand(CMD_NETSH, $"interface ipv4 delete route {subnet} interface={TAP_DEVICE_NAME}");
            }
        }

        private void StartRoutingIpv4()
        {
            foreach (string subnet in IPV4_SUBNETS)
            {
                RunCommand(CMD_NETSH, $"interface ipv4 delete route {subnet} interface={NetworkInterface.LoopbackInterfaceIndex}");
            }
        }

        private void StopRoutingIpv4()
        {
            foreach (string subnet in IPV4_SUBNETS)
            {
                try
                {
                    RunCommand(CMD_NETSH, $"interface ipv4 add route {subnet} interface={NetworkInterface.LoopbackInterfaceIndex} metric=0 store=active");
                }
                catch (Exception)
                {
                    RunCommand(CMD_NETSH, $"interface ipv4 set route {subnet} interface={NetworkInterface.LoopbackInterfaceIndex} metric=0 store=active");
                }
            }
        }

        private void StartRoutingIpv6()
        {
            foreach (string subnet in IPV6_SUBNETS)
            {
                RunCommand(CMD_NETSH, $"interface ipv6 delete route {subnet} interface={NetworkInterface.IPv6LoopbackInterfaceIndex}");
            }
        }

        // Outline does not currently support IPv6, so we resort to disabling it while the VPN is active to
        // prevent leakage. Removing the default IPv6 gateway is not enough since it gets re-created
        // through router advertisements and DHCP (disabling these or IPv6 routing altogether requires a
        // system reboot). Thus, we resort to creating three IPv6 routes (see IPV6_SUBNETS) to the loopback
        // interface that are more specific than the default route, causing IPv6 traffic to get dropped.
        private void StopRoutingIpv6()
        {
            foreach (string subnet in IPV6_SUBNETS)
            {
                try
                {
                    RunCommand(CMD_NETSH, $"interface ipv6 add route {subnet} interface={NetworkInterface.IPv6LoopbackInterfaceIndex} metric=0 store=active");
                }
                catch (Exception)
                {
                    RunCommand(CMD_NETSH, $"interface ipv6 set route {subnet} interface={NetworkInterface.IPv6LoopbackInterfaceIndex} metric=0 store=active");
                }
            }
        }

        // Routes reserved and private subnets through the default gateway so they bypass the VPN.
        private void AddOrUpdateReservedSubnetBypass(string gatewayIp, int gatewayInterfaceIndex)
        {
            foreach (string subnet in IPV4_RESERVED_SUBNETS)
            {
                try
                {
                    RunCommand(CMD_ROUTE, $"change {subnet} {gatewayIp} if {gatewayInterfaceIndex}");
                }
                catch (Exception)
                {
                    RunCommand(CMD_NETSH, $"interface ipv4 add route {subnet} nexthop={gatewayIp} interface=\"{gatewayInterfaceIndex}\" metric=0 store=active");
                }
            }
        }

        // Removes reserved subnet routes created to bypass the VPN.
        private void RemoveReservedSubnetBypass()
        {
            foreach (string subnet in IPV4_RESERVED_SUBNETS)
            {
                RunCommand(CMD_ROUTE, $"delete {subnet}");
            }
        }

        // Runs a shell command synchronously.
        private void RunCommand(string cmd, string args)
        {
            Console.WriteLine($"running command: {cmd} {args}");

            var startInfo = new ProcessStartInfo(cmd);
            startInfo.Arguments = args;
            startInfo.UseShellExecute = false;
            startInfo.RedirectStandardError = true;
            startInfo.RedirectStandardOutput = true;
            startInfo.CreateNoWindow = true;

            Process p = new Process();
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            p.OutputDataReceived += (object sender, DataReceivedEventArgs e) =>
            {
                if (e == null || String.IsNullOrWhiteSpace(e.Data))
                {
                    return;
                }
                stdout.Append(e.Data);
            };
            p.ErrorDataReceived += (object sender, DataReceivedEventArgs e) =>
            {
                if (e == null || String.IsNullOrWhiteSpace(e.Data))
                {
                    return;
                }
                stderr.Append(e.Data);
            };
            p.StartInfo = startInfo;
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();

            // "route" is weird and always exits with zero: we have to examine
            // stderr to detect its errors.
            if (p.ExitCode != 0 || stderr.ToString().Length > 0)
            {
                // NOTE: Do *not* add args to this error message because it's piped
                //       back to the client for inclusion in Sentry reports and
                //       effectively contain access keys.
                throw new Exception($"command exited with {p.ExitCode} " +
                    $"(stdout: {stdout.ToString()}, stderr: {stderr.ToString()})");
            }
        }

        // Searches the system's routing table for the best route to the
        // specified IP address *that does not route through the TAP device*.
        //
        // That last requirement - ignoring the TAP device - is what prevents us
        // from simply calling GetBestRoute: other than that, it does all the
        // work of finding the lowest-weighted gateway to the destination IP.
        //
        // NOTE: This function does not *always* find the best gateway: it
        // currently only considers "default" gateways (0.0.0.0) which may not
        // work in some rare cases. Several re-implementations of the Windows
        // API illustrate how we could more closely match GetBestRoute:
        // - https://github.com/wine-mirror/wine/blob/master/dlls/iphlpapi/iphlpapi_main.c
        // - https://github.com/reactos/reactos/blob/master/dll/win32/iphlpapi/iphlpapi_main.c
        private void GetSystemIpv4Gateway(string proxyIp)
        {
            gatewayIp = null;
            gatewayInterfaceIndex = -1;

            int tapInterfaceIndex;
            try
            {
                tapInterfaceIndex = NetworkInterface.GetAllNetworkInterfaces()
                    .Where(i => i.Name == TAP_DEVICE_NAME)
                    .FirstOrDefault()
                    .GetIPProperties()
                    .GetIPv4Properties().Index;
            }
            catch (Exception)
            {
                throw new Exception("TAP device not found");
            }

            // Some marshalling craziness follows: we have to first ask
            // GetIpForwardTable how much memory is required to hold the routing
            // table before calling it again to actually return us the table;
            // once we have the table, we have to iterate over the rows
            // (thankfully, MIB_IPFORWARDROW marshalls easily).
            int bufferSize = 0;
            if (GetIpForwardTable(IntPtr.Zero, ref bufferSize, true) != ERROR_INSUFFICIENT_BUFFER)
            {
                throw new Exception("could not fetch routing table");
            }
            var buffer = Marshal.AllocHGlobal(bufferSize);
            if (GetIpForwardTable(buffer, ref bufferSize, true) != 0)
            {
                Marshal.FreeHGlobal(buffer);
                throw new Exception("could not fetch routing table");
            }

            // NOTE: We deliberately *do not marshal the entire
            //       MIB_IPFORWARDTABLE* owing to unexplained crashes following
            //       suspend/resume. Fortunately, since that structure is
            //       logically just a DWORD followed by an array, this entails
            //       little extra work.
            var numEntries = Marshal.ReadInt32(buffer);
            MIB_IPFORWARDROW bestRow = null;
            var rowPtr = buffer + Marshal.SizeOf(numEntries);
            for (int i = 0; i < numEntries; i++)
            {
                MIB_IPFORWARDROW row = (MIB_IPFORWARDROW)Marshal.PtrToStructure(rowPtr, typeof(MIB_IPFORWARDROW));

                // Must be a gateway (see note above on how we can improve this).
                if (row.dwForwardDest != 0)
                {
                    continue;
                }

                // Must not be the TAP device.
                if (row.dwForwardIfIndex == tapInterfaceIndex)
                {
                    continue;
                }

                if (bestRow == null || row.dwForwardMetric1 < bestRow.dwForwardMetric1)
                {
                    bestRow = row;
                }

                rowPtr += Marshal.SizeOf(typeof(MIB_IPFORWARDROW));
            }

            Marshal.FreeHGlobal(buffer);

            if (bestRow == null)
            {
                throw new Exception("no gateway found");
            }

            gatewayIp = new IPAddress(BitConverter.GetBytes(bestRow.dwForwardNextHop)).ToString();
            gatewayInterfaceIndex = bestRow.dwForwardIfIndex;
        }

        // Updates, if Outline is connected, the routing table to reflect a new
        // gateway.
        //
        // There's really just one thing to do when the gateway changes: update
        // the (direct) route to the proxy server to route through the new
        // gateway. If there is no gateway, e.g. because the system has lost
        // network connectivity, notify the client and keep the IPv4 redirect
        // and IPv6 block in place: this helps prevent leaking traffic.
        //
        // Notes:
        //  - *This function must not throw*. If it does, the handler is unset.
        //  - This function also updates two further sets of routes: the LAN
        //    bypass routes (which must route through the gateway) and the IPv4
        //    redirect routes (which "fall back" to the system gateway once the
        //    TAP device temporarily disappears due to tun2socks' exit).
        //  - The NetworkChange.NetworkAddressChanged callback is *extremely
        //    noisy*. In particular, it seems to be called twice for every
        //    change to the routing table. There does not seem to be any useful
        //    information in the supplied EventArgs. This is partly why we don't
        //    touch the routing table unless the gateway has actually changed.
        //  - This function may be called while #ConfigureRouting is still
        //    running. This is partly why we exit early (at the top) if we don't
        //    think Outline is connected.
        private void NetworkAddressChanged(object sender, EventArgs evt)
        {
            if (proxyIp == null)
            {
                eventLog.WriteEntry("network changed but Outline is not connected - doing nothing");
                return;
            }

            var previousGatewayIp = gatewayIp;
            var previousGatewayInterfaceIndex = gatewayInterfaceIndex;

            try
            {
                GetSystemIpv4Gateway(proxyIp);
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"network changed but no gateway found: {e.Message}");
            }

            if (previousGatewayIp == gatewayIp && previousGatewayInterfaceIndex == gatewayInterfaceIndex)
            {
                // Only send on actual change, to prevent duplicate notifications (mostly
                // harmless but can make debugging harder).
                eventLog.WriteEntry($"network changed but gateway and interface stayed the same");
                return;
            }
            else if (gatewayIp == null)
            {
                SendConnectionStatusChange(ConnectionStatus.Reconnecting);

                // Stop capturing IPv4 traffic in order to prevent a routing loop in the TAP device.
                // Redirect IPv4 traffic to the loopback interface instead to avoid leaking traffic when
                // the network becomes available.
                try
                {
                    StopRoutingIpv4();
                    RemoveIpv4TapRedirect();
                    eventLog.WriteEntry($"stopped routing IPv4 traffic");
                }
                catch (Exception e)
                {
                    eventLog.WriteEntry($"failed to stop routing IPv4: {e.Message}", EventLogEntryType.Error);
                }
                return;
            }

            eventLog.WriteEntry($"network changed - gateway is now {gatewayIp} on interface {gatewayInterfaceIndex}");

            try
            {
                AddIpv4TapRedirect();
                StartRoutingIpv4();
                eventLog.WriteEntry($"refreshed IPv4 redirect");
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"could not refresh IPv4 redirect: {e.Message}");
                return;
            }
            finally
            {
                // Always send the status update since network adapters might have been updated
                SendConnectionStatusChange(ConnectionStatus.Connected);
            }

            try
            {
                AddOrUpdateReservedSubnetBypass(gatewayIp, gatewayInterfaceIndex);
                eventLog.WriteEntry($"updated LAN bypass routes");
            }
            catch (Exception e)
            {
                // TODO: This isn't quite right: because we successfully updated
                //       the route to the proxy, the client *is* connected; it's
                //       just not "fully" connected, in the way we like. We
                //       should distinguish between "cannot reconnect right now,
                //       because no internet" and "cannot reconnect because
                //       netsh commands are failing".
                eventLog.WriteEntry($"could not update LAN bypass routes: {e.Message}");
                return;
            }
        }

        // Writes the connection status to the pipe, if it is connected.
        private void SendConnectionStatusChange(ConnectionStatus status)
        {
            if (pipe == null || !pipe.IsConnected)
            {
                eventLog.WriteEntry("Cannot send connection status change, pipe not connected.", EventLogEntryType.Error);
                return;
            }
            ServiceResponse response = new ServiceResponse();
            response.action = ACTION_STATUS_CHANGED;
            response.statusCode = (int)ErrorCode.Success;
            response.connectionStatus = (int)status;
            if (status == ConnectionStatus.Connected)
            {
                response.gatewayAdapterIndex = gatewayInterfaceIndex.ToString();
            }
            try
            {
                WriteResponse(response);
            }
            catch (Exception e)
            {
                eventLog.WriteEntry($"Failed to send connection status change: {e.Message}");
            }
        }

        public string GetNetworkInfo()
        {
            return String.Join(", ", NetworkInterface.GetAllNetworkInterfaces()
                .Select(a => this.GetAdapterInfo(a)));
        }

        private string GetAdapterInfo(NetworkInterface adapter)
        {
            var numIpv4Gateways = adapter.GetIPProperties().GatewayAddresses
                  .Select(g => g.Address)
                  .Where(a => a.AddressFamily == AddressFamily.InterNetwork)
                  .Count();
            var numIpv6Gateways = adapter.GetIPProperties().GatewayAddresses
                  .Select(g => g.Address)
                  .Where(a => a.AddressFamily == AddressFamily.InterNetworkV6)
                  .Count();

            return $"{adapter.Name} ({adapter.OperationalStatus}): " + (
                adapter.Supports(NetworkInterfaceComponent.IPv4) ?
                    $"{numIpv4Gateways} x ipv4 gateways" :
                    "ipv4 disabled") + ", " + (
                adapter.Supports(NetworkInterfaceComponent.IPv6) ?
                    $"{numIpv6Gateways} x ipv6 gateways" :
                    "ipv6 disabled");
        }
    }

    [DataContract]
    internal class ServiceRequest
    {
        [DataMember]
        internal string action;
        [DataMember]
        internal Dictionary<string, string> parameters;
    }

    [DataContract]
    internal class ServiceResponse
    {
        [DataMember]
        internal string action;
        [DataMember]
        internal int statusCode;
        [DataMember]
        internal string errorMessage;
        [DataMember]
        internal int connectionStatus;
        [DataMember]
        internal string gatewayAdapterIndex;
    }

    public enum ErrorCode
    {
        Success = 0,
        GenericFailure = 1
    }

    public enum ConnectionStatus
    {
        Connected = 0,
        Disconnected = 1,
        Reconnecting = 2
    }
}
