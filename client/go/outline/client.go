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

	"golang.getoutline.org/sdk/network/packetrelay"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/outline/configregistry"
	"localhost/client/go/outline/platerrors"
	"localhost/client/go/outline/reporting"
)

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

// ProviderClientConfig is the session config from the service provider.
type ProviderClientConfig struct {
	Transport composer.Node
	Reporter  composer.Node
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
	DataDir         string
	TransportParser *composer.TypeParser[*configregistry.TransportPair]
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
	if clientConfig.TransportParser == nil {
		tcpDialer := &transport.TCPDialer{Dialer: net.Dialer{KeepAlive: -1}}
		udpDialer := &transport.UDPDialer{}
		clientConfig.TransportParser = configregistry.NewDefaultTransportProvider(tcpDialer, udpDialer)
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

	configNode, err := composer.ParseYAML([]byte(providerClientConfigText))
	var fields map[string]composer.Node
	if err == nil && !configNode.IsAbsent() {
		err = configNode.Decode(&fields)
	}
	if err != nil {
		return nil, &platerrors.PlatformError{
			Code:    platerrors.InvalidConfig,
			Message: "config is not valid YAML",
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	// Decode only the envelope so delegated parsers keep the original source
	// locations and anchors. Unknown envelope fields remain allowed.
	providerClientConfig := ProviderClientConfig{Transport: fields["transport"], Reporter: fields["reporter"]}

	transportPair, err := clientConfig.TransportParser.Parse(context.Background(), providerClientConfig.Transport)
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
	if !providerClientConfig.Reporter.IsAbsent() {
		// TODO(fortuna): encapsulate service storage.
		cookieFilename := ""
		if c.DataDir != "" {
			serviceDir := path.Join(c.DataDir, "services", keyID)
			cookieFilename = path.Join(serviceDir, "cookies.json")
		}
		reporter, err := NewReporterParser(cookieFilename, client).Parse(context.Background(), providerClientConfig.Reporter)
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

func NewReporterParser(cookiesFilename string, streamDialer transport.StreamDialer) *composer.TypeParser[reporting.Reporter] {
	parser := composer.NewTypeParser(func(ctx context.Context, input composer.Node) (reporting.Reporter, error) {
		return nil, errors.New("parser not specified")
	})
	parser.RegisterSubParser("first-supported", configregistry.NewFirstSupportedSubParser(parser.Parse))
	parser.RegisterSubParser("http", reporting.NewHTTPReporterConfigParser(cookiesFilename, streamDialer))
	return parser
}
