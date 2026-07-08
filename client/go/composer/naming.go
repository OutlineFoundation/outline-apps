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

package composer

import (
	"strings"
	"unicode"
)

// normalizeKey returns the form used to match config keys against Go
// field names: lowercase with underscores removed. "server_port",
// "ServerPort" and "serverport" all normalize identically.
func normalizeKey(key string) string {
	return strings.ToLower(strings.ReplaceAll(key, "_", ""))
}

// wireName converts a Go field name to its canonical snake_case wire
// name. Acronym runs count as one word, including plural acronyms:
// URL -> url, EnableHTTPProxy -> enable_http_proxy, IPs -> ips.
func wireName(goName string) string {
	var b strings.Builder
	runes := []rune(goName)
	for i, r := range runes {
		if unicode.IsUpper(r) && i > 0 {
			afterAcronym := unicode.IsUpper(runes[i-1]) &&
				i+1 < len(runes) && unicode.IsLower(runes[i+1])
			// "IPs": a lone trailing 's' pluralizes the acronym; it does
			// not start a new word.
			pluralAcronym := afterAcronym && i+2 == len(runes) && runes[i+1] == 's'
			if (!unicode.IsUpper(runes[i-1]) || afterAcronym) && !pluralAcronym {
				b.WriteByte('_')
			}
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}
