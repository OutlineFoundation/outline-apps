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

package dnsintercept

import (
	"errors"
	"net"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.getoutline.org/sdk/network"
)

type mockPacketProxy struct {
	network.PacketProxy
	newSessionCalled bool
	newSessionErr    error
	reqSender        network.PacketRequestSender
}

func (p *mockPacketProxy) NewSession(resp network.PacketResponseReceiver) (network.PacketRequestSender, error) {
	p.newSessionCalled = true
	if p.newSessionErr != nil {
		return nil, p.newSessionErr
	}
	if p.reqSender == nil {
		p.reqSender = &lastDestPacketRequestSender{}
	}
	return p.reqSender, nil
}

func TestLazyPacketProxy_CloseBeforeWrite(t *testing.T) {
	basePP := &mockPacketProxy{}
	proxy := &lazyPacketProxy{baseProxy: basePP}
	resp := &lastSourcePacketResponseReceiver{}

	sender, err := proxy.NewSession(resp)
	require.NoError(t, err)

	err = sender.Close()
	require.NoError(t, err)

	require.False(t, basePP.newSessionCalled)
}

func TestLazyPacketProxy_WriteToCreatesSession(t *testing.T) {
	basePP := &mockPacketProxy{}
	proxy := &lazyPacketProxy{baseProxy: basePP}
	resp := &lastSourcePacketResponseReceiver{}
	sender, err := proxy.NewSession(resp)
	require.NoError(t, err)
	require.False(t, basePP.newSessionCalled)

	dest := netip.MustParseAddrPort("1.1.1.1:53")
	n, err := sender.WriteTo([]byte("test"), dest)
	require.NoError(t, err)
	require.Equal(t, 4, n)

	require.True(t, basePP.newSessionCalled)
	require.Equal(t, dest, basePP.reqSender.(*lastDestPacketRequestSender).lastDst)
}

func TestLazyPacketProxy_WriteToUsesExistingSession(t *testing.T) {
	basePP := &mockPacketProxy{}
	proxy := &lazyPacketProxy{baseProxy: basePP}
	resp := &lastSourcePacketResponseReceiver{}
	sender, err := proxy.NewSession(resp)
	require.NoError(t, err)

	_, err = sender.WriteTo([]byte("test"), netip.MustParseAddrPort("1.1.1.1:53"))
	require.NoError(t, err)
	require.True(t, basePP.newSessionCalled)

	basePP.newSessionCalled = false // Reset for next check
	_, err = sender.WriteTo([]byte("test2"), netip.MustParseAddrPort("2.2.2.2:53"))
	require.NoError(t, err)
	require.False(t, basePP.newSessionCalled)
}

func TestLazyPacketProxy_WriteToFailsOnSessionError(t *testing.T) {
	expectedErr := errors.New("session failed")
	basePP := &mockPacketProxy{newSessionErr: expectedErr}
	proxy := &lazyPacketProxy{baseProxy: basePP}
	resp := &lastSourcePacketResponseReceiver{}
	sender, err := proxy.NewSession(resp)
	require.NoError(t, err)

	_, err = sender.WriteTo([]byte("test"), netip.MustParseAddrPort("1.1.1.1:53"))
	require.ErrorIs(t, err, expectedErr)
}

func TestLazyPacketProxy_WriteToAfterClose(t *testing.T) {
	proxy := &lazyPacketProxy{baseProxy: &mockPacketProxy{}}
	sender, err := proxy.NewSession(&lastSourcePacketResponseReceiver{})
	require.NoError(t, err)

	require.NoError(t, sender.Close())

	_, err = sender.WriteTo([]byte("test"), netip.MustParseAddrPort("1.1.1.1:53"))
	require.ErrorIs(t, err, net.ErrClosed)
}

func TestLazyPacketProxy_CloseAfterWriteTo(t *testing.T) {
	basePP := &mockPacketProxy{}
	proxy := &lazyPacketProxy{baseProxy: basePP}
	sender, err := proxy.NewSession(&lastSourcePacketResponseReceiver{})
	require.NoError(t, err)

	_, err = sender.WriteTo([]byte("test"), netip.MustParseAddrPort("1.1.1.1:53"))
	require.NoError(t, err)

	require.NoError(t, sender.Close())
	require.True(t, basePP.reqSender.(*lastDestPacketRequestSender).closed)
}

func TestLazyPacketProxy_CloseTwice(t *testing.T) {
	proxy := &lazyPacketProxy{baseProxy: &mockPacketProxy{}}
	sender, err := proxy.NewSession(&lastSourcePacketResponseReceiver{})
	require.NoError(t, err)

	require.NoError(t, sender.Close())
	err = sender.Close()
	require.ErrorIs(t, err, net.ErrClosed)
}
