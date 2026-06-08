// Copyright 2018 The Outline Authors
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

// Returns a URL's pathname stripped of its first directory name, which may be the empty string if
// there are fewer than two "directories" in the URL's pathname.
// Throws if s cannot be parsed as a URL.
//
// Used to strip PII from management API URLs, e.g.:
//   https://124.10.10.2/abcd123/access-keys -> access-keys
//   https://124.10.10.2/abcd123/access-keys/52 -> access-keys/52
//   https://124.10.10.2/abcd123 -> (empty string)
export function redactManagerUrl(s: string) {
  return new URL(s).pathname.split('/').slice(2).join('/');
}
