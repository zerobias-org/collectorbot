import { LoggerEngine } from '@zerobias-org/logger';
import type { FhirBundle, FhirResource, OAuthToken } from '../types/index.js';

const LOGGER_NAME = 'FhirClient';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 500;

interface FhirAuthConfig {
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scopes?: string;
}

export class FhirClient {
  private readonly logger = LoggerEngine.root().get(LOGGER_NAME);
  private readonly baseUrl: string;
  private readonly auth: FhirAuthConfig;
  private token: OAuthToken | undefined;
  private tokenExpiry = 0;

  constructor(baseUrl: string, auth?: FhirAuthConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = auth ?? {};
  }

  private async getAccessToken(): Promise<string | undefined> {
    const { clientId, clientSecret, tokenUrl, scopes } = this.auth;
    if (!clientId || !clientSecret || !tokenUrl) return undefined;

    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token.access_token;
    }

    this.logger.info(`Authenticating via ${tokenUrl}`);
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
    if (scopes) body.set('scope', scopes);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OAuth2 failed: ${response.status} ${response.statusText}`);

    this.token = (await response.json()) as OAuthToken;
    this.tokenExpiry = Date.now() + ((this.token.expires_in ?? 3600) - 60) * 1000;
    return this.token.access_token;
  }

  private async request<T = any>(url: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/fhir+json' };
    const accessToken = await this.getAccessToken();
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`FHIR ${response.status} ${response.statusText}: ${url}`);
    return response.json() as Promise<T>;
  }

  async getCapabilityStatement(): Promise<Record<string, any>> {
    return this.request(`${this.baseUrl}/metadata`);
  }

  async *paginateResources(resourceType: string, pageSize: number): AsyncGenerator<FhirResource[]> {
    let url = `${this.baseUrl}/${resourceType}?_count=${pageSize}`;
    let page = 0;

    while (url) {
      if (++page > MAX_PAGES) {
        this.logger.warn(`${resourceType}: reached ${MAX_PAGES} page limit, stopping`);
        break;
      }

      const bundle = await this.request<FhirBundle>(url);
      const entries = bundle.entry ?? [];
      if (entries.length === 0) break;

      yield entries.map((entry) => entry.resource);

      const next = bundle.link?.find((link) => link.relation === 'next')?.url;
      if (!next) break;
      if (!next.startsWith(this.baseUrl)) {
        throw new Error(`SSRF guard: next URL outside base: ${next}`);
      }
      url = next;
    }
  }
}
