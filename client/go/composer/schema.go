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
	"math"
	"reflect"
	"strconv"
	"strings"
)

// Decoder reads configuration schemas from Nodes. Its zero value uses the
// strict scalar conversions of Node.Decode.
type Decoder struct {
	// CoerceScalars enables the existing YAML config conversions: numbers and
	// booleans to strings, numeric strings to numbers, and floats to integers
	// truncated toward zero. Bounds are still checked.
	CoerceScalars bool

	// AllowUnknownFields ignores struct fields absent from the destination schema.
	AllowUnknownFields bool
}

// Decode reads a schema directly from a Node, retaining Node fields for
// delegated parsing. It supports structs, pointers, string-keyed maps, slices,
// and scalars. Struct keys use yaml tags or lowercase Go field names. Unknown
// fields are rejected unless AllowUnknownFields is set. Reserved $ keys are
// skipped only at the root.
//
// Missing and null values leave defaults unchanged, except that null pointers
// become nil. This decoder does not impose required/optional field rules.
// Scalar coercion is opt-in via CoerceScalars. On error, the destination may be
// partially updated.
func (d Decoder) Decode(node Node, out any) error {
	dst := reflect.ValueOf(out)
	if dst.Kind() != reflect.Pointer || dst.IsNil() {
		return node.WrapError(fmt.Errorf("Decode requires a non-nil pointer, got %T", out))
	}
	remaining := 100_000
	return d.decodeValue(node, dst.Elem(), true, &remaining)
}

var nodeType = reflect.TypeFor[Node]()

func (d Decoder) decodeValue(node Node, dst reflect.Value, root bool, remaining *int) error {
	*remaining--
	if *remaining < 0 {
		return node.WrapError(fmt.Errorf("config decoding exceeds 100000 values"))
	}
	if dst.Type() == nodeType {
		dst.Set(reflect.ValueOf(node))
		return nil
	}
	if node.IsAbsent() {
		if dst.Kind() == reflect.Pointer {
			dst.SetZero()
		}
		return nil
	}
	if dst.Kind() == reflect.Pointer {
		if dst.IsNil() {
			dst.Set(reflect.New(dst.Type().Elem()))
		}
		return d.decodeValue(node, dst.Elem(), root, remaining)
	}
	switch dst.Kind() {
	case reflect.Struct:
		var fields map[string]Node
		if err := node.Decode(&fields); err != nil {
			return err
		}
		indexes := make(map[string][]int)
		if err := structFields(dst.Type(), nil, indexes); err != nil {
			return node.WrapError(err)
		}
		for key, child := range fields {
			if root && strings.HasPrefix(key, "$") {
				continue
			}
			index, exists := indexes[key]
			if !exists {
				if d.AllowUnknownFields {
					continue
				}
				return child.WrapError(fmt.Errorf("unknown field %q", key))
			}
			if err := d.decodeValue(child, dst.FieldByIndex(index), false, remaining); err != nil {
				return err
			}
		}
		return nil
	case reflect.Slice:
		var children []Node
		if err := node.Decode(&children); err != nil {
			return err
		}
		result := reflect.MakeSlice(dst.Type(), len(children), len(children))
		for i, child := range children {
			if err := d.decodeValue(child, result.Index(i), false, remaining); err != nil {
				return err
			}
		}
		dst.Set(result)
		return nil
	case reflect.Map:
		if dst.Type().Key().Kind() != reflect.String {
			return node.WrapError(fmt.Errorf("unsupported map key type %v", dst.Type().Key()))
		}
		var children map[string]Node
		if err := node.Decode(&children); err != nil {
			return err
		}
		result := reflect.MakeMapWithSize(dst.Type(), len(children))
		for key, child := range children {
			if root && strings.HasPrefix(key, "$") {
				continue
			}
			value := reflect.New(dst.Type().Elem()).Elem()
			if err := d.decodeValue(child, value, false, remaining); err != nil {
				return err
			}
			result.SetMapIndex(reflect.ValueOf(key).Convert(dst.Type().Key()), value)
		}
		dst.Set(result)
		return nil
	case reflect.String:
		if !d.CoerceScalars {
			return node.Decode(dst.Addr().Interface())
		}
		value, err := scalarString(node)
		if err != nil {
			return err
		}
		dst.SetString(value)
		return nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		if d.CoerceScalars {
			return decodeNumber(node, dst)
		}
		return node.Decode(dst.Addr().Interface())
	default:
		return node.Decode(dst.Addr().Interface())
	}
}

func structFields(t reflect.Type, prefix []int, indexes map[string][]int) error {
	for i := range t.NumField() {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		tag := strings.Split(field.Tag.Get("yaml"), ",")
		if tag[0] == "-" {
			continue
		}
		index := append(append([]int(nil), prefix...), i)
		inline := false
		for _, option := range tag[1:] {
			inline = inline || option == "inline"
		}
		if inline {
			if field.Type.Kind() != reflect.Struct {
				return fmt.Errorf("inline field %s must be a struct", field.Name)
			}
			if err := structFields(field.Type, index, indexes); err != nil {
				return err
			}
			continue
		}
		name := tag[0]
		if name == "" {
			name = strings.ToLower(field.Name)
		}
		if _, found := indexes[name]; found {
			return fmt.Errorf("duplicate schema field %q", name)
		}
		indexes[name] = index
	}
	return nil
}

// Scalar coercion preserves the existing config string representation without
// changing the strict Node.Decode rules.
func scalarString(node Node) (string, error) {
	var text string
	stringErr := node.Decode(&text)
	if stringErr == nil {
		return text, nil
	}
	var number json.Number
	if node.Decode(&number) == nil {
		// Preserve the former JSON/YAML round trip: integer and scientific
		// string tokens keep their exact text; decimal float tokens use Go's
		// float formatting. In particular, never round a large integer through
		// float64 when it is used as a secret, header, or other string field.
		text := number.String()
		if text == "-0" {
			return "0", nil
		}
		if !strings.Contains(text, ".") {
			return text, nil
		}
		value, err := number.Float64()
		if err != nil {
			return "", node.WrapError(err)
		}
		return strconv.FormatFloat(value, 'g', -1, 64), nil
	}
	var boolean bool
	if node.Decode(&boolean) == nil {
		return strconv.FormatBool(boolean), nil
	}
	return "", stringErr
}

// Preserve the numeric coercions used by the existing YAML config schemas.
// Node.Decode remains strict; direct integer decoding is tried first to avoid
// losing precision for integer tokens before considering legacy conversions.
func decodeNumber(node Node, dst reflect.Value) error {
	strictErr := node.Decode(dst.Addr().Interface())
	if strictErr == nil {
		return nil
	}
	var number float64
	var text string
	quoted := node.Decode(&text) == nil
	if quoted {
		var err error
		number, err = strconv.ParseFloat(text, 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			return strictErr
		}
	} else if node.Decode(&number) != nil {
		return strictErr
	}
	switch dst.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		if quoted && number < 0 || number < math.MinInt64 || number >= math.MaxInt64 || dst.OverflowInt(int64(number)) {
			return node.WrapError(fmt.Errorf("number out of range for %v", dst.Type()))
		}
		dst.SetInt(int64(number))
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if number < 0 || number >= math.MaxUint64 || dst.OverflowUint(uint64(number)) {
			return node.WrapError(fmt.Errorf("number out of range for %v", dst.Type()))
		}
		dst.SetUint(uint64(number))
	case reflect.Float32, reflect.Float64:
		if dst.OverflowFloat(number) {
			return node.WrapError(fmt.Errorf("number out of range for %v", dst.Type()))
		}
		dst.SetFloat(number)
	}
	return nil
}
