/*
 * Copyright 2026 The Outline Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.outline.android.client;

import com.getcapacitor.BridgeActivity;

/**
 * The launcher activity. It deliberately lives in org.outline.android.client, the package of the
 * Cordova app's MainActivity, rather than in the Gradle namespace (org.outline.client): the
 * Capacitor app ships as an in-place upgrade of the Cordova app, and the launcher component name
 * must not change across that upgrade. See the comment in AndroidManifest.xml.
 */
public class MainActivity extends BridgeActivity {}
