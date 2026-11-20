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

package netconfig

import "context"

// A session is the time during which an application uses what it built from
// a config. Most built values hold nothing beyond the connections they
// return, and the callers close those. A value that holds a resource shared
// by its connections, such as a tunnel that multiplexes them, ties that
// resource to the session and releases it when the session ends:
//
//	func (c *TunnelConfig) NewStreamEndpoint(ctx context.Context) (transport.StreamEndpoint, error) {
//		tunnel := newLazyTunnel(c)
//		context.AfterFunc(netconfig.Session(ctx), tunnel.Close)
//		return tunnel, nil
//	}
//
// Such a value should start the resource on first use rather than when it is
// built, so that a value that is built and never used holds nothing.

type sessionKey struct{}

// WithSession returns a copy of ctx that carries session. An application
// builds configs with the returned context and cancels session when it stops
// using what it built.
func WithSession(ctx context.Context, session context.Context) context.Context {
	return context.WithValue(ctx, sessionKey{}, session)
}

// Session returns the session carried by a build context. Without one, it
// returns a context that is never done: what was built is kept until the
// process exits.
func Session(ctx context.Context) context.Context {
	if session, ok := ctx.Value(sessionKey{}).(context.Context); ok && session != nil {
		return session
	}
	return context.Background()
}
