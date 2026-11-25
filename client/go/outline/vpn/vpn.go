// Copyright 2024 The Outline Authors
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

package vpn

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"golang.getoutline.org/sdk/network/packetrelay"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/outline/callback"
)

// Config holds the configuration to establish a system-wide [VPNConnection].
type Config struct {
	ID               string `json:"id"`
	InterfaceName    string `json:"interfaceName"`
	IPAddress        string `json:"ipAddress"`
	DNSLinkLocalAddr string `json:"dnsLinkLocalAddress"`
	ConnectionName   string `json:"connectionName"`
	RoutingTableId   uint32 `json:"routingTableId"`
	RoutingPriority  uint32 `json:"routingPriority"`
	ProtectionMark   uint32 `json:"protectionMark"`
}

// platformVPNConn is an interface representing an OS-specific VPN connection.
type platformVPNConn interface {
	// Establish creates a TUN device and routes all system traffic to it.
	Establish(ctx context.Context) error

	// TUN returns a L3 IP tun device associated with the VPN connection.
	TUN() io.ReadWriteCloser

	// Close terminates the VPN connection and closes the TUN device.
	Close() error
}

// closeTimeout is the maximum time out used in platformVPNConn.Close
const closeTimeout = 10 * time.Second

// ConnectionStatus represents the status of a [VPNConnection].
type ConnectionStatus string

const (
	ConnectionConnected     ConnectionStatus = "Connected"
	ConnectionDisconnected  ConnectionStatus = "Disconnected"
	ConnectionConnecting    ConnectionStatus = "Connecting"
	ConnectionDisconnecting ConnectionStatus = "Disconnecting"
)

// VPNConnection represents a system-wide VPN connection.
type VPNConnection struct {
	ID     string           `json:"id"`
	Status ConnectionStatus `json:"status"`

	statusMu      sync.Mutex
	cancelEst     context.CancelFunc
	wgEst, wgCopy sync.WaitGroup

	proxy    *RemoteDevice
	platform platformVPNConn
}

// The global singleton VPN connection.
// This package allows at most one active VPN connection at the same time.
var mu sync.Mutex
var conn *VPNConnection
var stateChangeCb atomic.Int64

// setStatus sets the [VPNConnection] Status and calls the stateChangeCb callback.
func (c *VPNConnection) setStatus(status ConnectionStatus) {
	c.statusMu.Lock()
	c.Status = status
	connJson, err := json.Marshal(c)
	c.statusMu.Unlock()
	if err == nil {
		callback.DefaultManager().Call(callback.Token(stateChangeCb.Load()), string(connJson))
	} else {
		slog.Warn("failed to marshal VPN connection", "err", err)
	}
}

// SetStateChangeListener sets the given [callback.Token] as a global VPN connection
// state change listener.
// The token should have already been registered with the [callback.DefaultManager].
func SetStateChangeListener(token callback.Token) {
	stateChangeCb.Store(int64(token))
}

// EstablishVPN establishes a new active [VPNConnection] connecting to a [ProxyDevice]
// with the given VPN [Config].
// It first closes any active [VPNConnection] using [CloseVPN], and then marks the
// newly created [VPNConnection] as the currently active connection.
// It returns the new [VPNConnection], or an error if the connection fails.
func EstablishVPN(
	ctx context.Context, conf *Config, sd transport.StreamDialer, pr packetrelay.PacketRelay,
) (_ *VPNConnection, err error) {
	if conf == nil {
		panic("a VPN config must be provided")
	}
	if sd == nil {
		panic("a StreamDialer must be provided")
	}
	if pr == nil {
		panic("a PacketRelay must be provided")
	}

	c := &VPNConnection{ID: conf.ID, Status: ConnectionDisconnected}
	ctx, c.cancelEst = context.WithCancel(ctx)

	if c.platform, err = newPlatformVPNConn(conf); err != nil {
		c.cancelEst()
		return
	}

	c.wgEst.Add(1)
	defer c.wgEst.Done()

	if err = atomicReplaceVPNConn(c); err != nil {
		c.cancelEst()
		c.platform.Close()
		return
	}

	slog.Debug("establishing vpn connection ...", "id", c.ID)
	c.setStatus(ConnectionConnecting)
	defer func() {
		if err == nil {
			c.setStatus(ConnectionConnected)
		} else {
			c.setStatus(ConnectionDisconnected)
		}
	}()

	if c.proxy, err = ConnectRemoteDevice(ctx, sd, pr); err != nil {
		slog.Error("failed to connect to the remote device", "err", err)
		return
	}
	if err = c.proxy.GetHealthStatus(); err != nil {
		slog.Error("remote device is not healthy", "err", err)
		return
	}
	slog.Info("connected to the remote device")

	if err = c.platform.Establish(ctx); err != nil {
		// No need to call c.platform.Close() cuz it's already tracked in the global conn
		return
	}

	c.wgCopy.Go(func() { RelayTraffic(c.proxy, c.platform.TUN()) })
	c.wgCopy.Go(func() { RelayTraffic(c.platform.TUN(), c.proxy) })

	slog.Info("vpn connection established", "id", c.ID)
	return c, nil
}

// CloseVPN terminates the currently active [VPNConnection] and disconnects the proxy.
func CloseVPN() error {
	mu.Lock()
	defer mu.Unlock()
	return closeVPNNoLock()
}

// atomicReplaceVPNConn atomically replaces the global conn with newConn.
func atomicReplaceVPNConn(newConn *VPNConnection) error {
	mu.Lock()
	defer mu.Unlock()
	slog.Debug("replacing the global vpn connection...", "id", newConn.ID)
	if err := closeVPNNoLock(); err != nil {
		return err
	}
	conn = newConn
	slog.Info("global vpn connection replaced", "id", newConn.ID)
	return nil
}

// closeVPNNoLock closes the current VPN connection stored in conn without acquiring
// the mutex. It is assumed that the caller holds the mutex.
func closeVPNNoLock() (err error) {
	c := conn
	if c == nil {
		return nil
	}

	slog.Debug("terminating the global vpn connection...", "id", c.ID)
	c.setStatus(ConnectionDisconnecting)
	defer func() {
		if err == nil {
			slog.Info("vpn connection terminated", "id", c.ID)
			c.setStatus(ConnectionDisconnected)
			conn = nil
		}
	}()

	// Cancel the Establish process and wait
	c.cancelEst()
	c.wgEst.Wait()

	// This is the only error that matters
	if c.platform != nil {
		err = c.platform.Close()
	}

	// TODO: Implement more sophisticated cancellation
	// The proxy's Close method might take a long time to return when there are
	// still outgoing traffic to the proxy in an unreachable network environment.
	// The c.wgCopy will also be blocked forever because we are waiting to copy
	// traffic from the proxy to a local tun device.
	// Therefore we will close the proxy in a goroutine, and wait for wgCopy to be
	// done with a timeout value.

	// We can ignore the following error
	if c.proxy != nil {
		go func() {
			slog.Debug("disconnecting from the remote device ...")
			if err2 := c.proxy.Close(); err2 != nil {
				slog.Warn("failed to disconnect from the remote device")
			} else {
				slog.Info("disconnected from the remote device")
			}
		}()
	}

	closeDone := make(chan struct{})

	// Wait for traffic copy go routines to finish
	go func() {
		c.wgCopy.Wait()
		close(closeDone)
	}()

	select {
	case <-time.After(closeTimeout):
		slog.Warn("disconnect from the remote device timed out")
	case <-closeDone:
	}

	return
}
