import './outline-gcp-create-server-app';

import {GcpCreateServerApp} from './outline-gcp-create-server-app';

describe('OutlineGcpCreateServerApp project setup step', () => {
  const messages: Record<string, string> = {
    'gcp-billing-title': 'Add a billing account',
    'gcp-billing-body':
      'Waiting for you to add a billing account on Google Cloud',
    'gcp-create-server': 'Create your Google Cloud Project',
    'gcp-create-server-choose-billing':
      'Choose your preferred billing method for this project',
    'gcp-create-server-description':
      'This will create a new project on your GCP account to hold your Outline servers.',
    'gcp-create-server-in-progress': 'IN PROGRESS...',
    'gcp-create-server-name-project': 'Name your new Google Cloud Project',
    'gcp-create-server-project-id': 'Project ID',
    'gcp-create-project': 'Create a Google Cloud project',
  };
  const localize = (key: string) => messages[key] ?? key;

  let el: GcpCreateServerApp;
  beforeEach(async () => {
    el = document.createElement(
      'outline-gcp-create-server-app'
    ) as GcpCreateServerApp;
    document.body.appendChild(el);
    el.localize = localize;
    el.language = 'en';
    await el.updateComplete;
  });
  afterEach(() => {
    el.remove();
  });

  it('renders the project setup step using localized messages', async () => {
    (el as unknown as {currentPage: string}).currentPage = 'projectSetup';
    await el.updateComplete;
    const text = el.shadowRoot.textContent;
    expect(text).toContain('Create your Google Cloud Project');
    expect(text).toContain(
      'This will create a new project on your GCP account'
    );
    expect(text).toContain('Name your new Google Cloud Project');
    expect(text).toContain('Choose your preferred billing method');
    expect(text).toContain('Create a Google Cloud project');
    // paper-input renders its label in its own shadow root, so check the
    // attribute instead of the flattened text.
    const input = el.shadowRoot.querySelector(
      '#projectName'
    ) as HTMLInputElement;
    expect(input.getAttribute('label')).toBe('Project ID');
  });

  it('renders a localized in-progress button while the project is created', async () => {
    (el as unknown as {currentPage: string}).currentPage = 'projectSetup';
    (el as unknown as {isProjectBeingCreated: boolean}).isProjectBeingCreated =
      true;
    await el.updateComplete;
    const button = el.shadowRoot.querySelector('paper-button') as HTMLElement;
    expect(button.textContent).toContain('IN PROGRESS...');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('renders the billing account setup step using localized messages', async () => {
    (el as unknown as {currentPage: string}).currentPage =
      'billingAccountSetup';
    await el.updateComplete;
    const text = el.shadowRoot.textContent;
    expect(text).toContain('Add a billing account');
    expect(text).toContain('Waiting for you to');
  });
});
