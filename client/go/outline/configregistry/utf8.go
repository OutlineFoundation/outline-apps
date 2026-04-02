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

// This packages provides helper functions to encode or decode UTF-8 strings
package configregistry

import "fmt"

// DecodeUTF8CodepointsToRawBytes parses a UTF-8 string as a raw byte array.
// That is to say, each codepoint in the Unicode string will be treated as a
// single byte (must be in range 0x00 ~ 0xff).
//
// If a codepoint falls out of the range, an error will be returned.
func decodeUTF8CodepointsToRawBytes(utf8Str string) ([]byte, error) {
	runes := []rune(utf8Str)
	rawBytes := make([]byte, len(runes))
	for i, r := range runes {
		if (r & 0xFF) != r {
			return nil, fmt.Errorf("character out of range: %d", r)
		}
		rawBytes[i] = byte(r)
	}
	return rawBytes, nil
}
