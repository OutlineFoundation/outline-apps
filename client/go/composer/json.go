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

package composer

import (
	"encoding/json"
	"fmt"
)

// MarshalJSON implements json.Marshaler. It expands aliases and conventional
// YAML merges using the same Node traversal as parsing. Scalars retain their
// JSON representation, including large numbers without float rounding; absent
// nodes become null. Reserved keys are preserved.
//
// Total expansion is limited to 100,000 values per call in addition to Node's
// depth and merge limits. Errors retain the offending node's source location.
func (n Node) MarshalJSON() ([]byte, error) {
	remaining := 100_000
	value, err := jsonValue(n, &remaining)
	if err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

// The shared budget bounds total alias expansion across the entire traversal.
func jsonValue(node Node, remaining *int) (any, error) {
	*remaining--
	if *remaining < 0 {
		return nil, node.WrapError(fmt.Errorf("config normalization exceeds 100000 values"))
	}
	switch node.Kind() {
	case KindAbsent:
		return nil, nil
	case KindMapping:
		var fields map[string]Node
		if err := node.Decode(&fields); err != nil {
			return nil, err
		}
		values := make(map[string]any, len(fields))
		for key, child := range fields {
			value, err := jsonValue(child, remaining)
			if err != nil {
				return nil, err
			}
			values[key] = value
		}
		return values, nil
	case KindSequence:
		var children []Node
		if err := node.Decode(&children); err != nil {
			return nil, err
		}
		values := make([]any, len(children))
		for i, child := range children {
			value, err := jsonValue(child, remaining)
			if err != nil {
				return nil, err
			}
			values[i] = value
		}
		return values, nil
	default:
		var text string
		if node.Decode(&text) == nil {
			return text, nil
		}
		var boolean bool
		if node.Decode(&boolean) == nil {
			return boolean, nil
		}
		var number json.Number
		if err := node.Decode(&number); err != nil {
			return nil, err
		}
		return number, nil
	}
}
