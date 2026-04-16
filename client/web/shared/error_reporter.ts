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
import type {Integration} from '@sentry/core';

export type Tags = {[id: string]: string | boolean | number};

export interface OutlineErrorReporter {
  sendFeedback(
    message: string,
    feedbackCategory: string,
    userEmail?: string,
    tags?: Tags
  ): Promise<void>;
}

export class SentryErrorReporter implements OutlineErrorReporter {
  constructor(
    appVersion: string,
    dsn: string,
    private tags: Tags
  ) {
    if (dsn) {
      Sentry.init({
        dsn,
        release: appVersion,
        integrations: getSentryBrowserIntegrations,
      });
    }
    this.setUpUnhandledRejectionListener();
  }

  async sendFeedback(
    message: string,
    feedbackCategory: string,
    userEmail?: string,
    tags?: Tags
  ): Promise<void> {
    const combinedTags = {...this.tags, ...tags};
    Sentry.captureFeedback({
      message: message,
      email: userEmail,
      tags: {
        category: feedbackCategory,
        ...combinedTags,
      },
    });
  }

  private setUpUnhandledRejectionListener() {
    // Chrome is the only browser that supports the unhandledrejection event.
    // This is fine for Android, but will not work in iOS.
    const unhandledRejection = 'unhandledrejection';
    window.addEventListener(
      unhandledRejection,
      (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const msg = reason.stack ? reason.stack : reason;
        Sentry.addBreadcrumb({message: msg, category: unhandledRejection});
      }
    );
  }
}

// Returns a list of Sentry browser integrations that maintains the default integrations,
// but replaces the Breadcrumbs integration with a custom one that only collects console statements.
// See https://docs.sentry.io/platforms/javascript/configuration/integrations/default/
export function getSentryBrowserIntegrations(
  defaultIntegrations: Integration[]
): Integration[] {
  const integrations = defaultIntegrations.filter(integration => {
    return integration.name !== 'Breadcrumbs';
  });
  const breadcrumbsIntegration = Sentry.breadcrumbsIntegration({
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
