// Copyright 2025 The Outline Authors
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

package tun2socks

import (
	"io"
	"log/slog"

	perrs "localhost/client/go/outline/platerrors"
	"localhost/client/go/outline/vpn"
)

// TunWriter is an interface that allows for outputting packets to the TUN (VPN).
//
// This type will be exposed to native code via gomobile.
type TunWriter interface {
	io.WriteCloser
}

// GoRelayTrafficOneWay starts one goroutine to relay network traffic from
// a remote device to a TUN device (passed as a [TunWriter]).
func GoRelayTrafficOneWay(tun TunWriter, rd *RemoteDevice) *perrs.PlatformError {
	if tun == nil {
		return &perrs.PlatformError{
			Code:    perrs.InternalError,
			Message: "TunWriter must be provided",
		}
	}
	if rd == nil {
		return &perrs.PlatformError{
			Code:    perrs.InternalError,
			Message: "remote device must be provided",
		}
	}
	rd.mu.Lock()
	if rd.tun != nil {
		if err := rd.tun.Close(); err != nil {
			slog.Info("successfully closed an already existing tun device")
		} else {
			slog.Warn("failed to close an already existing tun device", "err", err)
		}
	}
	rd.tun = tun
	rd.mu.Unlock()

	go vpn.RelayTraffic(tun, rd.rd.ReadWriteCloser)

	return nil
}
