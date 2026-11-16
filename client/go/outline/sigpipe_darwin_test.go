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
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"testing"
)

const brokenStderrChildEnv = "OUTLINE_TEST_BROKEN_STDERR_CHILD"

func TestSIGPIPEIgnored(t *testing.T) {
	if !signal.Ignored(syscall.SIGPIPE) {
		t.Fatal("SIGPIPE must be ignored on Apple platforms")
	}
}

// Child process body: point fd 2 at a pipe with no reader, then write to
// os.Stderr. Without SIGPIPE ignored, the Go runtime kills the process with
// SIGPIPE on EPIPE to stdout/stderr. Exit codes report the outcome.
func runBrokenStderrChild() {
	r, w, err := os.Pipe()
	if err != nil {
		os.Exit(10)
	}
	if err := syscall.Dup2(int(w.Fd()), 2); err != nil {
		os.Exit(11)
	}
	w.Close()
	r.Close()
	_, err = os.Stderr.Write([]byte("write to broken stderr\n"))
	if !errors.Is(err, syscall.EPIPE) {
		os.Exit(12)
	}
	os.Exit(0)
}

func TestWriteToBrokenStderrDoesNotKillProcess(t *testing.T) {
	if os.Getenv(brokenStderrChildEnv) == "1" {
		runBrokenStderrChild()
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestWriteToBrokenStderrDoesNotKillProcess$")
	cmd.Env = append(os.Environ(), brokenStderrChildEnv+"=1")
	err := cmd.Run()
	if err == nil {
		return
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("failed to run child process: %v", err)
	}
	if ws, ok := exitErr.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		t.Fatalf("child process was killed by signal %v writing to broken stderr", ws.Signal())
	}
	switch exitErr.ExitCode() {
	case 12:
		t.Fatal("write to broken stderr did not return EPIPE")
	default:
		t.Fatalf("child process failed: %v", err)
	}
}
