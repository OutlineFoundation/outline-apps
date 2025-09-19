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

//go:build unix

// to prevent "undefined: unix.Dup" error

package tun2socks

import (
	"errors"
	"log/slog"
	"os"

	perrs "github.com/Jigsaw-Code/outline-apps/client/go/outline/platerrors"
	"github.com/Jigsaw-Code/outline-apps/client/go/outline/vpn"
	"golang.org/x/sys/unix"
)

// GoRelayTraffic starts two goroutines to relay network traffic bidirectionally
// between a TUN device (passed as a file descriptor) and a remote device.
func GoRelayTraffic(fd int, rd *RemoteDevice) *perrs.PlatformError {
	if rd == nil {
		return &perrs.PlatformError{
			Code:    perrs.InternalError,
			Message: "remote device must be provided",
		}
	}
	tun, err := makeTunFile(fd)
	if err != nil {
		return &perrs.PlatformError{
			Code:    perrs.SetupSystemVPNFailed,
			Message: "failed to create the TUN device",
			Cause:   perrs.ToPlatformError(err),
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

	go vpn.RelayTraffic(rd.rd.ReadWriteCloser, tun)
	go vpn.RelayTraffic(tun, rd.rd.ReadWriteCloser)

	return nil
}

// makeTunFile returns an os.File object from a TUN file descriptor `fd`.
// The returned os.File holds a separate reference to the underlying file,
// so the file will not be closed until both `fd` and the os.File are
// separately closed.  (UNIX only.)
func makeTunFile(fd int) (*os.File, error) {
	if fd < 0 {
		return nil, errors.New("must provide a valid TUN file descriptor")
	}
	// Make a copy of `fd` so that os.File's finalizer doesn't close `fd`.
	newfd, err := unix.Dup(fd)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(newfd), "")
	if file == nil {
		return nil, errors.New("failed to open TUN file descriptor")
	}
	return file, nil
}
