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

// Package netconfig holds Composer config types for network strategies:
// dialers, endpoints, and listeners.
//
// A config is the parsed form of a strategy. It is plain data that a program
// can inspect, and it builds the runtime object when asked:
//
//	parse:  config node -> StreamDialerConfig
//	build:  StreamDialerConfig.NewStreamDialer(ctx) -> transport.StreamDialer
//
// Parsing validates and composes configs and does nothing else: it opens no
// connection, resolves no name, and reads no file. Building creates the
// runtime objects, by building each nested config in turn.
//
// The interfaces in this package, such as [StreamDialerConfig], are the
// categories that parsers are registered under in a [composer.Registry]. Each
// strategy exports a concrete config type and a [composer.Parser] for it. A
// parser gets the configs nested in its own from the registry it is given,
// with [composer.Parse].
//
// The package chooses no $type names and registers nothing. An application
// registers the parsers it wants under the names it wants, with
// [composer.As] to register a concrete config under its category:
//
//	composer.Register(r, "dial", composer.As[netconfig.StreamEndpointConfig](netconfig.ParseStreamDialEndpoint))
//
// The package must not import Outline application packages, so that it can
// move to the Outline SDK.
package netconfig
