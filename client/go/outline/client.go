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
	"testing"

	"golang.getoutline.org/sdk/network/packetrelay"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/outline/composerconfig"
	"localhost/client/go/outline/configregistry"
	"localhost/client/go/outline/platerrors"
	"localhost/client/go/outline/reporting"
)

// Client provides a transparent container for [transport.StreamDialer] and [transport.PacketListener]
// that is exportable (as an opaque object) via gobind.
// It's used by the connectivity test and the tun2socks handlers.
//
// A Client serves one session, which ends when EndSession is called. Components built from the
// config that hold resources beyond a single connection release them then. See [netconfig.Session].
// TODO(fortuna):
//   - Add connectivity test to StartSession()
//   - Add NotifyNetworkChange() method. Needs to hold a packetrelay.PacketRelay instead of configregistry.PacketListener
//     to handle that.
//   - Refactor so that StartSession returns a Client
type Client struct {
	sd            *configregistry.Dialer[transport.StreamConn]
	pr            *configregistry.PacketRelay
	reporter      reporting.Reporter
	sessionCtx    context.Context
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
	c.NotifyNetworkChanged()
	if c.reporter != nil {
		go c.reporter.Run(c.sessionCtx)
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
	// DirectStreamDialer and DirectPacketDialer make the connections that leave the device, for
	// example with sockets excluded from the VPN. If nil, New uses a [transport.TCPDialer] with
	// keep-alive disabled and a [transport.UDPDialer].
	DirectStreamDialer transport.StreamDialer
	DirectPacketDialer transport.PacketDialer
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
	if clientConfig.DirectStreamDialer == nil {
		clientConfig.DirectStreamDialer = &transport.TCPDialer{Dialer: net.Dialer{KeepAlive: -1}}
	}
	if clientConfig.DirectPacketDialer == nil {
		clientConfig.DirectPacketDialer = &transport.UDPDialer{}
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

	// The cookies file is derived from the DataDir the caller set, not the default above, as before
	// the move to Composer.
	registry := clientConfig.newRegistry(cookiesFilename(c.DataDir, keyID))
	parsed, err := parseClientConfig(context.Background(), registry, providerClientConfigText)
	if err != nil {
		return nil, err
	}

	sessionCtx, sessionCancel := context.WithCancel(context.Background())
	client, err := parsed.build(netconfig.WithSession(context.Background(), sessionCtx))
	if err != nil {
		sessionCancel()
		return nil, err
	}
	client.sessionCtx, client.sessionCancel = sessionCtx, sessionCancel
	return client, nil
}

// cookiesFilename returns where the reporter of the service keyID keeps its cookies, or "" if
// there is no data directory.
func cookiesFilename(dataDir string, keyID string) string {
	if dataDir == "" {
		return ""
	}
	// TODO(fortuna): encapsulate service storage.
	return path.Join(dataDir, "services", keyID, "cookies.json")
}

// newRegistry returns the Composer registry for client configs: Outline's vocabulary over the
// direct dialers, and the reporters.
func (c *ClientConfig) newRegistry(cookiesFilename string) composer.Registry {
	opts := composerconfig.Options{
		DirectStreamDialer: c.DirectStreamDialer,
		DirectPacketDialer: c.DirectPacketDialer,
	}
	// We need to resolve to the proxy server address before attempting a connection.
	// This is because we cannot protect the system DNS resolution connection
	// with our FW_MARK (Linux) or by binding to an interface (Windows). Therefore, as a workaround on Linux and Windows, we resolve the address first.
	if (runtime.GOOS == "linux" || runtime.GOOS == "windows") && !testing.Testing() {
		opts.ResolveDirect = resolveTCPAddress
	}
	r := composerconfig.NewRegistry(opts)
	composer.Register(r, "http", composer.As[reporting.Config](reporting.NewHTTPConfigParser(cookiesFilename)))
	return r
}

// resolveTCPAddress resolves the host in address with the system resolver. On failure it returns
// address unchanged, so that building doesn't fail and to allow for recovery if the server becomes
// resolvable again.
func resolveTCPAddress(_ context.Context, address string) string {
	ipPort, err := net.ResolveTCPAddr("tcp", address)
	if err != nil {
		return address
	}
	return ipPort.String()
}

// parsedClientConfig is a client config that has been validated and described, and not built.
type parsedClientConfig struct {
	transport     composerconfig.TransportPairConfig
	transportInfo composerconfig.TransportPairInfo
	// reporter is nil if the config has none.
	reporter reporting.Config
}

// parseClientConfig parses the session config from the service provider. It does no I/O.
// Keys other than transport and reporter are ignored.
func parseClientConfig(ctx context.Context, registry composer.Registry, text string) (*parsedClientConfig, error) {
	root, err := composer.ParseYAML([]byte(text))
	var keys map[string]composer.Node
	if err == nil && !root.IsAbsent() {
		err = root.Decode(&keys)
	}
	if err != nil {
		return nil, &platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "config is not valid YAML",
			Cause:   platerrors.ToPlatformError(err),
		}
	}

	transportConfig, transportInfo, err := composerconfig.ParseTransport(ctx, registry, keys["transport"])
	if err != nil {
		return nil, transportError(err)
	}
	parsed := &parsedClientConfig{transport: transportConfig, transportInfo: transportInfo}

	if reporterNode := keys["reporter"]; !reporterNode.IsAbsent() {
		parsed.reporter, err = composer.Parse[reporting.Config](ctx, registry, reporterNode)
		if err != nil {
			return nil, reporterError(err)
		}
	}
	return parsed, nil
}

// build creates the client. Built components get the session from ctx.
func (p *parsedClientConfig) build(ctx context.Context) (*Client, error) {
	pair, err := p.transport.NewTransportPair(ctx)
	if err != nil {
		return nil, transportError(err)
	}
	// Outline's DNS policy applies to every transport, after it is built.
	wrapped, err := configregistry.WrapTransportPairWithOutlineDNS(
		&configregistry.Dialer[transport.StreamConn]{
			ConnectionProviderInfo: p.transportInfo.Stream,
			Dial:                   pair.StreamDialer.DialStream,
		},
		&configregistry.PacketListener{
			ConnectionProviderInfo: p.transportInfo.Packet,
			PacketListener:         pair.PacketListener,
		},
	)
	if err != nil {
		return nil, transportError(err)
	}
	client := &Client{sd: wrapped.StreamDialer, pr: wrapped.PacketRelay}

	if p.reporter != nil {
		// The reporter sends its reports through the transport.
		client.reporter, err = p.reporter.NewReporter(ctx, client)
		if err != nil {
			return nil, reporterError(err)
		}
	}
	return client, nil
}

func transportError(err error) error {
	if errors.Is(err, errors.ErrUnsupported) {
		return &platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "unsupported config",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	return &platerrors.PlatformError{
		Code:    platerrors.InvalidConfig,
		Message: "failed to create transport",
		Cause:   platerrors.ToPlatformError(err),
	}
}

func reporterError(err error) error {
	return &platerrors.PlatformError{
		Code:    platerrors.InvalidConfig,
		Message: "invalid reporter config",
		Cause:   platerrors.ToPlatformError(err),
	}
}
