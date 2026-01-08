// Copyright 2024 The Outline Authors
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

package outline

import (
	"io"
	"net/http"
	"time"

	"localhost/client/go/outline/platerrors"
)

const fetchTimeout = 10 * time.Second

// fetchResource fetches a resource from the given URL.
//
// The function makes an HTTP GET request to the specified URL and returns the response body as a
// string. If the request fails or the server returns a non-2xx status code, an error is returned.
func fetchResource(url string) (string, error) {
	client := &http.Client{
		Timeout: fetchTimeout,
	}
	resp, err := client.Get(url)
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.FetchConfigFailed,
			Message: "failed to fetch the URL",
			Details: platerrors.ErrorDetails{"url": url},
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode > 299 {
		return "", platerrors.PlatformError{
			Code:    platerrors.FetchConfigFailed,
			Message: "non-successful HTTP status",
			Details: platerrors.ErrorDetails{
				"status": resp.Status,
				"body":   string(body),
			},
		}
	}
	if err != nil {
		return "", platerrors.PlatformError{
			Code:    platerrors.FetchConfigFailed,
			Message: "failed to read the body",
			Details: platerrors.ErrorDetails{"url": url},
			Cause:   platerrors.ToPlatformError(err),
		}
	}
	return string(body), nil
}
