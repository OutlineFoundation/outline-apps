// Copyright 2026 The Outline Authors
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

package composerconfig

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/composer/netconfig"
	"localhost/client/go/configyaml"
	"localhost/client/go/outline/configregistry"
)

const (
	ssTCP = "{$type: shadowsocks, endpoint: 'ss.example.com:4321', cipher: chacha20-ietf-poly1305, secret: SECRET}"
)

// corpus holds transport configs: the examples documented at
// https://developer.getoutline.org/vpn/reference/access-key-config/, legacy
// access-key forms, and structural cases.
var corpus = []struct{ name, yaml string }{
	{"ss URL", `"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@example.com:1234"`},
	{"ss URL with prefix", `"ss://chacha20-ietf-poly1305:SECRET@example.com:443?prefix=POST%20"`},
	{"legacy JSON", `{"server": "example.com", "server_port": 1234, "method": "chacha20-ietf-poly1305", "password": "SECRET"}`},
	{"legacy mapping with prefix", "server: example.com\nserver_port: 4321\nmethod: chacha20-ietf-poly1305\npassword: SECRET\nprefix: \"POST \"\n"},
	{"shadowsocks fields without $type", "endpoint: example.com:80\ncipher: chacha20-ietf-poly1305\nsecret: SECRET\nprefix: \"POST \"\n"},
	{"tcpudp shadowsocks", `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint: ss.example.com:4321
  cipher: chacha20-ietf-poly1305
  secret: SECRET
  prefix: "POST "
udp:
  $type: shadowsocks
  endpoint: ss.example.com:4321
  cipher: chacha20-ietf-poly1305
  secret: SECRET
`},
	{"alias shared between tcp and udp", `
$type: tcpudp
tcp: &shared
  $type: shadowsocks
  endpoint: example.com:1234
  cipher: chacha20-ietf-poly1305
  secret: SECRET
udp: *shared
`},
	{"merge key with override", `
$type: tcpudp
tcp:
  <<: &shared
    $type: shadowsocks
    endpoint: ss.example.com:4321
    cipher: chacha20-ietf-poly1305
    secret: SECRET
  prefix: "POST "
udp: *shared
`},
	{"merge key, different endpoints", `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint: ss.example.com:80
  <<: &cipher
    cipher: chacha20-ietf-poly1305
    secret: SECRET
  prefix: "POST "
udp:
  $type: shadowsocks
  endpoint: ss.example.com:53
  <<: *cipher
`},
	{"shadowsocks over websocket", `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint:
      $type: websocket
      url: wss://ws.example.com/SECRET_PATH/tcp
  cipher: chacha20-ietf-poly1305
  secret: SS_SECRET
udp:
  $type: shadowsocks
  endpoint:
      $type: websocket
      url: wss://ws.example.com/SECRET_PATH/udp
  cipher: chacha20-ietf-poly1305
  secret: SS_SECRET
`},
	{"websocket with custom endpoint", `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint:
      $type: websocket
      url: wss://ws.example.com/SECRET_PATH/tcp
      endpoint: cloudflare.net:443
  cipher: chacha20-ietf-poly1305
  secret: SS_SECRET
udp:
  $type: shadowsocks
  endpoint:
      $type: websocket
      url: wss://ws.example.com/SECRET_PATH/udp
      endpoint: cloudflare.net:443
  cipher: chacha20-ietf-poly1305
  secret: SS_SECRET
`},
	{"first-supported picks websocket", `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint:
    $type: first-supported
    options:
      - $type: websocket
        url: wss://ws.example.com/SECRET_PATH/tcp
      - ss.example.com:4321
  cipher: chacha20-ietf-poly1305
  secret: SS_SECRET
udp:
  $type: shadowsocks
  endpoint:
    $type: first-supported
    options:
      - $type: websocket
        url: wss://ws.example.com/SECRET_PATH/udp
      - ss.example.com:4321
  cipher: chacha20-ietf-poly1305
  secret: SS_SECRET
`},
	{"first-supported skips an unknown type", `
$type: tcpudp
tcp:
  $type: first-supported
  options:
    - {$type: from-the-future, speed: ludicrous}
    - ` + ssTCP + `
`},
	{"first-supported at the transport level", `
$type: first-supported
options:
  - {$type: from-the-future}
  - {$type: tcpudp, tcp: ` + ssTCP + `}
`},
	{"multi-hop", `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint:
    $type: dial
    address: exit.example.com:4321
    dialer:
      $type: shadowsocks
      endpoint: entry.example.com:4321
      cipher: chacha20-ietf-poly1305
      secret: ENTRY_SECRET
  cipher: chacha20-ietf-poly1305
  secret: EXIT_SECRET
udp:
  $type: shadowsocks
  endpoint: ss.example.com:4321
  cipher: chacha20-ietf-poly1305
  secret: SECRET
`},
	{"iptable: block some, direct otherwise", `
$type: tcpudp
tcp:
  $type: iptable
  table:
    - ips: [192.0.2.0/24]
      dialer: {$type: block}
  fallback: {$type: direct}
udp:
  $type: shadowsocks
  endpoint: example.com:1234
  cipher: chacha20-ietf-poly1305
  secret: SECRET
`},
	{"iptable: partial", `
$type: tcpudp
tcp:
  $type: iptable
  table:
    - ips: [192.0.2.0/24, 2001:db8::1]
      dialer: {$type: direct}
  fallback: ` + ssTCP + `
`},
	{"iptable: all tunneled, no fallback", `
$type: tcpudp
tcp:
  $type: iptable
  table:
    - ips: [192.0.2.7]
      dialer: ` + ssTCP + `
`},
	{"direct tcp, default udp", "$type: tcpudp\ntcp: {$type: direct}\n"},
	{"block tcp, default udp", "$type: tcpudp\ntcp: {$type: block}\n"},
	{"tcpudp with everything omitted", "$type: tcpudp\n"},
	{"ss URL as the tcp dialer", "$type: tcpudp\ntcp: \"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@example.com:1234\"\n"},
	{"packet dialer forms", `
$type: tcpudp
udp:
  $type: shadowsocks
  endpoint:
    $type: dial
    address: exit.example.com:53
    dialer: {$type: shadowsocks, endpoint: 'entry.example.com:53', cipher: chacha20-ietf-poly1305, secret: SECRET}
  cipher: chacha20-ietf-poly1305
  secret: SECRET
`},
	{"basic-access", "$type: basic-access\n"},
	{"scalar coercion: numeric secret", "$type: tcpudp\ntcp: {$type: shadowsocks, endpoint: 'ss.example.com:4321', cipher: chacha20-ietf-poly1305, secret: 123456}\n"},
	{"scalar coercion: quoted port", `{"server": "example.com", "server_port": "1234", "method": "chacha20-ietf-poly1305", "password": "SECRET"}`},
	{"scalar coercion: numeric password", `{"server": "example.com", "server_port": 1234, "method": "chacha20-ietf-poly1305", "password": 123456}`},

	// Rejected configs.
	{"error: unknown transport type", "$type: from-the-future\n"},
	{"error: unknown field", "$type: tcpudp\ntcp: {$type: shadowsocks, address: 'ss.example.com:4321', cipher: chacha20-ietf-poly1305, secret: SECRET}\n"},
	{"error: bad cipher", "$type: tcpudp\ntcp: {$type: shadowsocks, endpoint: 'ss.example.com:4321', cipher: rot13, secret: SECRET}\n"},
	{"error: mapping dialer without $type", "$type: tcpudp\ntcp: {endpoint: 'ss.example.com:4321'}\n"},
	{"error: endpoint without port", "$type: tcpudp\ntcp: {$type: shadowsocks, endpoint: ss.example.com, cipher: chacha20-ietf-poly1305, secret: SECRET}\n"},
	{"error: first-supported with nothing supported", "$type: first-supported\noptions: [{$type: a}, {$type: b}]\n"},
	{"error: first-supported with no options", "$type: first-supported\noptions: []\n"},
	{"error: empty iptable", "$type: tcpudp\ntcp: {$type: iptable, table: []}\n"},
	{"error: bad iptable prefix", "$type: tcpudp\ntcp: {$type: iptable, table: [{ips: [nope], dialer: {$type: direct}}]}\n"},
	{"error: top-level shadowsocks $type", "$type: shadowsocks\nendpoint: example.com:4321\ncipher: chacha20-ietf-poly1305\nsecret: SECRET\n"},
}

// legacyUnreadable lists corpus entries that the legacy YAML decoding fails to
// read, with the metadata the new parser must report for them.
var legacyUnreadable = map[string]TransportPairInfo{
	// An anchor defined inside a merge value and reused outside it. This is
	// the documented "YAML Anchors with Merge Key" example.
	"merge key with override": {
		Stream: ConnInfo{ConnType: configregistry.ConnTypeTunneled, FirstHop: "ss.example.com:4321"},
		Packet: ConnInfo{ConnType: configregistry.ConnTypeTunneled, FirstHop: "ss.example.com:4321"},
	},
}

// nowUnsupported lists rejected corpus entries whose error the legacy parser
// reports as invalid and the new parser reports as unsupported. Composer
// treats a field this client does not know as a capability it lacks, so that
// first-supported can fall back to another option.
var nowUnsupported = map[string]bool{
	"error: unknown field": true,
}

// TestMatchesLegacyParser checks that the new parser agrees with the parser
// currently on master, config by config: same acceptance, same error
// category, same connection types, and same first hops.
func TestMatchesLegacyParser(t *testing.T) {
	bases := Options{DirectStreamDialer: &transport.TCPDialer{}, DirectPacketDialer: &transport.UDPDialer{}}
	legacy := configregistry.NewDefaultTransportProvider(bases.DirectStreamDialer, bases.DirectPacketDialer)
	registry := NewRegistry(bases)
	for _, tc := range corpus {
		t.Run(tc.name, func(t *testing.T) {
			node, err := composer.ParseYAML([]byte(tc.yaml))
			require.NoError(t, err)
			_, got, gotErr := ParseTransport(context.Background(), registry, node)

			legacyNode, err := configyaml.ParseConfigYAML(tc.yaml)
			if err != nil {
				// The legacy YAML decoding cannot read this document at all.
				require.Contains(t, legacyUnreadable, tc.name, "legacy YAML error: %v", err)
				require.NoError(t, gotErr)
				require.Equal(t, legacyUnreadable[tc.name], got)
				return
			}
			want, wantErr := legacy.Parse(context.Background(), legacyNode)

			if wantErr != nil {
				require.Error(t, gotErr, "legacy parser rejects this config: %v", wantErr)
				if nowUnsupported[tc.name] {
					require.NotErrorIs(t, wantErr, errors.ErrUnsupported)
					require.ErrorIs(t, gotErr, errors.ErrUnsupported)
					return
				}
				require.Equal(t, errors.Is(wantErr, errors.ErrUnsupported), errors.Is(gotErr, errors.ErrUnsupported),
					"unsupported classification differs\nlegacy: %v\nnew:    %v", wantErr, gotErr)
				return
			}
			require.NoError(t, gotErr)
			require.Equal(t, want.StreamDialer.ConnectionProviderInfo, got.Stream, "stream")
			require.Equal(t, want.PacketRelay.ConnectionProviderInfo, got.Packet, "packet")
		})
	}
}

// probeDialer records the addresses it is asked to dial and connects to none.
type probeDialer struct {
	mu     sync.Mutex
	dialed []string
}

var errProbe = errors.New("probe: not connecting")

func (d *probeDialer) record(address string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.dialed = append(d.dialed, address)
}

func (d *probeDialer) DialStream(_ context.Context, address string) (transport.StreamConn, error) {
	d.record(address)
	return nil, errProbe
}

func (d *probeDialer) DialPacket(_ context.Context, address string) (net.Conn, error) {
	d.record(address)
	return nil, errProbe
}

// TestFirstHopIsWhatGetsDialed checks the metadata against behavior. It
// builds each config over base dialers that only record, makes one stream
// connection, and compares what reached the device's network with the
// reported first hop. Describe is not consulted to get the expected value.
func TestFirstHopIsWhatGetsDialed(t *testing.T) {
	const destination = "198.51.100.1:443"
	for _, tc := range corpus {
		t.Run(tc.name, func(t *testing.T) {
			probe := &probeDialer{}
			registry := NewRegistry(Options{DirectStreamDialer: probe, DirectPacketDialer: probe})
			node, err := composer.ParseYAML([]byte(tc.yaml))
			require.NoError(t, err)
			cfg, info, err := ParseTransport(context.Background(), registry, node)
			if err != nil {
				t.Skip("config is rejected")
			}
			if _, isBasicAccess := cfg.(*BasicAccessTransportConfig); isBasicAccess {
				t.Skip("basic-access does not use the injected dialers")
			}
			require.Empty(t, probe.dialed, "parsing must not dial")

			pair, err := cfg.NewTransportPair(context.Background())
			require.NoError(t, err)
			require.Empty(t, probe.dialed, "building must not dial")

			_, err = pair.StreamDialer.DialStream(context.Background(), destination)
			require.Error(t, err)
			switch info.Stream.ConnType {
			case configregistry.ConnTypeTunneled:
				if info.Stream.FirstHop == "" {
					t.Skip("a routing table reports no single first hop")
				}
				require.Equal(t, []string{info.Stream.FirstHop}, probe.dialed)
			case configregistry.ConnTypeDirect:
				require.Equal(t, []string{destination}, probe.dialed)
			case configregistry.ConnTypeBlocked:
				require.Empty(t, probe.dialed)
			}
		})
	}
}

// TestMissingMetadataIsAnError checks that a component Describe does not know
// fails loudly, rather than reading as direct.
func TestMissingMetadataIsAnError(t *testing.T) {
	registry := NewRegistry(Options{})
	composer.Register(registry, "bare", func(context.Context, composer.Registry, composer.Node) (netconfig.StreamDialerConfig, error) {
		return &bareConfig{}, nil
	})
	node, err := composer.ParseYAML([]byte("$type: tcpudp\ntcp: {$type: bare}\n"))
	require.NoError(t, err)
	_, _, err = ParseTransport(context.Background(), registry, node)
	require.ErrorIs(t, err, ErrNoConnInfo)
}

// bareConfig is a stream dialer config that Describe does not know.
type bareConfig struct{}

func (*bareConfig) NewStreamDialer(context.Context) (transport.StreamDialer, error) {
	return &transport.TCPDialer{}, nil
}

// TestResolveDirectAtBuildTime checks Outline's policy for direct endpoints:
// the address is resolved when the endpoint is built, not when it is parsed;
// the reported first hop and the parsed config keep the address as written;
// and endpoints reached through a proxy are left alone.
func TestResolveDirectAtBuildTime(t *testing.T) {
	probe := &probeDialer{}
	var resolved []string
	registry := NewRegistry(Options{
		DirectStreamDialer: probe,
		DirectPacketDialer: probe,
		ResolveDirect: func(_ context.Context, address string) string {
			resolved = append(resolved, address)
			return "203.0.113.9:4321"
		},
	})
	node, err := composer.ParseYAML([]byte(`
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint:
    $type: dial
    address: exit.example.com:4321
    dialer: {$type: shadowsocks, endpoint: 'entry.example.com:4321', cipher: chacha20-ietf-poly1305, secret: SECRET}
  cipher: chacha20-ietf-poly1305
  secret: SECRET
udp: {$type: shadowsocks, endpoint: 'entry.example.com:53', cipher: chacha20-ietf-poly1305, secret: SECRET}
`))
	require.NoError(t, err)
	cfg, info, err := ParseTransport(context.Background(), registry, node)
	require.NoError(t, err)
	require.Empty(t, resolved, "parsing must not resolve")
	require.Equal(t, "entry.example.com:4321", info.Stream.FirstHop)
	require.Equal(t, "entry.example.com:53", info.Packet.FirstHop)

	pair, err := cfg.NewTransportPair(context.Background())
	require.NoError(t, err)
	require.Equal(t, []string{"entry.example.com:4321", "entry.example.com:53"}, resolved,
		"only the direct endpoints are resolved")

	_, err = pair.StreamDialer.DialStream(context.Background(), "192.0.2.1:443")
	require.ErrorIs(t, err, errProbe)
	require.Equal(t, []string{"203.0.113.9:4321"}, probe.dialed)

	_, info, err = ParseTransport(context.Background(), registry, node)
	require.NoError(t, err)
	require.Equal(t, "entry.example.com:4321", info.Stream.FirstHop, "a build does not modify the parsed config")
}

// TestResolveDirectMatchesLegacyMetadata checks that resolving direct
// endpoints changes no reported metadata.
func TestResolveDirectMatchesLegacyMetadata(t *testing.T) {
	plain := NewRegistry(Options{DirectStreamDialer: &transport.TCPDialer{}, DirectPacketDialer: &transport.UDPDialer{}})
	resolving := NewRegistry(Options{
		DirectStreamDialer: &transport.TCPDialer{},
		DirectPacketDialer: &transport.UDPDialer{},
		ResolveDirect:      func(context.Context, string) string { return "203.0.113.9:1" },
	})
	for _, tc := range corpus {
		t.Run(tc.name, func(t *testing.T) {
			node, err := composer.ParseYAML([]byte(tc.yaml))
			require.NoError(t, err)
			_, want, wantErr := ParseTransport(context.Background(), plain, node)
			_, got, gotErr := ParseTransport(context.Background(), resolving, node)
			require.Equal(t, wantErr == nil, gotErr == nil, "plain: %v\nresolving: %v", wantErr, gotErr)
			require.Equal(t, want, got)
		})
	}
}
