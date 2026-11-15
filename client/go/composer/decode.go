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
	"encoding/json"
	"math"
	"reflect"
	"strconv"
	"strings"

	"github.com/goccy/go-yaml/ast"
	"github.com/goccy/go-yaml/token"
)

// Decode reads a value into a non-nil pointer. Supported targets are string,
// bool, signed and unsigned integers (except uintptr), float32, float64, json.Number, Node,
// map[string]Node, and []Node. Named scalar types are supported too.
//
// Maps and slices decode one level, retaining children as Nodes for delegation.
// Keys are literal strings, including "$type" and "field?"; no schema or
// dispatch rules apply. Duplicate or non-string keys are rejected. YAML merge
// keys follow the YAML merge extension: explicit fields override merged fields,
// and earlier mappings in a merge sequence override later ones. Quoted "<<" keys
// stay literal. Structs and other collection targets are not supported.
//
// Scalars are not coerced between strings, booleans, and numbers. Integers may
// decode into floats with ordinary Go rounding; numeric overflow is an error.
// json.Number retains exact text for JSON numbers outside the integer range and
// scientific notation. Parsed integer and float values use their JSON spelling;
// floats have the precision of the YAML parser's float64 representation.
// Absent/null nodes can decode into Node but not into scalar or collection
// targets. On failure, out is unchanged.
func (n Node) Decode(out any) error {
	value := reflect.ValueOf(out)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return n.errorf("Decode requires a non-nil pointer, got %T", out)
	}
	switch dst := out.(type) {
	case *json.Number:
		number, err := n.jsonNumber()
		if err != nil {
			return err
		}
		*dst = number
		return nil
	case *Node:
		*dst = n
		return nil
	case *map[string]Node:
		result, err := n.mapping()
		if err != nil {
			return err
		}
		*dst = result
		return nil
	case *[]Node:
		result, err := n.sequence()
		if err != nil {
			return err
		}
		*dst = result
		return nil
	}
	return n.decodeScalar(value.Elem())
}

func (n Node) decodeScalar(dst reflect.Value) error {
	switch dst.Kind() {
	case reflect.String:
		switch value := n.ast.(type) {
		case *ast.StringNode:
			if _, numeric := n.plainJSONNumber(); numeric {
				return n.errorf("expected a string")
			}
			dst.SetString(value.Value)
		case *ast.LiteralNode:
			dst.SetString(value.Value.Value)
		default:
			return n.errorf("expected a string")
		}
	case reflect.Bool:
		value, ok := n.ast.(*ast.BoolNode)
		if !ok {
			return n.errorf("expected a boolean")
		}
		dst.SetBool(value.Value)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		value, err := n.integer()
		if err != nil {
			return err
		}
		var signed int64
		switch v := value.(type) {
		case int64:
			signed = v
		case uint64:
			if v > math.MaxInt64 {
				return n.errorf("integer out of range for %v", dst.Type())
			}
			signed = int64(v)
		}
		if dst.OverflowInt(signed) {
			return n.errorf("integer out of range for %v", dst.Type())
		}
		dst.SetInt(signed)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		value, err := n.integer()
		if err != nil {
			return err
		}
		var unsigned uint64
		switch v := value.(type) {
		case int64:
			if v < 0 {
				return n.errorf("negative integer cannot decode into %v", dst.Type())
			}
			unsigned = uint64(v)
		case uint64:
			unsigned = v
		}
		if dst.OverflowUint(unsigned) {
			return n.errorf("integer out of range for %v", dst.Type())
		}
		dst.SetUint(unsigned)
	case reflect.Float32, reflect.Float64:
		var number float64
		switch value := n.ast.(type) {
		case *ast.FloatNode:
			number = value.Value
		case *ast.IntegerNode:
			integer, err := n.integer()
			if err != nil {
				return err
			}
			switch v := integer.(type) {
			case int64:
				number = float64(v)
			case uint64:
				number = float64(v)
			}
		case *ast.StringNode:
			text, numeric := n.plainJSONNumber()
			if !numeric {
				return n.errorf("expected a number")
			}
			var err error
			number, err = strconv.ParseFloat(text, 64)
			if err != nil {
				return n.errorf("number out of range for %v", dst.Type())
			}
		default:
			return n.errorf("expected a number")
		}
		if math.IsInf(number, 0) || math.IsNaN(number) || dst.OverflowFloat(number) {
			return n.errorf("number out of range for %v", dst.Type())
		}
		dst.SetFloat(number)
	default:
		return n.errorf("unsupported Decode target %v", dst.Type())
	}
	return nil
}

func (n Node) integer() (any, error) {
	value, ok := n.ast.(*ast.IntegerNode)
	if !ok {
		if text, numeric := n.plainJSONNumber(); numeric && !strings.ContainsAny(text, ".eE") {
			if strings.HasPrefix(text, "-") {
				value, err := strconv.ParseInt(text, 10, 64)
				if err != nil {
					return nil, n.errorf("integer out of range")
				}
				return value, nil
			}
			value, err := strconv.ParseUint(text, 10, 64)
			if err != nil {
				return nil, n.errorf("integer out of range")
			}
			return value, nil
		}
		return nil, n.errorf("expected an integer")
	}
	switch value.Value.(type) {
	case int64, uint64:
		return value.Value, nil
	default:
		return nil, n.errorf("unsupported integer representation")
	}
}

// goccy v1.18 represents some valid JSON numbers as StringNodes, including
// exponents without a decimal point and integers outside its uint64/int64
// range. Recognize their syntax without converting quoted strings or losing
// precision before the destination type is known.
func (n Node) plainJSONNumber() (string, bool) {
	value, ok := n.ast.(*ast.StringNode)
	if !ok || value.Token.Type != token.StringType || value.Value == "" {
		return "", false
	}
	first := value.Value[0]
	if first != '-' && (first < '0' || first > '9') {
		return "", false
	}
	return value.Value, json.Valid([]byte(value.Value))
}

// jsonNumber avoids converting integer text through float64. The YAML parser
// represents ordinary integers and floats as Go numbers, so those values use
// JSON's canonical spelling; its numeric StringNodes retain their exact text.
func (n Node) jsonNumber() (json.Number, error) {
	if text, numeric := n.plainJSONNumber(); numeric {
		return json.Number(text), nil
	}
	var value any
	switch number := n.ast.(type) {
	case *ast.IntegerNode:
		var err error
		value, err = n.integer()
		if err != nil {
			return "", err
		}
	case *ast.FloatNode:
		value = number.Value
	default:
		return "", n.errorf("expected a number")
	}
	text, err := json.Marshal(value)
	if err != nil {
		return "", n.errorf("invalid JSON number: %v", err)
	}
	return json.Number(text), nil
}
