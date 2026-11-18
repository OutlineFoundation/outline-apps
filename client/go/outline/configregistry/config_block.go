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

	"localhost/client/go/composer"
)

func NewBlockDialerSubParser[ConnType any]() composer.ParseFunc[*Dialer[ConnType]] {
	return func(ctx context.Context, input composer.Node) (*Dialer[ConnType], error) {
		return &Dialer[ConnType]{
			ConnectionProviderInfo: ConnectionProviderInfo{ConnType: ConnTypeBlocked},
			Dial: func(ctx context.Context, address string) (ConnType, error) {
				var zero ConnType
				return zero, errors.New("blocked by config")
			},
		}, nil
	}
}
