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

package connectivity

import (
	"context"
	"testing"

	"golang.getoutline.org/sdk/transport"
	"github.com/stretchr/testify/require"
)

// This test ensures that the URLs used for connectivity tests are still valid.
func TestCheckTCPConnectivityWithHTTP_ValidURLs(t *testing.T) {
	t.Parallel()
	dialer := &transport.TCPDialer{}
	for _, url := range testTCPURLs {
		t.Run(url, func(t *testing.T) {
			t.Parallel()
			require.NoError(t, testTCPWithOneURL(context.Background(), dialer, url))
		})
	}
}
