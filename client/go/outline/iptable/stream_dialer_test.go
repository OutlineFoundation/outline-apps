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

package iptable

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/Jigsaw-Code/outline-sdk/transport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mocks ---

type MockStreamConn struct {
	net.Conn
	closed bool
	local  net.Addr
	remote net.Addr
}

func (m *MockStreamConn) Close() error {
	m.closed = true
	return nil
}
func (m *MockStreamConn) CloseRead() error  { return nil }
func (m *MockStreamConn) CloseWrite() error { return nil }
func (m *MockStreamConn) LocalAddr() net.Addr {
	if m.local == nil {
		m.local = &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: 12345}
	}
	return m.local
}
func (m *MockStreamConn) RemoteAddr() net.Addr {
	if m.remote == nil {
		m.remote = &net.TCPAddr{IP: net.ParseIP("8.8.8.8"), Port: 53}
	}
	return m.remote
}

type MockStreamDialer struct {
	Name        string
	WasCalled   bool
	DialedAddr  string
	DialedCtx   context.Context
	ReturnConn  transport.StreamConn
	ReturnError error
	DialDelay   time.Duration
}

func NewMockStreamDialer(name string) *MockStreamDialer {
	return &MockStreamDialer{
		Name:       name,
		ReturnConn: &MockStreamConn{},
	}
}

func (m *MockStreamDialer) DialStream(ctx context.Context, addr string) (transport.StreamConn, error) {
	m.WasCalled = true
	m.DialedCtx = ctx
	m.DialedAddr = addr

	if m.DialDelay > 0 {
		select {
		case <-time.After(m.DialDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	if m.ReturnError != nil {
		return nil, m.ReturnError
	}
	// Check context after potential delay but before returning success
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return m.ReturnConn, nil
}

func (m *MockStreamDialer) Reset() {
	m.WasCalled = false
	m.DialedAddr = ""
	m.DialedCtx = nil
}

type MockPacketDialer struct {
	Name        string
	WasCalled   bool
	DialedAddr  string
	DialedCtx   context.Context
	ReturnConn  net.Conn
	ReturnError error
	DialDelay   time.Duration
}

func NewMockPacketDialer(name string) *MockPacketDialer {
	return &MockPacketDialer{
		Name:       name,
		ReturnConn: &MockStreamConn{},
	}
}

func (m *MockPacketDialer) DialPacket(ctx context.Context, addr string) (net.Conn, error) {
	m.WasCalled = true
	m.DialedCtx = ctx
	m.DialedAddr = addr

	if m.DialDelay > 0 {
		select {
		case <-time.After(m.DialDelay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	if m.ReturnError != nil {
		return nil, m.ReturnError
	}
	// Check context after potential delay but before returning success
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return m.ReturnConn, nil
}

func (m *MockPacketDialer) Reset() {
	m.WasCalled = false
	m.DialedAddr = ""
	m.DialedCtx = nil
}

// --- Stream Dialer Tests ---

func TestNewIPTableStreamDialer(t *testing.T) {
	table := NewIPTable[transport.StreamDialer]()

	t.Run("Valid Table", func(t *testing.T) {
		d, err := NewStreamDialer(table, nil)
		require.NoError(t, err)
		require.NotNil(t, d)
		assert.Equal(t, table, d.table)
	})

	t.Run("Valid Fallback", func(t *testing.T) {
		defaultDialer := NewMockStreamDialer("default")
		d, err := NewStreamDialer(nil, defaultDialer)
		require.NoError(t, err)
		require.NotNil(t, d)
		assert.Equal(t, defaultDialer, d.fallback)
	})

	t.Run("Nil Table", func(t *testing.T) {
		d, err := NewStreamDialer(nil, nil)
		require.NoError(t, err)
		require.NotNil(t, d)
		assert.NotNil(t, d.table)
	})
}

func TestIPTableStreamDialer_DialStream(t *testing.T) {
	defaultDialer := NewMockStreamDialer("default")
	routeV4Dialer := NewMockStreamDialer("routeV4")
	routeV6Dialer := NewMockStreamDialer("routeV6")

	table := NewIPTable[transport.StreamDialer]()
	table.AddPrefix(netip.MustParsePrefix("192.0.2.0/24"), routeV4Dialer)
	table.AddPrefix(netip.MustParsePrefix("2001:db8:cafe::/48"), routeV6Dialer)

	iptDialerWithFallback, err := NewStreamDialer(table, defaultDialer)
	require.NoError(t, err)
	require.NotNil(t, iptDialerWithFallback)

	iptDialerNoFallback, err := NewStreamDialer(table, nil)
	require.NoError(t, err)
	require.NotNil(t, iptDialerNoFallback)

	testCases := []struct {
		name         string
		dialerToUse  *StreamDialer
		address      string
		expectDialer *MockStreamDialer
		expectConn   bool
		expectErr    bool
		expectErrMsg string
		setupMocks   func()
	}{
		// --- Tests using iptDialerWithFallback ---
		{
			name:         "WithFallback_IPv4 in table",
			dialerToUse:  iptDialerWithFallback,
			address:      "192.0.2.100:443",
			expectDialer: routeV4Dialer,
			expectConn:   true,
		},
		{
			name:         "WithFallback_IPv4 not in table",
			dialerToUse:  iptDialerWithFallback,
			address:      "10.0.0.1:1234",
			expectDialer: defaultDialer,
			expectConn:   true,
		},
		{
			name:         "WithFallback_IPv6 in table",
			dialerToUse:  iptDialerWithFallback,
			address:      "2001:db8:cafe::100:443",
			expectDialer: routeV6Dialer,
			expectConn:   true,
		},
		{
			name:         "WithFallback_IPv6 not in table",
			dialerToUse:  iptDialerWithFallback,
			address:      "2001::",
			expectDialer: defaultDialer,
			expectConn:   true,
		},
		{
			name:         "WithFallback_Dialer returns error",
			dialerToUse:  iptDialerWithFallback,
			address:      "192.0.2.20:80",
			expectDialer: routeV4Dialer,
			expectErr:    true,
			setupMocks: func() {
				routeV4Dialer.ReturnError = errors.New("mock dial failed")
			},
		},
		// --- Tests using iptDialerNoFallback ---
		{
			name:         "NoFallback_IPv4 in table",
			dialerToUse:  iptDialerNoFallback,
			address:      "192.0.2.100:443",
			expectDialer: routeV4Dialer, // Specific route still found
			expectConn:   true,
		},
		{
			name:         "NoFallback_IPv4 not in table",
			dialerToUse:  iptDialerNoFallback,
			address:      "10.0.0.1:1234",
			expectDialer: nil, // No specific route, no fallback -> error
			expectErr:    true,
			expectErrMsg: "no dialer available for address 10.0.0.1:1234",
		},
		{
			name:         "NoFallback_IPv6 in table",
			dialerToUse:  iptDialerNoFallback,
			address:      "2001:db8:cafe::100:443",
			expectDialer: routeV6Dialer, // Specific route still found
			expectConn:   true,
		},
		{
			name:         "NoFallback_IPv6 not in table",
			dialerToUse:  iptDialerNoFallback,
			address:      "2001::",
			expectDialer: nil, // No specific route, no fallback -> error
			expectErr:    true,
			expectErrMsg: "no dialer available for address 2001::",
		},
		{
			name:         "NoFallback_Hostname",
			dialerToUse:  iptDialerNoFallback,
			address:      "example.com:443",
			expectDialer: nil, // No specific route, no fallback -> error
			expectErr:    true,
			expectErrMsg: "no dialer available for address example.com:443",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			defaultDialer.Reset()
			routeV4Dialer.Reset()
			routeV6Dialer.Reset()
			defaultDialer.ReturnError = nil
			routeV4Dialer.ReturnError = nil
			routeV6Dialer.ReturnError = nil

			if tc.setupMocks != nil {
				tc.setupMocks()
			}

			ctx := context.Background()
			conn, err := tc.dialerToUse.DialStream(ctx, tc.address)

			if tc.expectErr {
				require.Error(t, err)
				assert.Nil(t, conn)
				if tc.expectErrMsg != "" {
					assert.EqualError(t, err, tc.expectErrMsg)
				}
				if tc.expectDialer != nil && tc.expectDialer.ReturnError != nil {
					assert.ErrorIs(t, err, tc.expectDialer.ReturnError)
				}
			} else {
				require.NoError(t, err)
				if tc.expectConn {
					require.NotNil(t, conn)
					require.NotNil(t, tc.expectDialer)
					assert.Same(t, tc.expectDialer.ReturnConn, conn)
					conn.Close()
				} else {
					assert.Nil(t, conn)
				}
			}

			allMocks := []*MockStreamDialer{defaultDialer, routeV4Dialer, routeV6Dialer}
			foundExpected := false
			for _, mock := range allMocks {
				if mock == tc.expectDialer {
					foundExpected = true
					assert.True(t, mock.WasCalled, "Expected dialer %s to be called", mock.Name)
					if mock.WasCalled {
						assert.Equal(t, tc.address, mock.DialedAddr)
						assert.Equal(t, ctx, mock.DialedCtx)
					}
				} else {
					assert.False(t, mock.WasCalled, "Dialer %s should NOT have been called", mock.Name)
				}
			}
			if tc.expectDialer != nil && !foundExpected {
				t.Errorf("Test setup error: expectDialer %s is not in the list of mocks", tc.expectDialer.Name)
			}
			// Verify no mock was called if an error was expected before dialing occurred
			if tc.expectDialer == nil && tc.expectErr {
				for _, mock := range allMocks {
					assert.False(t, mock.WasCalled)
				}
			}
		})
	}
}
