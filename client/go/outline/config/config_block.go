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

package config

import (
	"context"
	"errors"

	"github.com/Jigsaw-Code/outline-sdk/transport"
)

func NewBlockStreamDialerSubParser() func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
	return func(ctx context.Context, input map[string]any) (*Dialer[transport.StreamConn], error) {
		return &Dialer[transport.StreamConn]{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeBlocked},
			Dial: func(ctx context.Context, address string) (transport.StreamConn, error) {
				return nil, errors.New("blocked by config")
			},
		}, nil
	}
}
