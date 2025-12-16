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
	"io"
	"os"
	"path"
	"testing"
	"time"

	"localhost/client/go/configyaml"
	"localhost/client/go/outline/config"
	"localhost/client/go/outline/reporting"
	"github.com/stretchr/testify/require"
)

func Test_NewTransport_SS_URL(t *testing.T) {
	config := "transport: ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@example.com:4321/"
	firstHop := "example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_Legacy_JSON(t *testing.T) {
	config := `
transport: {
    "server": "example.com",
    "server_port": 4321,
    "method": "chacha20-ietf-poly1305",
    "password": "SECRET"
}`
	firstHop := "example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_Flexible_JSON(t *testing.T) {
	config := `
transport: {
    # Comment
    server: example.com,
    server_port: 4321,
    method: chacha20-ietf-poly1305,
    password: SECRET
}`
	firstHop := "example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_YAML(t *testing.T) {
	config := `
transport:
  # Comment
  server: example.com
  server_port: 4321
  method: chacha20-ietf-poly1305
  password: SECRET`
	firstHop := "example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_Explicit_endpoint(t *testing.T) {
	config := `
transport:
  endpoint:
    $type: dial
    address: example.com:4321
  cipher: chacha20-ietf-poly1305
  secret: SECRET`
	firstHop := "example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_Multihop_URL(t *testing.T) {
	config := `
transport:
  endpoint:
    $type: dial
    address: exit.example.com:4321
    dialer: ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpTRUNSRVQ@entry.example.com:4321/
  cipher: chacha20-ietf-poly1305
  secret: SECRET`
	firstHop := "entry.example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_Multihop_Explicit(t *testing.T) {
	config := `
transport:
  endpoint:
      $type: dial
      address: exit.example.com:4321
      dialer: 
        $type: shadowsocks
        endpoint: entry.example.com:4321
        cipher: chacha20-ietf-poly1305
        secret: ENTRY_SECRET
  cipher: chacha20-ietf-poly1305
  secret: EXIT_SECRET`
	firstHop := "entry.example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_Explicit_TCPUDP(t *testing.T) {
	config := `
transport:
  $type: tcpudp
  tcp:
      $type: shadowsocks
      endpoint: example.com:80
      cipher: chacha20-ietf-poly1305
      secret: SECRET
      prefix: "POST "
  udp:
      $type: shadowsocks
      endpoint: example.com:53
      cipher: chacha20-ietf-poly1305
      secret: SECRET`

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, "example.com:80", result.Client.sd.FirstHop)
	require.Equal(t, "example.com:53", result.Client.pp.FirstHop)
}

func Test_NewTransport_YAML_Reuse(t *testing.T) {
	config := `
transport:
  $type: tcpudp
  udp: &base
      $type: shadowsocks
      endpoint: example.com:4321
      cipher: chacha20-ietf-poly1305
      secret: SECRET
  tcp:
      <<: *base
      prefix: "POST "`
	firstHop := "example.com:4321"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_YAML_Partial_Reuse(t *testing.T) {
	config := `
transport:
  $type: tcpudp
  tcp:
      $type: shadowsocks
      endpoint: example.com:80
      <<: &cipher
        cipher: chacha20-ietf-poly1305
        secret: SECRET
      prefix: "POST "
  udp:
      $type: shadowsocks
      endpoint: example.com:53
      <<: *cipher`

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, "example.com:80", result.Client.sd.FirstHop)
	require.Equal(t, "example.com:53", result.Client.pp.FirstHop)
}

func Test_NewTransport_Unsupported(t *testing.T) {
	config := `transport: {$type: unsupported}`
	result := (&ClientConfig{}).New("", config)
	require.Error(t, result.Error, "Got %v", result.Error)
	require.Equal(t, "unsupported config", result.Error.Message)
}

func Test_NewTransport_Websocket(t *testing.T) {
	config := `
transport:
  $type: tcpudp
  tcp: &base
      $type: shadowsocks
      endpoint:
          $type: websocket
          url: https://entrypoint.cdn.example.com/tcp
      cipher: chacha20-ietf-poly1305
      secret: SECRET
  udp:
      <<: *base
      endpoint:
          $type: websocket
          url: https://entrypoint.cdn.example.com/udp`
	firstHop := "entrypoint.cdn.example.com:443"

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, firstHop, result.Client.sd.FirstHop)
	require.Equal(t, firstHop, result.Client.pp.FirstHop)
}

func Test_NewTransport_AllowProxyless(t *testing.T) {
	configText := `
transport:
  $type: tcpudp
  tcp:
  udp:`
	result := (&ClientConfig{}).New("", configText)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.NotNil(t, result.Client)
	require.Equal(t, config.ConnTypeDirect, result.Client.sd.ConnType)
	require.Equal(t, config.ConnTypeDirect, result.Client.pp.ConnType)
}

func Test_NewClientFromJSON_Errors(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{
			name:  "missing host",
			input: `transport: {"port":12345,"method":"some-cipher","password":"abcd1234"}`,
		},
		{
			name:  "missing port",
			input: `transport: {"host":"192.0.2.1","method":"some-cipher","password":"abcd1234"}`,
		},
		{
			name:  "missing method",
			input: `transport: {"host":"192.0.2.1","port":12345,"password":"abcd1234"}`,
		},
		{
			name:  "missing password",
			input: `transport: {"host":"192.0.2.1","port":12345,"method":"some-cipher"}`,
		},
		{
			name:  "empty host",
			input: `transport: {"host":"","port":12345,"method":"some-cipher","password":"abcd1234"}`,
		},
		{
			name:  "zero port",
			input: `transport: {"host":"192.0.2.1","port":0,"method":"some-cipher","password":"abcd1234"}`,
		},
		{
			name:  "empty method",
			input: `transport: {"host":"192.0.2.1","port":12345,"method":"","password":"abcd1234"}`,
		},
		{
			name:  "empty password",
			input: `transport: {"host":"192.0.2.1","port":12345,"method":"some-cipher","password":""}`,
		},
		{
			name:  "port -1",
			input: `transport: {"host":"192.0.2.1","port":-1,"method":"some-cipher","password":"abcd1234"}`,
		},
		{
			name:  "port 65536",
			input: `transport: {"host":"192.0.2.1","port":65536,"method":"some-cipher","password":"abcd1234"}`,
		},
		{
			name:  "prefix out-of-range",
			input: `transport: {"host":"192.0.2.1","port":8080,"method":"some-cipher","password":"abcd1234","prefix":"\x1234"}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := (&ClientConfig{}).New("", tt.input)
			if got.Error == nil || got.Client != nil {
				t.Errorf("NewClientFromJSON() expects an error, got = %v", got.Client)
				return
			}
		})
	}
}

func Test_UsageReporting(t *testing.T) {
	config := `
transport:
  $type: tcpudp
  tcp:
      $type: shadowsocks
      endpoint: example.com:80
      <<: &cipher
        cipher: chacha20-ietf-poly1305
        secret: SECRET
      prefix: "POST "
  udp:
      $type: shadowsocks
      endpoint: example.com:53
      <<: *cipher
reporter:
  $type: http
  request:
    url: https://your-callback-server.com/outline_callback
  interval: 24h`

	result := (&ClientConfig{}).New("", config)
	require.Nil(t, result.Error, "Got %v", result.Error)
	require.Equal(t, "example.com:80", result.Client.sd.FirstHop)
	require.Equal(t, "example.com:53", result.Client.pp.FirstHop)
	require.NotNil(t, result.Client.reporter, "Reporter is nil")
	request, err := result.Client.reporter.(*reporting.HTTPReporter).NewRequest()
	require.NoError(t, err)
	require.Equal(t, "https://your-callback-server.com/outline_callback", request.URL.String())
	require.Equal(t, 24*time.Hour, result.Client.reporter.(*reporting.HTTPReporter).Interval)
}

// TODO(fortuna): TEST enable_cookies

func Test_ParseReporter(t *testing.T) {
	config := `
$type: http
request:
  url: https://your-callback-server.com/outline_callback
  method: CUSTOM
  headers:
    Content-Type: [application/json]
    Authorization: [Bearer SECRET]
  body: '{"foo": "bar"}'
interval: 24h`
	yamlNode, err := configyaml.ParseConfigYAML(config)
	require.NoError(t, err)
	reporter, err := NewReporterParser("", nil).Parse(context.Background(), yamlNode)
	require.NoError(t, err)
	require.NotNil(t, reporter)
	request, err := reporter.(*reporting.HTTPReporter).NewRequest()
	require.NoError(t, err)
	require.Equal(t, "https://your-callback-server.com/outline_callback", request.URL.String())
	require.Equal(t, "CUSTOM", request.Method)
	require.Equal(t, 24*time.Hour, reporter.(*reporting.HTTPReporter).Interval)
	require.Equal(t, []string{"application/json"}, request.Header.Values("Content-Type"))
	require.Equal(t, []string{"Bearer SECRET"}, request.Header.Values("Authorization"))
	bodyText, err := io.ReadAll(request.Body)
	require.NoError(t, err)
	require.Equal(t, `{"foo": "bar"}`, string(bodyText))
	require.Nil(t, reporter.(*reporting.HTTPReporter).HttpClient.Jar)
}

func Test_ParseReporter_NoInterval(t *testing.T) {
	config := `
$type: http
request:
  url: https://your-callback-server.com/outline_callback`
	yamlNode, err := configyaml.ParseConfigYAML(config)
	require.NoError(t, err)
	reporter, err := NewReporterParser("", nil).Parse(context.Background(), yamlNode)
	require.NoError(t, err)
	require.NotNil(t, reporter)
	request, err := reporter.(*reporting.HTTPReporter).NewRequest()
	require.NoError(t, err)
	require.Equal(t, "https://your-callback-server.com/outline_callback", request.URL.String())
	require.Equal(t, time.Duration(0), reporter.(*reporting.HTTPReporter).Interval)
	require.Nil(t, reporter.(*reporting.HTTPReporter).HttpClient.Jar)
}

func Test_ParseReporter_CookieEnabled(t *testing.T) {
	config := `
$type: http
request:
  url: https://your-callback-server.com/outline_callback
enable_cookies: true
interval: 24h`
	yamlNode, err := configyaml.ParseConfigYAML(config)
	require.NoError(t, err)
	tempDir, err := os.MkdirTemp("", "")
	require.NoError(t, err)
	defer os.RemoveAll(tempDir)
	reporter, err := NewReporterParser(path.Join(tempDir, "cookies.txt"), nil).Parse(context.Background(), yamlNode)
	require.NoError(t, err)
	require.NotNil(t, reporter)
	request, err := reporter.(*reporting.HTTPReporter).NewRequest()
	require.NoError(t, err)
	require.Equal(t, "https://your-callback-server.com/outline_callback", request.URL.String())
	require.Equal(t, 24*time.Hour, reporter.(*reporting.HTTPReporter).Interval)
}

func Test_ParseReporter_CookieEnabled_FileMissing(t *testing.T) {
	config := `
$type: http
request:
  url: https://your-callback-server.com/outline_callback
enable_cookies: true
interval: 24h`
	yamlNode, err := configyaml.ParseConfigYAML(config)
	require.NoError(t, err)
	_, err = NewReporterParser("", nil).Parse(context.Background(), yamlNode)
	require.Error(t, err)
}
