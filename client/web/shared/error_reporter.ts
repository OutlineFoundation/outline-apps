// Copyright 2018 The Outline Authors
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

import * as Sentry from '@sentry/browser';
import {Integration as SentryIntegration} from '@sentry/types';

export type Tags = {[id: string]: string | boolean | number};

export interface OutlineErrorReporter {
  report(userFeedback: string, feedbackCategory: string, userEmail?: string, tags?: Tags): Promise<void>;
}

export class SentryErrorReporter implements OutlineErrorReporter {
  constructor(appVersion: string, dsn: string, private tags: Tags) {
    if (dsn) {
      Sentry.init({dsn, release: appVersion, integrations: getSentryBrowserIntegrations});
    }
    this.setUpUnhandledRejectionListener();
  }

  async report(userFeedback: string, feedbackCategory: string, userEmail?: string, tags?: Tags): Promise<void> {
    const combinedTags = {...this.tags, ...tags};
    Sentry.captureEvent({
      message: userFeedback,
      user: {email: userEmail},
      tags: {
        category: feedbackCategory,
        isFeedback: Boolean(userFeedback),
        ...combinedTags,
      },
    });
    Sentry.configureScope(scope => {
      scope.setUser({email: userEmail || ''});
      if (combinedTags) {
        scope.setTags(combinedTags);
      }
      scope.setTag('category', feedbackCategory);
    });
    Sentry.captureMessage(userFeedback);
    Sentry.configureScope(scope => {
      scope.clear(); // Reset the user context, don't cache the email
    });
  }

  private setUpUnhandledRejectionListener() {
    // Chrome is the only browser that supports the unhandledrejection event.
    // This is fine for Android, but will not work in iOS.
    const unhandledRejection = 'unhandledrejection';
    window.addEventListener(unhandledRejection, (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason.stack ? reason.stack : reason;
      Sentry.addBreadcrumb({message: msg, category: unhandledRejection});
    });
  }
}

// Returns a list of Sentry browser integrations that maintains the default integrations,
// but replaces the Breadcrumbs integration with a custom one that only collects console statements.
// See https://docs.sentry.io/platforms/javascript/configuration/integrations/default/
export function getSentryBrowserIntegrations(defaultIntegrations: SentryIntegration[]): SentryIntegration[] {
  const integrations = defaultIntegrations.filter(integration => {
    return integration.name !== 'Breadcrumbs';
  });
  const breadcrumbsIntegration = new Sentry.Integrations.Breadcrumbs({
    console: true,
    dom: false,
    fetch: false,
    history: false,
    sentry: false,
    xhr: false,
  });
  integrations.push(breadcrumbsIntegration);
  return integrations;
}
