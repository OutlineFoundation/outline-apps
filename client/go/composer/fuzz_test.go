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

package composer_test

import (
	"encoding/json"
	"testing"

	"localhost/client/go/composer"
)

func FuzzNode(f *testing.F) {
	for _, seed := range []string{
		`{"endpoint":{"address":"example.com:443"}}`,
		"base: &base [1, true, null]\ncopy: *base",
		"&cycle {child: *cycle}",
		"base: &base {port: 443}\nendpoint: {<<: *base}",
		"a: *missing",
		"18446744073709551615",
		"18446744073709551616",
		"1e6",
		"1000000.0",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, text string) {
		root, err := composer.ParseYAML([]byte(text))
		if err != nil {
			return
		}
		pending := []composer.Node{root}
		// Bound the caller's work too: repeated aliases can share subtrees.
		for visited := 0; len(pending) > 0 && visited < 256; visited++ {
			node := pending[len(pending)-1]
			pending = pending[:len(pending)-1]
			switch node.Kind() {
			case composer.KindMapping:
				var fields map[string]composer.Node
				if node.Decode(&fields) == nil {
					for _, child := range fields {
						pending = append(pending, child)
					}
				}
			case composer.KindSequence:
				var items []composer.Node
				if node.Decode(&items) == nil {
					pending = append(pending, items...)
				}
			default:
				var str string
				var integer int64
				var unsigned uint64
				var number float64
				var boolean bool
				precise := json.Number("unchanged")
				for _, target := range []any{&str, &integer, &unsigned, &number, &boolean} {
					_ = node.Decode(target)
				}
				if err := node.Decode(&precise); err != nil && precise != "unchanged" {
					t.Fatal("failed json.Number decode changed the destination")
				}
			}
		}
	})
}
