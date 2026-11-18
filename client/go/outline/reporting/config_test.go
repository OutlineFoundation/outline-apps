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
	"io"
	"net/http"
	"testing"
	"time"

	"localhost/client/go/composer"

	"github.com/stretchr/testify/require"
)

func TestHTTPReporterConfigParser_DelegatedNode(t *testing.T) {
	node, err := composer.ParseYAML([]byte(`request: &request
  url: https://collector.example.com/report
  headers:
    Content-Type: [application/json]
    X-Attempt: [1, "2"]
  body: '{"connected":true}'
reporter:
  request: *request
  interval: 2h`))
	require.NoError(t, err)
	var fields map[string]composer.Node
	require.NoError(t, node.Decode(&fields))

	reporter, err := NewHTTPReporterConfigParser("", nil)(context.Background(), fields["reporter"])
	require.NoError(t, err)
	httpReporter := reporter.(*HTTPReporter)
	require.Equal(t, 2*time.Hour, httpReporter.Interval)
	require.Nil(t, httpReporter.HttpClient.Jar)
	request, err := httpReporter.NewRequest()
	require.NoError(t, err)
	require.Equal(t, http.MethodPost, request.Method)
	require.Equal(t, "https://collector.example.com/report", request.URL.String())
	require.Equal(t, []string{"application/json"}, request.Header.Values("Content-Type"))
	require.Equal(t, []string{"1", "2"}, request.Header.Values("X-Attempt"))
	body, err := io.ReadAll(request.Body)
	require.NoError(t, err)
	require.Equal(t, `{"connected":true}`, string(body))
}

func TestHTTPReporterConfigParser_AliasErrorLocation(t *testing.T) {
	node, err := composer.ParseYAML([]byte(`shared_headers: &headers
  X-Test: [ok, {}]
reporter:
  request:
    url: https://collector.example.com/report
    headers: *headers`))
	require.NoError(t, err)
	var fields map[string]composer.Node
	require.NoError(t, node.Decode(&fields))

	_, err = NewHTTPReporterConfigParser("", nil)(context.Background(), fields["reporter"])
	var located *composer.Error
	require.ErrorAs(t, err, &located)
	require.Equal(t, `reporter.request.headers["X-Test"][1]`, located.Path)
	require.Equal(t, 2, located.Line)
	require.Equal(t, 16, located.Column)
}
