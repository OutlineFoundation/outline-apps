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

// Config is a parsed reporter. Parsing validates it; building creates the
// reporter, its HTTP client, and its cookie jar.
type Config interface {
	// NewReporter builds the reporter. It sends its reports through
	// streamDialer.
	NewReporter(ctx context.Context, streamDialer transport.StreamDialer) (Reporter, error)
}

// HTTPConfig is a parsed HTTP reporter.
type HTTPConfig struct {
	// URL is where reports are sent.
	URL string
	// Method is the HTTP method of the report request. Empty means POST.
	Method string
	// Headers are added to the report request as given.
	Headers map[string][]string
	// Body is the body of the report request. Empty means no body.
	Body string
	// Interval is the time between reports. Zero means one report per
	// session.
	Interval time.Duration
	// EnableCookies keeps the cookies the collector sets, in a file.
	EnableCookies bool

	cookiesFilename string
}

// NewHTTPConfigParser returns a parser for HTTP reporters that keep their
// cookies in cookiesFilename. An empty cookiesFilename makes configs that
// enable cookies unsupported.
func NewHTTPConfigParser(cookiesFilename string) composer.Parser[*HTTPConfig] {
	return func(_ context.Context, _ composer.Registry, node composer.Node) (*HTTPConfig, error) {
		var fields struct {
			Request composer.Optional[struct {
				URL     composer.Optional[string]
				Method  composer.Optional[string]
				Headers composer.Optional[map[string][]string]
				Body    composer.Optional[string]
			}]
			Interval      composer.Optional[string]
			EnableCookies composer.Optional[bool]
		}
		if err := node.Decode(&fields); err != nil {
			return nil, fmt.Errorf("invalid config format: %w", err)
		}
		// An absent request leaves every request field empty, as in the
		// legacy parser.
		request, _ := fields.Request.Get()
		cfg := &HTTPConfig{
			URL:             request.URL.Or(""),
			Method:          request.Method.Or(""),
			Headers:         request.Headers.Or(nil),
			Body:            request.Body.Or(""),
			EnableCookies:   fields.EnableCookies.Or(false),
			cookiesFilename: cookiesFilename,
		}
		if _, err := url.Parse(cfg.URL); err != nil {
			return nil, fmt.Errorf("failed to parse the report collector URL: %w", err)
		}
		if cfg.EnableCookies && cookiesFilename == "" {
			return nil, fmt.Errorf("cookies filename is required for cookies: %w", errors.ErrUnsupported)
		}
		if interval := fields.Interval.Or(""); interval != "" {
			d, err := time.ParseDuration(interval)
			if err != nil {
				return nil, fmt.Errorf("failed to parse interval: %w", err)
			}
			if d < time.Hour {
				return nil, errors.New("interval must be at least 1h")
			}
			cfg.Interval = d
		}
		return cfg, nil
	}
}

// NewReporter implements [Config].
func (c *HTTPConfig) NewReporter(_ context.Context, streamDialer transport.StreamDialer) (Reporter, error) {
	httpClient := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				if strings.HasPrefix(network, "tcp") {
					return streamDialer.DialStream(ctx, addr)
				}
				return nil, fmt.Errorf("protocol not supported: %v", network)
			},
		},
	}
	if c.EnableCookies {
		// Make sure the cookies directory exists.
		if err := os.MkdirAll(path.Dir(c.cookiesFilename), 0700); err != nil {
			return nil, fmt.Errorf("failed to create service data directory: %v", err)
		}
		httpClient.Jar = persistentcookiejar.NewPersistentJar(
			persistentcookiejar.WithFilePath(c.cookiesFilename),
			persistentcookiejar.WithAutoSync(true))
	}
	newRequest := func() (*http.Request, error) {
		method := c.Method
		if method == "" {
			method = http.MethodPost
		}
		var body io.Reader
		if c.Body != "" {
			body = strings.NewReader(c.Body)
		}
		req, err := http.NewRequest(method, c.URL, body)
		if err != nil {
			return nil, err
		}
		for k, v := range c.Headers {
			req.Header[k] = v
		}
		return req, nil
	}
	return &HTTPReporter{NewRequest: newRequest, Interval: c.Interval, HttpClient: httpClient}, nil
}
