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

package main

/*
#include <stdlib.h>  // for C.free

// InvokeMethodResult is a struct used to pass result from Go to TypeScript boundary.
typedef struct InvokeMethodResult_t
{
	// A string representing the result of the Go function call.
	// This may be a raw string or a JSON string depending on the API call.
	const char *Output;

	// A string containing a JSON representation of any error that occurred during the
	// Go function call, or NULL if no error occurred.
	// This error can be parsed by the PlatformError in TypeScript.
	const char *ErrorJson;
} InvokeMethodResult;

// CallbackFuncPtr is a C function pointer type that represents a callback function.
// This callback function will be invoked by the Go side.
//
// - data: The callback data, passed as a C string (typically a JSON string).
typedef const char* (*CallbackFuncPtr)(const char *data);

// InvokeCallback is a helper function that invokes the C callback function pointer.
//
// This function serves as a bridge, allowing Go to call a C function pointer.
//
// - f: The C function pointer to be invoked.
// - data: A C-string typed data to be passed to the callback.
static const char* InvokeCallback(CallbackFuncPtr f, const char *data) {
  return f(data);
}
*/
import "C"
import (
	"fmt"
	"log/slog"
	"os"
	"unsafe"

	"localhost/client/go/outline"
	"localhost/client/go/outline/callback"
	"localhost/client/go/outline/platerrors"
)

// InvokeMethod is the unified entry point for TypeScript to invoke various Go functions.
//
// The input and output are all defined as string, but they may represent either a raw string,
// or a JSON string depending on the API call.
//
// Check the API name constants comment for more details about the input and output format.
//
//export InvokeMethod
func InvokeMethod(method *C.char, input *C.char) C.InvokeMethodResult {
	result := outline.InvokeMethod(C.GoString(method), C.GoString(input))
	return C.InvokeMethodResult{
		Output:    newCGoString(result.Value),
		ErrorJson: marshalCGoErrorJson(result.Error),
	}
}

// cgoCallback implements the [callback.Handler] interface and bridges the Go callback
// to a C function pointer.
type cgoCallback struct {
	ptr C.CallbackFuncPtr
}

var _ callback.Handler = (*cgoCallback)(nil)

// OnCall forwards the data to the C callback function pointer.
func (ccb *cgoCallback) OnCall(data string) string {
	ret := C.InvokeCallback(ccb.ptr, newCGoString(data))
	return C.GoString(ret)
}

// RegisterCallback registers a new callback function with the [callback.DefaultManager]
// and returns a [callback.Token] number.
//
// The caller can delete the callback by calling [UnregisterCallback] with the returned token.
//
//export RegisterCallback
func RegisterCallback(cb C.CallbackFuncPtr) C.int {
	token := callback.DefaultManager().Register(&cgoCallback{cb})
	return C.int(token)
}

// UnregisterCallback unregisters the callback from the [callback.DefaultManager]
// identified by the token returned by [RegisterCallback].
//
//export UnregisterCallback
func UnregisterCallback(token C.int) {
	callback.DefaultManager().Unregister(callback.Token(token))
}

// newCGoString allocates memory for a C string based on the given Go string.
// It should be paired with [FreeCGoString] to avoid memory leaks.
func newCGoString(s string) *C.char {
	if s == "" {
		return nil
	}
	res := C.CString(s)
	slog.Debug("malloc CGoString", "addr", res)
	return res
}

// FreeCGoString releases the memory allocated by newCGoString.
// It also accepts null.
//
//export FreeCGoString
func FreeCGoString(s *C.char) {
	if s != nil {
		slog.Debug("free CGoString", "addr", s)
		C.free(unsafe.Pointer(s))
	}
}

// marshalCGoErrorJson marshals a PlatformError to a C style JSON string.
// It always succeeds with a non-empty string if e is not nil.
func marshalCGoErrorJson(e *platerrors.PlatformError) *C.char {
	if e == nil {
		return nil
	}
	json, err := platerrors.MarshalJSONString(e)
	if err != nil {
		return newCGoString(fmt.Sprintf("%s, failed to retrieve details due to: %s", e.Code, err.Error()))
	}
	return newCGoString(json)
}

// init initializes the backend module.
// It sets up a default logger based on the OUTLINE_DEBUG environment variable.
func init() {
	opts := slog.HandlerOptions{Level: slog.LevelInfo}

	dbg := os.Getenv("OUTLINE_DEBUG")
	if dbg != "" && dbg != "false" && dbg != "0" {
		opts.Level = slog.LevelDebug
	}

	logger := slog.New(slog.NewTextHandler(os.Stderr, &opts))
	slog.SetDefault(logger)
}
