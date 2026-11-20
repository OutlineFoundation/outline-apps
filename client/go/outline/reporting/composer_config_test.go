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
	"io"
	"os"
	"path"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"localhost/client/go/composer"
	"localhost/client/go/configyaml"
)

func parseHTTPConfig(t *testing.T, cookiesFilename, text string) (*HTTPConfig, error) {
	t.Helper()
	node, err := composer.ParseYAML([]byte(text))
	require.NoError(t, err)
	r := composer.NewRegistry()
	composer.Register(r, "http", composer.As[Config](NewHTTPConfigParser(cookiesFilename)))
	cfg, err := composer.Parse[Config](context.Background(), r, node)
	if err != nil {
		return nil, err
	}
	return cfg.(*HTTPConfig), nil
}

func TestHTTPConfig(t *testing.T) {
	cfg, err := parseHTTPConfig(t, "", `
$type: http
request:
  url: https://collector.example.com/report
  method: PUT
  headers: {X-Key: [v1, v2]}
  body: hello
interval: 24h`)
	require.NoError(t, err)
	require.Equal(t, &HTTPConfig{
		URL:      "https://collector.example.com/report",
		Method:   "PUT",
		Headers:  map[string][]string{"X-Key": {"v1", "v2"}},
		Body:     "hello",
		Interval: 24 * time.Hour,
	}, cfg)

	reporter, err := cfg.NewReporter(context.Background(), nil)
	require.NoError(t, err)
	httpReporter := reporter.(*HTTPReporter)
	require.Equal(t, 24*time.Hour, httpReporter.Interval)
	require.Nil(t, httpReporter.HttpClient.Jar)
	req, err := httpReporter.NewRequest()
	require.NoError(t, err)
	require.Equal(t, "PUT", req.Method)
	require.Equal(t, "https://collector.example.com/report", req.URL.String())
	require.Equal(t, []string{"v1", "v2"}, req.Header["X-Key"])
	body, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	require.Equal(t, "hello", string(body))
}

func TestHTTPConfigDefaults(t *testing.T) {
	cfg, err := parseHTTPConfig(t, "", "$type: http\nrequest: {url: https://collector.example.com/report}\n")
	require.NoError(t, err)
	reporter, err := cfg.NewReporter(context.Background(), nil)
	require.NoError(t, err)
	req, err := reporter.(*HTTPReporter).NewRequest()
	require.NoError(t, err)
	require.Equal(t, "POST", req.Method)
	require.Nil(t, req.Body)
	require.Zero(t, reporter.(*HTTPReporter).Interval)
}

func TestHTTPConfigCookies(t *testing.T) {
	cookies := path.Join(t.TempDir(), "service", "cookies.json")
	cfg, err := parseHTTPConfig(t, cookies, "$type: http\nrequest: {url: https://collector.example.com/report}\nenable_cookies: true\n")
	require.NoError(t, err)
	_, err = os.Stat(path.Dir(cookies))
	require.ErrorIs(t, err, os.ErrNotExist, "parsing must not create the cookies directory")

	reporter, err := cfg.NewReporter(context.Background(), nil)
	require.NoError(t, err)
	require.NotNil(t, reporter.(*HTTPReporter).HttpClient.Jar)
	_, err = os.Stat(path.Dir(cookies))
	require.NoError(t, err, "building creates the cookies directory")
}

func TestHTTPConfigErrors(t *testing.T) {
	for _, tc := range []struct {
		name, text  string
		unsupported bool
	}{
		{"cookies without a cookies file", "$type: http\nrequest: {url: https://c.example.com}\nenable_cookies: true\n", true},
		{"unknown field", "$type: http\nrequest: {url: https://c.example.com}\nverbose: true\n", true},
		{"bad URL", "$type: http\nrequest: {url: '://nope'}\n", false},
		{"bad interval", "$type: http\nrequest: {url: https://c.example.com}\ninterval: soon\n", false},
		{"interval under an hour", "$type: http\nrequest: {url: https://c.example.com}\ninterval: 59m\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseHTTPConfig(t, "", tc.text)
			require.Error(t, err)
			require.Equal(t, tc.unsupported, errors.Is(err, errors.ErrUnsupported), "%v", err)
		})
	}
}

// TestHTTPConfigMatchesLegacyParser runs the same reporter configs through
// the legacy parser and this one.
func TestHTTPConfigMatchesLegacyParser(t *testing.T) {
	for _, text := range []string{
		"$type: http\nrequest: {url: https://c.example.com/r}\ninterval: 24h\n",
		"$type: http\nrequest: {url: https://c.example.com/r, method: GET, headers: {A: [b]}, body: x}\n",
		"$type: http\n",
		"$type: http\nrequest: {url: https://c.example.com}\ninterval: 30m\n",
		"$type: http\nrequest: {url: https://c.example.com}\ninterval: 1d\n",
		"$type: http\nrequest: {url: '://nope'}\n",
		"$type: http\nrequest: {url: https://c.example.com}\nenable_cookies: true\n",
	} {
		t.Run(text, func(t *testing.T) {
			legacyNode, err := configyaml.ParseConfigYAML(text)
			require.NoError(t, err)
			want, wantErr := NewHTTPReporterConfigParser("", nil)(context.Background(), legacyNode.(map[string]any))
			cfg, gotErr := parseHTTPConfig(t, "", text)
			if wantErr != nil {
				require.Error(t, gotErr, "legacy: %v", wantErr)
				require.Equal(t, errors.Is(wantErr, errors.ErrUnsupported), errors.Is(gotErr, errors.ErrUnsupported))
				return
			}
			require.NoError(t, gotErr)
			got, err := cfg.NewReporter(context.Background(), nil)
			require.NoError(t, err)
			wantReq, err := want.(*HTTPReporter).NewRequest()
			require.NoError(t, err)
			gotReq, err := got.(*HTTPReporter).NewRequest()
			require.NoError(t, err)
			require.Equal(t, want.(*HTTPReporter).Interval, got.(*HTTPReporter).Interval)
			require.Equal(t, wantReq.Method, gotReq.Method)
			require.Equal(t, wantReq.URL, gotReq.URL)
			require.Equal(t, wantReq.Header, gotReq.Header)
			require.Equal(t, wantReq.ContentLength, gotReq.ContentLength)
		})
	}
}
