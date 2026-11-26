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
using System.Collections.Generic;
using System.Linq;
using System.ServiceProcess;
using System.Text;
using System.Threading.Tasks;

namespace OutlineService
{
    static class Program
    {
        static void Main(string[] args)
        {
            if (!Environment.UserInteractive)
            {
                ServiceBase[] ServicesToRun;
                ServicesToRun = new ServiceBase[] { new OutlineService() };
                ServiceBase.Run(ServicesToRun);
            }
            else
            {
                var service = new OutlineService();
                // To run as a service from the command-line:
                // service.OnStart(null);
                // System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
                if (args.Length < 1)
                {
                    ShowUsageAndExit();
                }
                switch (args[0])
                {
                    case "on":
                        service.ConfigureRouting(false);
                        break;
                    case "off":
                        if (args.Length < 2)
                        {
                            ShowUsageAndExit();
                        }
                        service.ResetRouting(Int32.Parse(args[1]));
                        break;
                    default:
                        ShowUsageAndExit();
                        break;
                }
                Console.WriteLine($"network config: {service.GetNetworkInfo()}");
            }
        }

        static void ShowUsageAndExit()
        {
            Console.WriteLine("usage: on|off <default gateway interface index>");
            Environment.Exit(1);
        }
    }
}  // namespace OutlineService
