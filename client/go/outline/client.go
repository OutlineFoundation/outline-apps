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
	"fmt"
	"log/slog"
	"net"
	"os"
	"path"
	"runtime"

	"golang.getoutline.org/sdk/network/packetrelay"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/registry"
	"localhost/client/go/outline/configregistry"
	"localhost/client/go/outline/platerrors"
	"localhost/client/go/outline/reporting"
)

// Client provides a transparent container for [transport.StreamDialer] and [transport.PacketListener]
// that is exportable (as an opaque object) via gobind.
// It's used by the connectivity test and the tun2socks handlers.
// TODO(fortuna):
//   - Add connectivity test to StartSession()
type Client struct {
	sd                   transport.StreamDialer
	sdInfo               configregistry.ConnectionProviderInfo
	pr                   packetrelay.PacketRelay
	prInfo               configregistry.ConnectionProviderInfo
	notifyNetworkChanged func()
	reporter             reporting.Reporter
	sessionCancel        context.CancelFunc
}

// DialStream implements StreamDialer.DialStream.
func (c *Client) DialStream(ctx context.Context, address string) (transport.StreamConn, error) {
	return c.sd.DialStream(ctx, address)
}

// NewAssociation implements packetrelay.PacketRelay.NewAssociation.
func (c *Client) NewAssociation() (packetrelay.PacketSender, packetrelay.PacketReceiver, error) {
	return c.pr.NewAssociation()
}

func (c *Client) NotifyNetworkChanged() {
	if c.notifyNetworkChanged != nil {
		c.notifyNetworkChanged()
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
	DataDir  string
	Composer registry.Composer
}

// ParsedClient is the result of parsing a provider client config. It
// holds everything needed to build a [Client], without yet having
// built any network resources.
type ParsedClient struct {
	Transport    configregistry.TransportPairConfig
	Info         configregistry.TransportPairInfo
	reporterNode composer.Node
	keyID        string
	dataDir      string
}

// ParseConfig parses providerClientConfigText into a [ParsedClient],
// without building any network resources.
func (c *ClientConfig) ParseConfig(keyID, providerClientConfigText string) (*ParsedClient, error) {
	clientComposer := c.Composer
	if clientComposer == nil {
		tcpDialer := &transport.TCPDialer{Dialer: net.Dialer{KeepAlive: -1}}
		udpDialer := &transport.UDPDialer{}
		var err error
		clientComposer, err = NewClientComposer(tcpDialer, udpDialer)
		if err != nil {
			return nil, &platerrors.PlatformError{Code: platerrors.InternalError,
				Message: "failed to create client composer", Cause: platerrors.ToPlatformError(err)}
		}
	}
	parseTransport := registry.Parser(clientComposer, configregistry.TransportPairKind)
	dataDir := c.DataDir
	if dataDir == "" && runtime.GOOS != "android" && runtime.GOOS != "ios" {
		if userDir, err := os.UserConfigDir(); err == nil {
			dataDir = path.Join(userDir, "org.getoutline.client")
		} else {
			slog.Error("failed to get user config dir", "err", err)
		}
	}

	root, err := composer.ParseYAML([]byte(providerClientConfigText))
	if err != nil {
		return nil, &platerrors.PlatformError{Code: platerrors.InvalidConfig,
			Message: "config is not valid YAML", Cause: platerrors.ToPlatformError(err)}
	}
	// Decode the envelope as an open map, not a strict struct: the legacy
	// parser silently ignored unknown top-level keys (e.g. provider
	// metadata, or an `error: null` key passed through by
	// doParseTunnelConfig), and composer map targets preserve that
	// behavior by taking keys verbatim with no unknown-field checks.
	envelope := map[string]composer.Node{}
	if !root.IsAbsent() {
		if err := root.Decode(&envelope); err != nil {
			return nil, &platerrors.PlatformError{Code: platerrors.InvalidConfig,
				Message: "invalid config", Cause: platerrors.ToPlatformError(err)}
		}
	}
	transportNode := envelope["transport"]
	reporterNode := envelope["reporter"]

	transportCfg, err := parseTransport(context.Background(), transportNode)
	if err != nil {
		code := platerrors.InvalidConfig
		msg := "failed to create transport"
		if errors.Is(err, errors.ErrUnsupported) {
			msg = "unsupported config"
		}
		return nil, &platerrors.PlatformError{Code: code, Message: msg, Cause: platerrors.ToPlatformError(err)}
	}
	info, err := configregistry.NewConnectionAnalyzer().AnalyzeTransport(transportCfg)
	if err != nil {
		return nil, &platerrors.PlatformError{Code: platerrors.InternalError,
			Message: "failed to analyze transport config", Cause: platerrors.ToPlatformError(err)}
	}
	return &ParsedClient{Transport: transportCfg, Info: info,
		reporterNode: reporterNode, keyID: keyID, dataDir: dataDir}, nil
}

// NewClientComposer registers Outline's config vocabulary and returns a Composer
// ready to parse client configurations.
func NewClientComposer(directSD transport.StreamDialer, directPD transport.PacketDialer) (registry.Composer, error) {
	r := registry.New()
	if err := configregistry.Register(r, directSD, directPD); err != nil {
		return nil, fmt.Errorf("register Outline config: %w", err)
	}
	return r, nil
}

// NewClient builds a [Client] from a [ParsedClient], creating the
// network resources (dialers, listeners, reporters).
func (p *ParsedClient) NewClient() (*Client, error) {
	parts, err := p.Transport.NewTransportPair(context.Background())
	if err != nil {
		return nil, &platerrors.PlatformError{Code: platerrors.InvalidConfig,
			Message: "failed to create transport", Cause: platerrors.ToPlatformError(err)}
	}
	sd, relay, onNetworkChanged, err := configregistry.NewOutlineDNSTransport(parts.StreamDialer, parts.PacketListener)
	if err != nil {
		return nil, &platerrors.PlatformError{Code: platerrors.InternalError,
			Message: "failed to set up DNS handling", Cause: platerrors.ToPlatformError(err)}
	}
	client := &Client{sd: sd, sdInfo: p.Info.Stream, pr: relay, prInfo: p.Info.Packet,
		notifyNetworkChanged: onNetworkChanged}

	if !p.reporterNode.IsAbsent() {
		cookieFilename := ""
		if p.dataDir != "" {
			cookieFilename = path.Join(p.dataDir, "services", p.keyID, "cookies.json")
		}
		reporter, err := NewReporterParser(cookieFilename, client).Parse(context.Background(), p.reporterNode)
		if err != nil {
			return nil, &platerrors.PlatformError{Code: platerrors.InvalidConfig,
				Message: "invalid reporter config", Cause: platerrors.ToPlatformError(err)}
		}
		client.reporter = reporter
	}
	return client, nil
}

// New creates a new session client. It's used by the native code, so it returns a NewClientResult.
func (c *ClientConfig) New(keyID string, providerClientConfigText string) *NewClientResult {
	parsed, err := c.ParseConfig(keyID, providerClientConfigText)
	if err != nil {
		return &NewClientResult{Error: platerrors.ToPlatformError(err)}
	}
	client, err := parsed.NewClient()
	if err != nil {
		return &NewClientResult{Error: platerrors.ToPlatformError(err)}
	}
	return &NewClientResult{Client: client}
}

func NewReporterParser(cookiesFilename string, streamDialer transport.StreamDialer) *composer.TypeParser[reporting.Reporter] {
	parser := composer.NewTypeParser(func(ctx context.Context, node composer.Node) (reporting.Reporter, error) {
		return nil, errors.New("parser not specified")
	})
	// first-supported is built into composer.NewTypeParser.
	parser.RegisterSubParser("http", reporting.NewHTTPReporterConfigParser(cookiesFilename, streamDialer))
	return parser
}
