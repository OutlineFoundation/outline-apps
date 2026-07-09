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
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	persistentcookiejar "go.nhat.io/cookiejar"
	"golang.getoutline.org/sdk/transport"
	"localhost/client/go/composer"
)

type HTTPRequestConfig struct {
	URL     string
	Method  composer.Optional[string]
	Headers composer.Optional[map[string][]string]
	Body    composer.Optional[string]
}

// HTTPReporterConfig is the format for the HTTPReporter config.
type HTTPReporterConfig struct {
	Request       HTTPRequestConfig
	Interval      composer.Optional[string]
	EnableCookies composer.Optional[bool]
}

func NewHTTPReporterConfigParser(cookiesFilename string, streamDialer transport.StreamDialer) composer.ParseFunc[Reporter] {
	return func(ctx context.Context, node composer.Node) (Reporter, error) {
		var config HTTPReporterConfig
		if err := node.Decode(&config); err != nil {
			return nil, fmt.Errorf("invalid config format: %w", err)
		}

		_, err := url.Parse(config.Request.URL)
		if err != nil {
			return nil, fmt.Errorf("failed to parse the report collector URL: %w", err)
		}

		// Create HTTP Client.

		httpClient := &http.Client{
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
					if strings.HasPrefix(network, "tcp") {
						return streamDialer.DialStream(ctx, addr)
					} else {
						return nil, fmt.Errorf("protocol not supported: %v", network)
					}
				},
			},
		}

		if config.EnableCookies.Or(false) {
			if cookiesFilename == "" {
				return nil, fmt.Errorf("cookies filename is required for cookies: %w", errors.ErrUnsupported)
			}
			// Make sure the cookies directory exists.
			if err := os.MkdirAll(path.Dir(cookiesFilename), 0700); err != nil {
				return nil, fmt.Errorf("failed to create service data directory: %v", err)
			}
			cookieJar := persistentcookiejar.NewPersistentJar(
				persistentcookiejar.WithFilePath(cookiesFilename),
				persistentcookiejar.WithAutoSync(true))
			httpClient.Jar = cookieJar
		}

		// Create request factory.

		newRequest := func() (*http.Request, error) {
			method := config.Request.Method.Or("POST")
			var body io.Reader
			if b, ok := config.Request.Body.Get(); ok {
				body = strings.NewReader(b)
			}
			req, err := http.NewRequest(method, config.Request.URL, body)
			if err != nil {
				return nil, err
			}
			for k, v := range config.Request.Headers.Or(nil) {
				req.Header[k] = v
			}
			return req, nil
		}

		reporter := &HTTPReporter{NewRequest: newRequest, HttpClient: httpClient}

		if interval, ok := config.Interval.Get(); ok {
			d, err := time.ParseDuration(interval)
			if err != nil {
				return nil, fmt.Errorf("failed to parse interval: %w", err)
			}
			if d < 1*time.Hour {
				return nil, fmt.Errorf("interval must be at least 1h")
			}
			reporter.Interval = d
		}

		return reporter, nil
	}
}
