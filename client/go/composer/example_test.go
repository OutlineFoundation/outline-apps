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
	"fmt"

	"localhost/client/go/composer"
)

func ExampleNode_Decode() {
	parseEndpoint := func(node composer.Node) (string, error) {
		var fields map[string]composer.Node
		if err := node.Decode(&fields); err != nil {
			return "", err
		}
		var address string
		if err := fields["address"].Decode(&address); err != nil {
			return "", err
		}
		return address, nil
	}

	root, err := composer.ParseYAML([]byte("endpoint:\n  address: example.com:443\n"))
	if err != nil {
		panic(err)
	}
	var fields map[string]composer.Node
	if err := root.Decode(&fields); err != nil {
		panic(err)
	}
	address, err := parseEndpoint(fields["endpoint"])
	if err != nil {
		panic(err)
	}
	fmt.Println(address)
	fmt.Println(fields["endpoint"].Path())
	// Output:
	// example.com:443
	// endpoint
}
