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

package outline

import (
	"os"
	"os/signal"
	"syscall"
	"testing"
)

func TestSIGPIPEIgnored(t *testing.T) {
	if !signal.Ignored(syscall.SIGPIPE) {
		t.Fatal("SIGPIPE must be ignored on Apple platforms")
	}
}

func TestWriteToBrokenPipeReturnsError(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	r.Close()
	if _, err := w.Write([]byte("x")); err == nil {
		t.Fatal("expected EPIPE writing to a pipe with no reader")
	}
}
