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

import {Writable} from 'stream';

type WriteCallback = (error?: Error | null) => void;

/** Whether the error means the reading end of the stream has gone away. */
export function isBrokenPipeError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === 'EPIPE'
  );
}

/**
 * Makes `stream` tolerate a closed reader (EPIPE).
 *
 * The main process's stdout/stderr may be attached to a terminal or pipe that is
 * closed while the app keeps running (e.g. the launching terminal exits). Node
 * writes to such streams synchronously, so `console.error()` would throw EPIPE at
 * the call site and crash the app with an uncaught exception.
 *
 * Once a broken pipe is detected, the stream is marked broken and further output
 * is discarded. Losing terminal output nobody can read is harmless; Sentry
 * breadcrumbs from the console are recorded before the stream is written to, so
 * they are unaffected. Any other write error is still thrown.
 */
export function installBrokenPipeGuard(stream: Writable): void {
  let broken = false;
  const originalWrite = stream.write.bind(stream) as (
    ...args: unknown[]
  ) => boolean;

  const discard = (args: unknown[]): boolean => {
    const callback = args.find(arg => typeof arg === 'function') as
      | WriteCallback
      | undefined;
    if (callback) {
      process.nextTick(callback);
    }
    // Return true so piped sources (e.g. subprocess output in debug mode) are
    // not paused waiting for a 'drain' event that will never come.
    return true;
  };

  stream.write = ((...args: unknown[]): boolean => {
    if (broken) {
      return discard(args);
    }
    try {
      return originalWrite(...args);
    } catch (error) {
      if (!isBrokenPipeError(error)) {
        throw error;
      }
      broken = true;
      return discard(args);
    }
  }) as typeof stream.write;

  stream.on('error', (error: Error) => {
    if (!isBrokenPipeError(error)) {
      throw error;
    }
    broken = true;
  });
}
