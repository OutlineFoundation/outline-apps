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

package configregistry

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"localhost/client/go/composer"
	"golang.getoutline.org/sdk/transport"
	"github.com/stretchr/testify/require"
)

func TestParseIPTableStreamDialer(t *testing.T) {
	ctx := context.Background()

	// Define a set of mock dialers for our tests to use.
	parseSE := func(ctx context.Context, _ composer.Registry, config composer.Node) (*Dialer[transport.StreamConn], error) {
		if config.IsAbsent() {
			return &Dialer[transport.StreamConn]{Dial: (&errorStreamDialer{name: "direct"}).DialStream, ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeDirect}}, nil
		}

		var mock struct{ Name string }
		if err := config.Decode(&mock); err != nil {
			return nil, errors.New("mock dialer config must have a 'name'")
		}
		name := mock.Name

		var dialer transport.StreamDialer
		connType := ConnTypeTunneled
		switch name {
		case "dialerA":
			dialer = &errorStreamDialer{name: "dialerA"}
		case "dialerB":
			dialer = &errorStreamDialer{name: "dialerB"}
		case "default":
			dialer = &errorStreamDialer{name: "default"}
		case "direct":
			dialer = &errorStreamDialer{name: "direct"}
			connType = ConnTypeDirect
		case "block":
			dialer = &errorStreamDialer{name: "block"}
			connType = ConnTypeBlocked
		default:
			return nil, fmt.Errorf("no mock dialer found with name: %s", name)
		}
		return &Dialer[transport.StreamConn]{Dial: dialer.DialStream, ConnectionProviderInfo: ConnectionProviderInfo{ConnType: connType}}, nil
	}
	// The nested dialers are parsed with the registry given in the call.
	mockDialers := composer.NewRegistry()
	composer.Register(mockDialers, composer.DefaultName, parseSE)

	// Define test cases
	testCases := []struct {
		name             string
		configYAML       string
		expectErr        string
		checkDialer      func(*testing.T, *Dialer[transport.StreamConn])
		expectedConnType ConnType
	}{
		{
			name: "Happy Path - valid config",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24
    dialer: {name: dialerA}
  - ips:
      - 10.0.0.1
      - 10.0.0.5
    dialer: {name: dialerB}
  - ips:
      - 0.0.0.0/0
    dialer: {name: default}
`,
			checkDialer: func(t *testing.T, dialer *Dialer[transport.StreamConn]) {
				_, err := dialer.Dial(ctx, "192.168.1.100:1234")
				require.ErrorContains(t, err, "dialer 'dialerA' called for address '192.168.1.100:1234'")

				_, err = dialer.Dial(ctx, "10.0.0.1:5678")
				require.ErrorContains(t, err, "dialer 'dialerB' called for address '10.0.0.1:5678'")

				_, err = dialer.Dial(ctx, "10.0.0.5:53")
				require.ErrorContains(t, err, "dialer 'dialerB' called for address '10.0.0.5:53'")

				_, err = dialer.Dial(ctx, "8.8.8.8:53")
				require.ErrorContains(t, err, "dialer 'default' called for address '8.8.8.8:53'")
			},
			expectedConnType: ConnTypeTunneled,
		},
		{
			name: "Happy Path - no fallback dialer",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24
    dialer: {name: dialerA}
`,
			expectedConnType: ConnTypeTunneled,
		},
		{
			name: "Happy Path - direct sub-dialer",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24
    dialer: {name: direct}
  - ips:
      - 0.0.0.0/0
    dialer: {name: default}
`,
			expectedConnType: ConnTypePartial,
		},
		{
			name: "Happy Path - exhaustive IPv4",
			configYAML: `
table:
  - ips:
      - 0.0.0.0/1
    dialer: {name: dialerA}
  - ips:
      - 128.0.0.0/1
    dialer: {name: dialerB}
`,
			expectedConnType: ConnTypeTunneled,
		},
		{
			name: "Happy Path - exhaustive IPv6",
			configYAML: `
table:
  - ips: 
      - ::/1
    dialer: {name: dialerA}
  - ips: 
      - 8000::/1
    dialer: {name: dialerB}
`,
			expectedConnType: ConnTypeTunneled,
		},
		{
			name: "Happy Path - exhaustive IPv4 with direct",
			configYAML: `
table:
  - ips:
      - 0.0.0.0/1
    dialer: {name: direct}
  - ips:
      - 128.0.0.0/1
    dialer: {name: dialerB}
`,
			expectedConnType: ConnTypePartial,
		},
		{
			name: "Happy Path - with fallback",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24
    dialer: {name: dialerA}
fallback: {name: default}
`,
			checkDialer: func(t *testing.T, dialer *Dialer[transport.StreamConn]) {
				_, err := dialer.Dial(ctx, "192.168.1.100:1234")
				require.ErrorContains(t, err, "dialer 'dialerA' called for address '192.168.1.100:1234'")

				_, err = dialer.Dial(ctx, "8.8.8.8:53")
				require.ErrorContains(t, err, "dialer 'default' called for address '8.8.8.8:53'")
			},
			expectedConnType: ConnTypeTunneled,
		},
		{
			name: "Happy Path - with direct fallback",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24
    dialer: {name: dialerA}
fallback: {name: direct}
`,
			expectedConnType: ConnTypePartial,
		},
		{
			name: "Happy Path - all direct",
			configYAML: `
table:
  - ips: 
      - 192.168.1.0/24
    dialer: {name: direct}
fallback: {name: direct}
`,
			expectedConnType: ConnTypeDirect,
		},
		{
			name:       "Error - empty table",
			configYAML: `table: []`,
			expectErr:  "iptable config 'table' must not be empty for stream dialer",
		},
		{
			name: "Error - missing dialer",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24`,
			expectErr: "iptable entry 0 has no dialer specified",
		},
		{
			name: "Error - invalid IP",
			configYAML: `
table:
  - ips:
      - not-an-ip
    dialer: {name: dialerA}
fallback: null
`,
			expectErr: "is not a valid IP address or CIDR prefix",
		},
		{
			name: "Error - no fallback",
			configYAML: `
table:
  - ips: 
      - 192.168.1.0/24
    dialer: {name: direct}`,
			checkDialer: func(t *testing.T, dialer *Dialer[transport.StreamConn]) {
				_, err := dialer.Dial(ctx, "8.8.8.8:53")
				require.ErrorContains(t, err, "no dialer available for address 8.8.8.8:53")
			},
		},
		{
			name: "Happy Path - all blocked",
			configYAML: `
table:
  - ips:
      - 0.0.0.0/0
    dialer: {name: block}
`,
			expectedConnType: ConnTypeBlocked,
		},
		{
			name: "Happy Path - partial blocked",
			configYAML: `
table:
  - ips:
      - 192.168.1.0/24
    dialer: {name: block}
  - ips:
      - 0.0.0.0/0
    dialer: {name: default}
`,
			expectedConnType: ConnTypeTunneled,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			node, err := composer.ParseYAML([]byte(tc.configYAML))
			require.NoError(t, err)

			dialer, err := parseIPTableStreamDialer(ctx, mockDialers, node)

			if tc.expectErr != "" {
				require.Error(t, err)
				require.Contains(t, err.Error(), tc.expectErr)
			} else {
				require.NoError(t, err)
				require.NotNil(t, dialer)
				require.Equal(t, tc.expectedConnType, dialer.ConnType)
				if tc.checkDialer != nil {
					tc.checkDialer(t, dialer)
				}
			}
		})
	}

	t.Run("Error - sub-dialer parser fails", func(t *testing.T) {
		errorDialers := composer.NewRegistry()
		composer.Register(errorDialers, composer.DefaultName, func(context.Context, composer.Registry, composer.Node) (*Dialer[transport.StreamConn], error) {
			return nil, errors.New("sub-parser failed")
		})

		config, err := composer.ParseYAML([]byte(`table: [{ips: [192.168.1.0/24], dialer: {name: dialerA}}]`))
		require.NoError(t, err)

		_, err = parseIPTableStreamDialer(ctx, errorDialers, config)
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to parse nested stream dialer")
		require.Contains(t, err.Error(), "sub-parser failed")
	})

	t.Run("Error - fallback parser fails", func(t *testing.T) {
		fallbackErrorDialers := composer.NewRegistry()
		composer.Register(fallbackErrorDialers, composer.DefaultName, func(ctx context.Context, r composer.Registry, config composer.Node) (*Dialer[transport.StreamConn], error) {
			var mock struct{ Name string }
			// Fail only for dialerB in this mock
			if err := config.Decode(&mock); err == nil && mock.Name == "dialerB" {
				return nil, errors.New("fallback sub-parser failed")
			}

			return parseSE(ctx, r, config)
		})

		config, err := composer.ParseYAML([]byte(`{table: [{ips: [192.168.1.0/24], dialer: {name: dialerA}}], fallback: {name: dialerB}}`))
		require.NoError(t, err)

		_, err = parseIPTableStreamDialer(ctx, fallbackErrorDialers, config)
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to parse nested stream dialer fallback")
		require.Contains(t, err.Error(), "fallback sub-parser failed")
	})
}
