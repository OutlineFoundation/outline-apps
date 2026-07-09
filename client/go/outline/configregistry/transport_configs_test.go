package configregistry

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
	"localhost/client/go/outline/connmeta"
)

func parseTransport(t *testing.T, text string) (TransportPairConfig, *connmeta.Table) {
	t.Helper()
	parser := NewComposerTransportParser(&transport.TCPDialer{}, &transport.UDPDialer{})
	node, err := composer.ParseYAML([]byte(text))
	require.NoError(t, err)
	ctx, table := connmeta.WithTable(context.Background())
	cfg, err := parser.Parse(ctx, node)
	require.NoError(t, err)
	return cfg, table
}

func requirePairInfo(t *testing.T, table *connmeta.Table, cfg TransportPairConfig) TransportPairInfo {
	t.Helper()
	info, ok := connmeta.Get[TransportPairInfo](table, cfg)
	require.True(t, ok, "transport pair info missing")
	return info
}

func TestTransport_LegacySSURL(t *testing.T) {
	cfg, table := parseTransport(t, `"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@example.com:1234"`)
	info := requirePairInfo(t, table, cfg)
	require.Equal(t, ConnTypeTunneled, info.Stream.ConnType)
	require.Equal(t, "example.com:1234", info.Stream.FirstHop)
	require.Equal(t, ConnTypeTunneled, info.Packet.ConnType)

	parts, err := cfg.NewTransportPair(context.Background())
	require.NoError(t, err)
	require.NotNil(t, parts.StreamDialer)
	require.NotNil(t, parts.PacketListener)
}

func TestTransport_LegacyMappingNoType(t *testing.T) {
	cfg, table := parseTransport(t, `
server: example.com
server_port: 1234
method: chacha20-ietf-poly1305
password: SECRET
`)
	info := requirePairInfo(t, table, cfg)
	require.Equal(t, "example.com:1234", info.Stream.FirstHop)
	_ = cfg
}

func TestTransport_TCPUDP(t *testing.T) {
	cfg, table := parseTransport(t, `
$type: tcpudp
tcp:
  $type: shadowsocks
  endpoint: example.com:1234
  cipher: chacha20-ietf-poly1305
  secret: SECRET
udp:
  $type: shadowsocks
  endpoint: example.com:5678
  cipher: chacha20-ietf-poly1305
  secret: SECRET
`)
	info := requirePairInfo(t, table, cfg)
	require.Equal(t, "example.com:1234", info.Stream.FirstHop)
	require.Equal(t, "example.com:5678", info.Packet.FirstHop)
}

func TestTransport_TCPUDP_DefaultsToDirect(t *testing.T) {
	cfg, table := parseTransport(t, "$type: tcpudp")
	info := requirePairInfo(t, table, cfg)
	require.Equal(t, ConnTypeDirect, info.Stream.ConnType)
	require.Equal(t, ConnTypeDirect, info.Packet.ConnType)
	_ = cfg
}

func TestTransport_BasicAccess(t *testing.T) {
	cfg, table := parseTransport(t, "$type: basic-access")
	info := requirePairInfo(t, table, cfg)
	require.Equal(t, ConnTypeDirect, info.Stream.ConnType)
	parts, err := cfg.NewTransportPair(context.Background())
	require.NoError(t, err)
	require.NotNil(t, parts.StreamDialer)
}

func TestTransport_FirstSupported(t *testing.T) {
	cfg, table := parseTransport(t, `
$type: first-supported
options:
  - $type: warp-drive
  - $type: tcpudp
`)
	info := requirePairInfo(t, table, cfg)
	require.Equal(t, ConnTypeDirect, info.Stream.ConnType)
	_ = cfg
}
