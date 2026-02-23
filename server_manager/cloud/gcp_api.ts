// Copyright 2021 The Outline Authors
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

// TODO: Share the same OAuth config between electron app and renderer.
// Keep this in sync with {@link gcp_oauth.ts#OAUTH_CONFIG}
const GCP_OAUTH_CLIENT_ID =
  '946220775492-a5v6bsdin6o7ncnqn34snuatmrp7dqh0.apps.googleusercontent.com';
// Note: For native apps, the "client secret" is not actually a secret.
// See https://developers.google.com/identity/protocols/oauth2/native-app.
const GCP_OAUTH_CLIENT_SECRET = 'lQT4Qx9b3CaSHDcnuYFgyYVE';

export class GcpError extends Error {
  constructor(code: number, message?: string) {
    // ref:
    // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
    super(`Error ${code}: ${message}`); // 'Error' breaks prototype chain here
    Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
    this.name = new.target.name;
  }
}

/** @see https://cloud.google.com/compute/docs/reference/rest/v1/instances */
export type Instance = Readonly<{
  id: string;
  creationTimestamp: string;
  name: string;
  description: string;
  tags: {items: string[]; fingerprint: string};
  machineType: string;
  zone: string;
  networkInterfaces: Array<{
    network: string;
    subnetwork: string;
    networkIP: string;
    ipv6Address: string;
    name: string;
    accessConfigs: Array<{
      type: string;
      name: string;
      natIP: string;
      setPublicPtr: boolean;
      publicPtrDomainName: string;
      networkTier: string;
      kind: string;
    }>;
  }>;
}>;

/** @see https://cloud.google.com/compute/docs/reference/rest/v1/addresses */
type StaticIp = Readonly<{}>;

const GCE_V1_API = 'https://compute.googleapis.com/compute/v1';

function projectUrl(projectId: string): string {
  return `${GCE_V1_API}/projects/${projectId}`;
}

export interface RegionLocator {
  /** The GCP project ID. */
  projectId: string;
  /** The region of the operation. */
  regionId: string;
}

function regionUrl({projectId, regionId}: RegionLocator): string {
  return `${projectUrl(projectId)}/regions/${regionId}`;
}

/**
 * Represents the scope of a zonal operation
 */
export interface ZoneLocator {
  /** The GCP project ID. */
  projectId: string;
  /** The zone of the operation. */
  zoneId: string;
}

function zoneUrl({projectId, zoneId}: ZoneLocator): string {
  return `${projectUrl(projectId)}/zones/${zoneId}`;
}

const zoneUrlRegExp = new RegExp(
  '/compute/v1/projects/(?<projectId>[^/]+)/zones/(?<zoneId>[^/]+)$'
);

export function parseZoneUrl(url: string): ZoneLocator {
  const groups = new URL(url).pathname.match(zoneUrlRegExp).groups;
  return {
    projectId: groups['projectId'],
    zoneId: groups['zoneId'],
  };
}

/**
 * Helper type to avoid error-prone positional arguments to instance-related
 * functions.
 */
export interface InstanceLocator extends ZoneLocator {
  /** The ID of the instance. */
  instanceId: string;
}

function instanceUrl(instance: InstanceLocator): string {
  return `${zoneUrl(instance)}/instances/${instance.instanceId}`;
}

/**
 * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/getGuestAttributes#response-body
 */
type GuestAttributes = Readonly<{
  variableKey: string;
  variableValue: string;
  queryPath: string;
  queryValue: {items: Array<{namespace: string; key: string; value: string}>};
}>;

/** @see https://cloud.google.com/compute/docs/reference/rest/v1/zones */
type Zone = Readonly<{
  id: string;
  creationTimestamp: string;
  name: string;
  description: string;
  status: 'UP' | 'DOWN';
  region: string;
}>;

type Status = Readonly<{code: number; message: string}>;

/** @see https://cloud.google.com/resource-manager/reference/rest/Shared.Types/Operation */
export type ResourceManagerOperation = Readonly<{
  name: string;
  done: boolean;
  error: Status;
}>;

/**
 * @see https://cloud.google.com/compute/docs/reference/rest/v1/globalOperations
 * @see https://cloud.google.com/compute/docs/reference/rest/v1/zoneOperations
 */
export type ComputeEngineOperation = Readonly<{
  id: string;
  name: string;
  targetId: string;
  status: string;
  error: {errors: Status[]};
}>;

/**
 * @see https://cloud.google.com/service-usage/docs/reference/rest/Shared.Types/ListOperationsResponse#Operation
 */
type ServiceUsageOperation = Readonly<{
  name: string;
  done: boolean;
  error: Status;
}>;

/** @see https://cloud.google.com/resource-manager/reference/rest/v1/projects */
export type Project = Readonly<{
  projectNumber: string;
  projectId: string;
  name: string;
  lifecycleState: string;
}>;

/** @see https://cloud.google.com/compute/docs/reference/rest/v1/firewalls/get#response-body */
type Firewall = Readonly<{id: string; name: string}>;

/** https://cloud.google.com/billing/docs/reference/rest/v1/billingAccounts */
export type BillingAccount = Readonly<{
  name: string;
  open: boolean;
  displayName: string;
  masterBillingAccount: string;
}>;

/** https://cloud.google.com/billing/docs/reference/rest/v1/ProjectBillingInfo */
export type ProjectBillingInfo = Readonly<{
  name: string;
  projectId: string;
  billingAccountName?: string;
  billingEnabled?: boolean;
}>;

/**
 * @see https://accounts.google.com/.well-known/openid-configuration for
 * supported claims.
 *
 * Note: The supported claims are optional and not guaranteed to be in the
 * response.
 */
export type UserInfo = Readonly<{email: string}>;

type Service = Readonly<{
  name: string;
  config: {name: string};
  state: 'STATE_UNSPECIFIED' | 'DISABLED' | 'ENABLED';
}>;

type ItemsResponse<T> = Readonly<{items: T; nextPageToken: string}>;

type ListInstancesResponse = ItemsResponse<Instance[]>;
type ListAllInstancesResponse = ItemsResponse<{
  [zone: string]: {instances: Instance[]};
}>;
type ListZonesResponse = ItemsResponse<Zone[]>;
type ListProjectsResponse = Readonly<{
  projects: Project[];
  nextPageToken: string;
}>;
type ListFirewallsResponse = ItemsResponse<Firewall[]>;
type ListBillingAccountsResponse = Readonly<{
  billingAccounts: BillingAccount[];
  nextPageToken: string;
}>;
type ListEnabledServicesResponse = Readonly<{
  services: Service[];
  nextPageToken: string;
}>;
type RefreshAccessTokenResponse = Readonly<{
  access_token: string;
  expires_in: number;
}>;

export class HttpError extends Error {
  constructor(
    private statusCode: number,
    message?: string
  ) {
    super(message);
  }

  getStatusCode(): number {
    return this.statusCode;
  }
}

export class RestApiClient {
  private readonly GCP_HEADERS = new Map<string, string>([
    ['Content-type', 'application/json'],
    ['Accept', 'application/json'],
  ]);

  private accessToken: string;

  constructor(private refreshToken: string) {}

  /**
   * Creates a new Google Compute Engine VM instance in a specified GCP project.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/insert
   *
   * @param zone - Indicates the GCP project and zone.
   * @param data - Request body data. See documentation.
   * @return The initial operation response.  Call computeEngineOperationZoneWait
   *     to wait for the creation process to complete.
   */
  async createInstance(
    zone: ZoneLocator,
    data: {}
  ): Promise<ComputeEngineOperation> {
    return this.fetchAuthenticated<ComputeEngineOperation>(
      'POST',
      new URL(`${zoneUrl(zone)}/instances`),
      this.GCP_HEADERS,
      null,
      data
    );
  }

  /**
   * Deletes a specified Google Compute Engine VM instance.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/delete
   *
   * @param instance - Identifies the instance to delete.
   * @return The initial operation response.  Call computeEngineOperationZoneWait
   *     to wait for the deletion process to complete.
   */
  deleteInstance(instance: InstanceLocator): Promise<ComputeEngineOperation> {
    return this.fetchAuthenticated<ComputeEngineOperation>(
      'DELETE',
      new URL(instanceUrl(instance)),
      this.GCP_HEADERS
    );
  }

  /**
   * Gets the specified Google Compute Engine VM instance resource.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/get
   *
   * @param instance - Identifies the instance to return.
   */
  getInstance(instance: InstanceLocator): Promise<Instance> {
    return this.fetchAuthenticated(
      'GET',
      new URL(instanceUrl(instance)),
      this.GCP_HEADERS
    );
  }

  /**
   * Lists the Google Compute Engine VM instances in a specified zone.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/list
   *
   * @param zone - Indicates the GCP project and zone.
   * @param filter - See documentation.
   */
  // TODO: Pagination
  listInstances(
    zone: ZoneLocator,
    filter?: string
  ): Promise<ListInstancesResponse> {
    let parameters = null;
    if (filter) {
      parameters = new Map<string, string>([['filter', filter]]);
    }
    return this.fetchAuthenticated(
      'GET',
      new URL(`${zoneUrl(zone)}/instances`),
      this.GCP_HEADERS,
      parameters
    );
  }

  /**
   * Lists all the Google Compute Engine VM instances in a specified project.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/aggregatedList
   *
   * @param projectId - The GCP project.
   * @param filter - See documentation.
   */
  // TODO: Pagination
  listAllInstances(
    projectId: string,
    filter?: string
  ): Promise<ListAllInstancesResponse> {
    let parameters = null;
    if (filter) {
      parameters = new Map<string, string>([['filter', filter]]);
    }
    return this.fetchAuthenticated(
      'GET',
      new URL(`${projectUrl(projectId)}/aggregated/instances`),
      this.GCP_HEADERS,
      parameters
    );
  }

  /**
   * Creates a static IP address.
   *
   * If no IP address is provided, a new static IP address is created. If an
   * ephemeral IP address is provided, it is promoted to a static IP address.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/addresses/insert
   *
   * @param region - The GCP project and region.
   * @param data - Request body data. See documentation.
   */
  async createStaticIp(
    region: RegionLocator,
    data: {}
  ): Promise<ComputeEngineOperation> {
    const operation = await this.fetchAuthenticated<ComputeEngineOperation>(
      'POST',
      new URL(`${regionUrl(region)}/addresses`),
      this.GCP_HEADERS,
      null,
      data
    );
    return await this.computeEngineOperationRegionWait(region, operation.name);
  }

  /**
   * Deletes a static IP address.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/addresses/delete
   *
   * @param region - The GCP project and region.
   * @param addressName - The name of the static IP address resource.
   * @return The initial operation response.  Call computeEngineOperationRegionWait
   *     to wait for the deletion process to complete.
   */
  deleteStaticIp(
    region: RegionLocator,
    addressName: string
  ): Promise<ComputeEngineOperation> {
    return this.fetchAuthenticated<ComputeEngineOperation>(
      'DELETE',
      new URL(`${regionUrl(region)}/addresses/${addressName}`),
      this.GCP_HEADERS
    );
  }

  /**
   * Retrieves a static IP address, if it exists.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/addresses/get
   *
   * @param region - The GCP project and region.
   * @param addressName - The name of the static IP address resource.
   */
  getStaticIp(region: RegionLocator, addressName: string): Promise<StaticIp> {
    return this.fetchAuthenticated<ComputeEngineOperation>(
      'GET',
      new URL(`${regionUrl(region)}/addresses/${addressName}`),
      this.GCP_HEADERS
    );
  }

  /**
   * Lists the guest attributes applied to the specified Google Compute Engine VM instance.
   *
   * @see https://cloud.google.com/compute/docs/storing-retrieving-metadata#guest_attributes
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/instances/getGuestAttributes
   *
   * @param instance - Identifies the instance to inspect.
   * @param namespace - The namespace of the guest attributes.
   */
  async getGuestAttributes(
    instance: InstanceLocator,
    namespace: string
  ): Promise<GuestAttributes | undefined> {
    try {
      const parameters = new Map<string, string>([['queryPath', namespace]]);
      // We must await the call to getGuestAttributes to properly catch any exceptions.
      return await this.fetchAuthenticated(
        'GET',
        new URL(`${instanceUrl(instance)}/getGuestAttributes`),
        this.GCP_HEADERS,
        parameters
      );
    } catch {
      // TODO: Distinguish between 404 not found and other errors.
      return undefined;
    }
  }

  /**
   * Creates a firewall under the specified GCP project.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/firewalls/insert
   *
   * @param projectId - The GCP project ID.
   * @param data - Request body data. See documentation.
   */
  async createFirewall(
    projectId: string,
    data: {}
  ): Promise<ComputeEngineOperation> {
    const operation = await this.fetchAuthenticated<ComputeEngineOperation>(
      'POST',
      new URL(`${projectUrl(projectId)}/global/firewalls`),
      this.GCP_HEADERS,
      null,
      data
    );
    return await this.computeEngineOperationGlobalWait(
      projectId,
      operation.name
    );
  }

  /**
   * @param projectId - The GCP project ID.
   * @param name - The firewall name.
   */
  // TODO: Replace with getFirewall (and handle 404 NotFound)
  listFirewalls(
    projectId: string,
    name: string
  ): Promise<ListFirewallsResponse> {
    const filter = `name=${name}`;
    const parameters = new Map<string, string>([['filter', filter]]);
    return this.fetchAuthenticated(
      'GET',
      new URL(`${projectUrl(projectId)}/global/firewalls`),
      this.GCP_HEADERS,
      parameters
    );
  }

  /**
   * Lists the zones available to a given GCP project.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/zones/list
   *
   * @param projectId - The GCP project ID.
   */
  // TODO: Pagination
  listZones(projectId: string): Promise<ListZonesResponse> {
    return this.fetchAuthenticated(
      'GET',
      new URL(`${projectUrl(projectId)}/zones`),
      this.GCP_HEADERS
    );
  }

  /**
   * Lists all services that have been enabled on the project.
   *
   * @param projectId - The GCP project ID.
   */
  listEnabledServices(projectId: string): Promise<ListEnabledServicesResponse> {
    const parameters = new Map<string, string>([['filter', 'state:ENABLED']]);
    return this.fetchAuthenticated(
      'GET',
      new URL(
        `https://serviceusage.googleapis.com/v1/projects/${projectId}/services`
      ),
      this.GCP_HEADERS,
      parameters
    );
  }

  /**
   * @param projectId - The GCP project ID.
   * @param data - Request body data. See documentation.
   */
  enableServices(projectId: string, data: {}): Promise<ServiceUsageOperation> {
    return this.fetchAuthenticated(
      'POST',
      new URL(
        `https://serviceusage.googleapis.com/v1/projects/${projectId}/services:batchEnable`
      ),
      this.GCP_HEADERS,
      null,
      data
    );
  }

  /**
   * Creates a new GCP project
   *
   * The project ID must conform to the following:
   * - must be 6 to 30 lowercase letters, digits, or hyphens
   * - must start with a letter
   * - no trailing hyphens
   *
   * @see https://cloud.google.com/resource-manager/reference/rest/v1/projects/create
   *
   * @param data - Request body data. See documentation.
   */
  createProject(data: {}): Promise<ResourceManagerOperation> {
    return this.fetchAuthenticated(
      'POST',
      new URL('https://cloudresourcemanager.googleapis.com/v1/projects'),
      this.GCP_HEADERS,
      null,
      data
    );
  }

  /**
   * Lists the GCP projects that the user has access to.
   *
   * @see https://cloud.google.com/resource-manager/reference/rest/v1/projects/list
   *
   * @param filter - See documentation.
   */
  listProjects(filter?: string): Promise<ListProjectsResponse> {
    let parameters = null;
    if (filter) {
      parameters = new Map<string, string>([['filter', filter]]);
    }
    return this.fetchAuthenticated(
      'GET',
      new URL('https://cloudresourcemanager.googleapis.com/v1/projects'),
      this.GCP_HEADERS,
      parameters
    );
  }

  /**
   * Gets the billing information for a specified GCP project.
   *
   * @see https://cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo
   *
   * @param projectId - The GCP project ID.
   */
  getProjectBillingInfo(projectId: string): Promise<ProjectBillingInfo> {
    return this.fetchAuthenticated(
      'GET',
      new URL(
        `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`
      ),
      this.GCP_HEADERS
    );
  }

  /**
   * Associates a GCP project with a billing account.
   *
   * @see https://cloud.google.com/billing/docs/reference/rest/v1/projects/updateBillingInfo
   *
   * @param projectId - The GCP project ID.
   * @param data - Request body data. See documentation.
   */
  updateProjectBillingInfo(
    projectId: string,
    data: {}
  ): Promise<ProjectBillingInfo> {
    return this.fetchAuthenticated(
      'PUT',
      new URL(
        `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`
      ),
      this.GCP_HEADERS,
      null,
      data
    );
  }

  /**
   * Lists the billing accounts that the user has access to.
   *
   * @see https://cloud.google.com/billing/docs/reference/rest/v1/billingAccounts/list
   */
  listBillingAccounts(): Promise<ListBillingAccountsResponse> {
    return this.fetchAuthenticated(
      'GET',
      new URL('https://cloudbilling.googleapis.com/v1/billingAccounts'),
      this.GCP_HEADERS
    );
  }

  /**
   * Waits for a specified Google Compute Engine zone operation to complete.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/zoneOperations/wait
   *
   * @param zone - Indicates the GCP project and zone.
   * @param operationId - The operation ID.
   */
  async computeEngineOperationZoneWait(
    zone: ZoneLocator,
    operationId: string
  ): Promise<ComputeEngineOperation> {
    const operation = await this.fetchAuthenticated<ComputeEngineOperation>(
      'POST',
      new URL(`${zoneUrl(zone)}/operations/${operationId}/wait`),
      this.GCP_HEADERS
    );
    if (operation.error?.errors) {
      throw new GcpError(
        operation?.error.errors[0]?.code,
        operation?.error.errors[0]?.message
      );
    }
    return operation;
  }

  /**
   * Waits for a specified Google Compute Engine region operation to complete.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/regionOperations/wait
   *
   * @param region - The GCP project and region.
   * @param operationId - The operation ID.
   */
  computeEngineOperationRegionWait(
    region: RegionLocator,
    operationId: string
  ): Promise<ComputeEngineOperation> {
    return this.fetchAuthenticated(
      'POST',
      new URL(`${regionUrl(region)}/operations/${operationId}/wait`),
      this.GCP_HEADERS
    );
  }

  /**
   * Waits for a specified Google Compute Engine global operation to complete.
   *
   * @see https://cloud.google.com/compute/docs/reference/rest/v1/globalOperations/wait
   *
   * @param projectId - The GCP project ID.
   * @param operationId - The operation ID.
   */
  computeEngineOperationGlobalWait(
    projectId: string,
    operationId: string
  ): Promise<ComputeEngineOperation> {
    return this.fetchAuthenticated(
      'POST',
      new URL(`${projectUrl(projectId)}/global/operations/${operationId}/wait`),
      this.GCP_HEADERS
    );
  }

  resourceManagerOperationGet(
    operationId: string
  ): Promise<ResourceManagerOperation> {
    return this.fetchAuthenticated(
      'GET',
      new URL(`https://cloudresourcemanager.googleapis.com/v1/${operationId}`),
      this.GCP_HEADERS
    );
  }

  serviceUsageOperationGet(
    operationId: string
  ): Promise<ServiceUsageOperation> {
    return this.fetchAuthenticated(
      'GET',
      new URL(`https://serviceusage.googleapis.com/v1/${operationId}`),
      this.GCP_HEADERS
    );
  }

  /**
   * Gets the OpenID Connect profile information.
   *
   * For a list of the supported Google OpenID claims
   * @see https://accounts.google.com/.well-known/openid-configuration.
   *
   * The OpenID standard, including the "userinfo" response and core claims, is
   * defined in the links below:
   * @see https://openid.net/specs/openid-connect-core-1_0.html#UserInfoResponse
   * @see https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
   */
  getUserInfo(): Promise<UserInfo> {
    return this.fetchAuthenticated(
      'POST',
      new URL('https://openidconnect.googleapis.com/v1/userinfo'),
      this.GCP_HEADERS
    );
  }

  private async refreshGcpAccessToken(refreshToken: string): Promise<string> {
    const headers = new Map<string, string>([
      ['Host', 'oauth2.googleapis.com'],
      ['Content-Type', 'application/x-www-form-urlencoded'],
    ]);
    const data = {
      // TODO: Consider moving client ID to the caller.
      client_id: GCP_OAUTH_CLIENT_ID,
      client_secret: GCP_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    };
    const encodedData = this.encodeFormData(data);
    const response: RefreshAccessTokenResponse =
      await this.fetchUnauthenticated(
        'POST',
        new URL('https://oauth2.googleapis.com/token'),
        headers,
        null,
        encodedData
      );
    return response.access_token;
  }

  /**
   * Revokes a token.
   *
   * @see https://developers.google.com/identity/protocols/oauth2/native-app
   *
   * @param token - A refresh token or access token
   */
  // TODO(fortuna): use this to revoke the access token on account disconnection.
  // private async revokeGcpToken(token: string): Promise<void> {
  //   const headers = new Map<string, string>(
  //       [['Host', 'oauth2.googleapis.com'], ['Content-Type', 'application/x-www-form-urlencoded']]);
  //   const parameters = new Map<string, string>([['token', token]]);
  //   return this.fetchUnauthenticated(
  //       'GET', new URL('https://oauth2.googleapis.com/revoke'), headers, parameters);
  // }

  private async fetchAuthenticated<T>(
    method: string,
    url: URL,
    headers: Map<string, string>,
    parameters?: Map<string, string>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any
  ): Promise<T> {
    const httpHeaders = new Map(headers);

    // TODO: Handle token expiration/revokation.
    if (!this.accessToken) {
      this.accessToken = await this.refreshGcpAccessToken(this.refreshToken);
    }
    httpHeaders.set('Authorization', `Bearer ${this.accessToken}`);
    return this.fetchUnauthenticated(
      method,
      url,
      httpHeaders,
      parameters,
      data
    );
  }

  private async fetchUnauthenticated<T>(
    method: string,
    url: URL,
    headers: Map<string, string>,
    parameters?: Map<string, string>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any
  ): Promise<T> {
    const customHeaders = new Headers();
    headers.forEach((value, key) => {
      customHeaders.append(key, value);
    });
    if (parameters) {
      parameters.forEach((value: string, key: string) =>
        url.searchParams.append(key, value)
      );
    }

    // TODO: More robust handling of data types
    if (typeof data === 'object') {
      data = JSON.stringify(data);
    }

    const response = await fetch(url.toString(), {
      method: method.toUpperCase(),
      headers: customHeaders,
      ...(data && {body: data}),
    });

    if (!response.ok) {
      throw new HttpError(response.status, response.statusText);
    }

    try {
      let result = undefined;
      if (response.status !== 204) {
        result = await response.json();
      }
      return result;
    } catch (e) {
      throw new Error('Error parsing response body: ' + JSON.stringify(e));
    }
  }

  private encodeFormData(data: object): string {
    return Object.entries(data)
      .map(entry => {
        return (
          encodeURIComponent(entry[0]) + '=' + encodeURIComponent(entry[1])
        );
      })
      .join('&');
  }
}
