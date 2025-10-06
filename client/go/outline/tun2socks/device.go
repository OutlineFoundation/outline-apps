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
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"

	"github.com/Jigsaw-Code/outline-apps/client/go/outline"
	perrs "github.com/Jigsaw-Code/outline-apps/client/go/outline/platerrors"
	"github.com/Jigsaw-Code/outline-apps/client/go/outline/vpn"
)

// RemoteDevice is an IO device that connects to a remote Outline server.
// It is also responsible for managing the Outline client session.
//
// This type is exported through gomobile, and wraps a [vpn.RemoteDevice].
type RemoteDevice struct {
	mu     sync.Mutex // protect tun modifications
	tun    io.Closer  // will be set in GoRelayTraffic
	rd     *vpn.RemoteDevice
	client *outline.Client
}

// ConnectRemoteDeviceResult represents the result of ConnectRemoteDevice.
//
// We use a struct instead of a tuple to preserve a strongly typed error that gobind recognizes.
type ConnectRemoteDeviceResult struct {
	Device *RemoteDevice
	Error  *perrs.PlatformError
}

func ConnectRemoteDevice(client *outline.Client) (res *ConnectRemoteDeviceResult) {
	if err := client.StartSession(); err != nil {
		return &ConnectRemoteDeviceResult{Error: &perrs.PlatformError{
			Code:    perrs.SetupTrafficHandlerFailed,
			Message: "failed to start backend Client session",
			Cause:   perrs.ToPlatformError(err),
		}}
	}
	defer func() {
		if res.Error != nil {
			if err := client.EndSession(); err != nil {
				slog.Warn("failed to end backend Client session", "err", err)
			}
		}
	}()
	rd, err := vpn.ConnectRemoteDevice(context.Background(), client, client)
	if err != nil {
		return &ConnectRemoteDeviceResult{Error: perrs.ToPlatformError(err)}
	}
	return &ConnectRemoteDeviceResult{Device: &RemoteDevice{
		rd:     rd,
		client: client,
	}}
}

func (d *RemoteDevice) GetHealthStatus() *perrs.PlatformError {
	return perrs.ToPlatformError(d.rd.GetHealthStatus())
}

func (d *RemoteDevice) Write(p []byte) (int, error) {
	return d.rd.Write(p)
}

func (d *RemoteDevice) NotifyNetworkChanged() {
	d.client.NotifyNetworkChanged()
}

func (d *RemoteDevice) Close() *perrs.PlatformError {
	defer func() {
		if err := d.client.EndSession(); err != nil {
			slog.Warn("failed to end backend Client session", "err", err)
		}
	}()
	var err error = nil
	d.mu.Lock()
	if d.tun != nil {
		err = d.tun.Close()
	}
	d.mu.Unlock()
	err = errors.Join(err, d.rd.Close())
	return perrs.ToPlatformError(err)
}
