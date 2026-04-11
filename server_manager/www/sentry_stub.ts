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

// Stub for @sentry/electron/renderer in browser context.
// The Outline Manager app imports @sentry/electron which is not available
// when running as a web app. This stub provides no-op implementations.

export function init(_options?: unknown): void {}

export function captureEvent(_event?: unknown): void {}

export function captureException(_error?: unknown): void {}

export function captureMessage(_message?: string): void {}
