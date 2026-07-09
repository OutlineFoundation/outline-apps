// Copyright 2024 The Outline Authors
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
	"encoding/json"
)

// ConnType is the type of the connections returned by Dialers and Endpoints.
// Useful for knowing if it's tunneled or direct.
type ConnType int

const (
	// Proxyless
	ConnTypeDirect ConnType = iota
	// Proxy
	ConnTypeTunneled
	// Mixed
	ConnTypePartial
	ConnTypeBlocked
)

// This is the format used for sending ConnType between go and typescript
// Keep this in sync with
// client/web/app/outline_server_repository/config.ts#ConnectionType
func (c ConnType) MarshalJSON() ([]byte, error) {
	var s string
	switch c {
	case ConnTypeDirect:
		s = "direct"
	case ConnTypeTunneled:
		s = "tunneled"
	case ConnTypePartial:
		s = "partial"
	case ConnTypeBlocked:
		s = "blocked"
	default:
		return nil, &json.UnsupportedValueError{
			Str: "invalid ConnType",
		}
	}
	return json.Marshal(s)
}

// ConnProviderConfig represents a dialer or endpoint that can create connections.
type ConnectionProviderInfo struct {
	// The type of the connections that are provided
	ConnType ConnType
	// The address of the first hop.
	FirstHop string
}
