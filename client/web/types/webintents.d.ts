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

interface WebIntent {
  getUri(callback: (url: string) => void): void;
  onNewIntent(callback: (url: string) => void): void;
}

interface Window {
  webintent: WebIntent;

  // cordova-ios calls a global function with this signature to handle URLs.
  handleOpenURL: (url: string) => void;
}
