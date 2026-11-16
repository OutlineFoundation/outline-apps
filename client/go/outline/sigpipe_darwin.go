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
	"os/signal"
	"syscall"
)

// On Apple platforms (darwin, which includes ios and maccatalyst) this package
// is linked into the app and the VPN extension via gomobile. gomobile's
// mobileinit routes the standard `log` package to os.Stderr (fd 2). If that
// descriptor is a pipe with no reader, the Go runtime treats EPIPE on
// stdout/stderr as fatal and re-raises SIGPIPE on the whole process, killing
// the host app (see Sentry issue OUTLINE-CLIENTS-NMDS9).
//
// Ignoring SIGPIPE makes such writes simply fail with EPIPE instead. Logging
// still goes to os_log and all other error reporting is unaffected.
func init() {
	signal.Ignore(syscall.SIGPIPE)
}
