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

import 'core-js/stable';
import 'regenerator-runtime/runtime';
import 'web-animations-js/web-animations-next-lite.min.js';
import '@webcomponents/webcomponentsjs/webcomponents-bundle.js';
import {setRootPath} from '@polymer/polymer/lib/utils/settings.js';

setRootPath(
  location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1)
);
