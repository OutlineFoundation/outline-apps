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

package outline

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"os"
	"path"
	"runtime"

	"localhost/client/go/composer"
	"localhost/client/go/outline/configregistry"
	"localhost/client/go/outline/platerrors"
	"localhost/client/go/outline/reporting"
	"golang.getoutline.org/sdk/network/packetrelay"
	"golang.getoutline.org/sdk/transport")

// Client provides a transparent container for [transport.StreamDialer] and [transport.PacketListener]
// that is exportable (as an opaque object) via gobind.
// It's used by the connectivity test and the tun2socks handlers.
// TODO(fortuna):
//   - Add connectivity test to StartSession()
//   - Add NotifyNetworkChange() method. Needs to hold a packetrelay.PacketRelay instead of configregistry.PacketListener
//     to handle that.
//   - Refactor so that StartSession returns a Client
type Client struct {
	sd            *configregistry.Dialer[transport.StreamConn]
	pr            *configregistry.PacketRelay
	reporter      reporting.Reporter
	sessionCancel context.CancelFunc
}

// DialStream implements StreamDialer.DialStream.
func (c *Client) DialStream(ctx context.Context, address string) (transport.StreamConn, error) {
	return c.sd.Dial(ctx, address)
}

// NewAssociation implements packetrelay.PacketRelay.NewAssociation.
func (c *Client) NewAssociation() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
	return c.pr.NewAssociation()
}

func (c *Client) NotifyNetworkChanged() {
	if c.pr.NotifyNetworkChanged != nil {
		c.pr.NotifyNetworkChanged()
	}
}

func (c *Client) StartSession() error {
	slog.Debug("Starting session")
	var sessionCtx context.Context
	sessionCtx, c.sessionCancel = context.WithCancel(context.Background())
	c.NotifyNetworkChanged()
	if c.reporter != nil {
		go c.reporter.Run(sessionCtx)
	}
	return nil
}

func (c *Client) EndSession() error {
	slog.Debug("Ending session")
	c.sessionCancel()
	return nil
}

// NewClientResult represents the result of [NewClientAndReturnError].
//
// We use a struct instead of a tuple to preserve a strongly typed error that gobind recognizes.
type NewClientResult struct {
	Client *Client
	Error  *platerrors.PlatformError
}

// ClientConfig is used to create a session Client.
type ClientConfig struct {
	DataDir string
	// Registry holds the parsers of the config types. If nil, New uses [configregistry.NewRegistry]
	// with a [transport.TCPDialer] with keep-alive disabled and a [transport.UDPDialer]. To support
	// more config types, register them on a registry from [configregistry.NewRegistry].
	Registry composer.Registry
}

// New creates a new session client. It's used by the native code, so it returns a NewClientResult.
func (c *ClientConfig) New(keyID string, providerClientConfigText string) *NewClientResult {
	client, err := c.new(keyID, providerClientConfigText)
	if err != nil {
		return &NewClientResult{Error: platerrors.ToPlatformError(err)}
	}
	return &NewClientResult{Client: client}
}

// new creates a new session client.
func (c *ClientConfig) new(keyID string, providerClientConfigText string) (*Client, error) {
	// Make a copy of the config so we can change it.
	clientConfig := *c
	if clientConfig.Registry == nil {
		tcpDialer := &transport.TCPDialer{Dialer: net.Dialer{KeepAlive: -1}}
		udpDialer := &transport.UDPDialer{}
		clientConfig.Registry = configregistry.NewRegistry(tcpDialer, udpDialer)
	}
	if clientConfig.DataDir == "" {
		if runtime.GOOS != "android" && runtime.GOOS != "ios" {
			userDir, err := os.UserConfigDir()
			if err != nil {
				slog.Error("failed to get user config dir", "err", err)
			} else {
				clientConfig.DataDir = path.Join(userDir, "org.getoutline.client")
			}
		}
	}

	// The session config from the service provider. Keys other than transport and reporter are ignored.
	var providerClientConfig map[string]composer.Node
	root, err := composer.ParseYAML([]byte(providerClientConfigText))
	if err == nil && !root.IsAbsent() {
		err = root.Decode(&providerClientConfig)
	}
	if err != nil {
		return nil, &platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "config is not valid YAML",
			Cause:   platerrors.ToPlatformError(err),
		}
	}

	transportPair, err := composer.Parse[*configregistry.TransportPair](context.Background(), clientConfig.Registry, providerClientConfig["transport"])
	if err != nil {
		if errors.Is(err, errors.ErrUnsupported) {
			return nil, &platerrors.PlatformError{
				Code:    platerrors.InvalidConfig,
				Message: "unsupported config",
				Cause:   platerrors.ToPlatformError(err),
			}
		} else {
			return nil, &platerrors.PlatformError{
				Code:    platerrors.InvalidConfig,
				Message: "failed to create transport",
				Cause:   platerrors.ToPlatformError(err),
			}
		}
	}

	client := &Client{sd: transportPair.StreamDialer, pr: transportPair.PacketRelay}

	// TODO: figure out a better way to handle parse calls.
	if reporterNode := providerClientConfig["reporter"]; !reporterNode.IsAbsent() {
		// TODO(fortuna): encapsulate service storage.
		cookieFilename := ""
		if c.DataDir != "" {
			serviceDir := path.Join(c.DataDir, "services", keyID)
			cookieFilename = path.Join(serviceDir, "cookies.json")
		}
		reporter, err := composer.Parse[reporting.Reporter](context.Background(), NewReporterRegistry(cookieFilename, client), reporterNode)
		if err != nil {
			return nil, &platerrors.PlatformError{
				Code:    platerrors.InvalidConfig,
				Message: "invalid reporter config",
				Cause:   platerrors.ToPlatformError(err),
			}
		}
		client.reporter = reporter
	}

	return client, nil
}

// NewReporterRegistry returns the registry with the reporter config types. The reporters send their
// reports with streamDialer, and keep their cookies in cookiesFilename.
func NewReporterRegistry(cookiesFilename string, streamDialer transport.StreamDialer) composer.MutableRegistry {
	// The registry comes with first-supported for every type.
	r := composer.NewRegistry()
	composer.Register(r, "http", reporting.NewHTTPReporterConfigParser(cookiesFilename, streamDialer))
	return r
}
