// Copyright 2025 The Outline Authors
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

package reporting

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"localhost/client/go/outline/useragent"
)

// Reporter is used to register reports.
type Reporter interface {
	// Run blocks until the session context is done.
	Run(sessionCtx context.Context)
}

type HTTPReporter struct {
	NewRequest func() (*http.Request, error)
	Interval   time.Duration
	HttpClient *http.Client
}

func (r *HTTPReporter) Run(sessionCtx context.Context) {
	r.reportAndLogError(sessionCtx)
	if r.Interval == 0 {
		return
	}
	// Only run the loop if we specified an interval.
	ticker := time.NewTicker(r.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-sessionCtx.Done():
			return
		case <-ticker.C:
			r.reportAndLogError(sessionCtx)
		}
	}
}

func (r *HTTPReporter) reportAndLogError(ctx context.Context) {
	err := r.report(ctx)
	if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, ctx.Err()) {
		slog.Warn("Failed to report", "err", err)
	}
}

func (r *HTTPReporter) Report() error {
	return r.report(context.Background())
}

func (r *HTTPReporter) report(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	req, err := r.NewRequest()
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	// Preserve any request-specific deadline while also honoring session shutdown.
	requestCtx, cancel := context.WithCancel(req.Context())
	defer cancel()
	stopCancel := context.AfterFunc(ctx, cancel)
	defer stopCancel()
	// AfterFunc runs asynchronously, even when cancellation happened while the
	// request factory was running. Cancel synchronously before handing it to HTTP.
	if ctx.Err() != nil {
		cancel()
	}
	req = req.WithContext(requestCtx)
	req.Close = true
	req.Header.Add("User-Agent", useragent.GetOutlineUserAgent())

	slog.Debug("Sending report", "url", req.URL)
	resp, err := r.HttpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send report: %w", err)
	}
	resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("report failed with status code %d", resp.StatusCode)
	}
	return nil
}
