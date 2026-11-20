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

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSessionEndsWhenCanceled(t *testing.T) {
	session, end := context.WithCancel(context.Background())
	buildCtx := WithSession(context.Background(), session)

	released := make(chan struct{})
	context.AfterFunc(Session(buildCtx), func() { close(released) })

	select {
	case <-released:
		t.Fatal("released before the session ended")
	case <-time.After(10 * time.Millisecond):
	}
	end()
	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("not released after the session ended")
	}
}

func TestSessionIsIndependentOfTheBuildContext(t *testing.T) {
	session, end := context.WithCancel(context.Background())
	defer end()
	buildCtx, cancelBuild := context.WithCancel(WithSession(context.Background(), session))
	cancelBuild()
	require.NoError(t, Session(buildCtx).Err(), "ending the build must not end the session")
}

func TestNoSessionNeverEnds(t *testing.T) {
	require.Nil(t, Session(context.Background()).Done())
}
