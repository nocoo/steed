import { createHttpClient, type HttpClientOptions } from "./http";
import { createOverviewEndpoint, type OverviewEndpoint } from "./overview";
import { createHostsEndpoint, type HostsEndpoint } from "./hosts";
import { createLanesEndpoint, type LanesEndpoint } from "./lanes";
import {
  createAgentsEndpoint,
  type AgentsEndpoint,
  type AgentListQuery,
  type AgentListResponse,
} from "./agents";
import {
  createDataSourcesEndpoint,
  type DataSourcesEndpoint,
  type DataSourceListQuery,
  type DataSourceListResponse,
} from "./data-sources";
import {
  createBindingsEndpoint,
  type BindingsEndpoint,
  type BindingListQuery,
  type BindingListResponse,
} from "./bindings";
import { createMapEndpoint, type MapEndpoint, type MapPayload } from "./map";

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: () => HeadersInit;
}

export interface ApiClient {
  overview: OverviewEndpoint;
  hosts: HostsEndpoint;
  lanes: LanesEndpoint;
  agents: AgentsEndpoint;
  dataSources: DataSourcesEndpoint;
  bindings: BindingsEndpoint;
  map: MapEndpoint;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const httpOpts: HttpClientOptions = {
    baseUrl: opts.baseUrl,
    fetch: opts.fetch,
    headers: opts.headers,
  };
  const http = createHttpClient(httpOpts);

  return {
    overview: createOverviewEndpoint(http),
    hosts: createHostsEndpoint(http),
    lanes: createLanesEndpoint(http),
    agents: createAgentsEndpoint(http),
    dataSources: createDataSourcesEndpoint(http),
    bindings: createBindingsEndpoint(http),
    map: createMapEndpoint(http),
  };
}

export type {
  OverviewEndpoint,
  HostsEndpoint,
  LanesEndpoint,
  AgentsEndpoint,
  AgentListQuery,
  AgentListResponse,
  DataSourcesEndpoint,
  DataSourceListQuery,
  DataSourceListResponse,
  BindingsEndpoint,
  BindingListQuery,
  BindingListResponse,
  MapEndpoint,
  MapPayload,
};

export { ApiHttpError } from "../server/errors";
