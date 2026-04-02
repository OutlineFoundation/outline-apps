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

package configregistry

import (
	"bytes"
	"testing"
)

func Test_decodeUTF8CodepointsToRawBytes(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    []byte
		wantErr bool
	}{
		{
			name:  "basic",
			input: "abc 123",
			want:  []byte{97, 98, 99, 32, 49, 50, 51},
		}, {
			name:  "empty",
			input: "",
			want:  []byte{},
		}, {
			name:  "edge cases (explicit)",
			input: "\x00\x01\x02 \x7e\x7f \xc2\x80\xc2\x81 \xc3\xbd\xc3\xbf",
			// 0xc2+0x80/0x81 will be decoded to 0x80/0x81 (two-byte sequence)
			// 0xc3+0xbd/0xbf will be decoded to 0xfd/0xff (two-byte sequence)
			want: []byte{0x00, 0x01, 0x02, 32, 0x7e, 0x7f, 32, 0x80, 0x81, 32, 0xfd, 0xff},
		}, {
			name:  "unicode escapes",
			input: "\u0000\u0080\u00ff",
			want:  []byte{0x00, 0x80, 0xff},
		}, {
			name:  "edge cases (roundtrip)",
			input: string([]rune{0, 1, 2, 126, 127, 128, 129, 254, 255}),
			want:  []byte{0, 1, 2, 126, 127, 128, 129, 254, 255},
		}, {
			name:    "out of range 256",
			input:   string([]rune{256}),
			wantErr: true,
		}, {
			name:    "out of range 257",
			input:   string([]rune{257}),
			wantErr: true,
		}, {
			name:    "out of range 65537",
			input:   string([]rune{65537}),
			wantErr: true,
		}, {
			name:    "invalid UTF-8",
			input:   "\xc3\x28",
			wantErr: true,
		}, {
			name:    "invalid Unicode",
			input:   "\xf8\xa1\xa1\xa1\xa1",
			wantErr: true,
		}, {
			name:  "multi-byte",
			input: "\xc2\x80\xc2\x81\xc3\xbd\xc3\xbf",
			want:  []byte{0x80, 0x81, 0xfd, 0xff},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeUTF8CodepointsToRawBytes(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("DecodeCodepointsToBytes() returns error %v, want error %v", err, tt.wantErr)
				return
			}
			if !bytes.Equal(got, tt.want) {
				t.Errorf("DecodeCodepointsToBytes() returns %v, want %v", got, tt.want)
			}
		})
	}
}
