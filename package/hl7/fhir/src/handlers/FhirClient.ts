import { LoggerEngine } from '@zerobias-org/logger';
import type { FhirBundle, OAuthToken } from '../types/index.js';

const LOGGER_NAME = 'CollectorHl7Fhir:FhirClient';

export class FhirClient {
  private readonly logger = LoggerEngine.root().get(LOGGER_NAME);
  private readonly baseUrl: string;
  private token: OAuthToken | null = null;
  private tokenExpiry = 0;

  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly tokenUrl?: string;
  private readonly scopes?: string;

  constructor(
    baseUrl: string,
    auth?: { clientId?: string; clientSecret?: string; tokenUrl?: string; scopes?: string },
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.clientId = auth?.clientId;
    this.clientSecret = auth?.clientSecret;
    this.tokenUrl = auth?.tokenUrl;
    this.scopes = auth?.scopes;
  }

  private async authenticate(): Promise<string | undefined> {
    if (!this.clientId || !this.clientSecret || !this.tokenUrl) {
      return undefined;
    }

    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token.access_token;
    }

    this.logger.info(`Authenticating with token endpoint: ${this.tokenUrl}`);
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (this.scopes) {
      body.set('scope', this.scopes);
    }

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`OAuth2 authentication failed: ${response.status} ${response.statusText}`);
    }

    this.token = (await response.json()) as OAuthToken;
    this.tokenExpiry = Date.now() + ((this.token.expires_in ?? 3600) - 60) * 1000;
    return this.token.access_token;
  }

  private async request(url: string): Promise<any> {
    const headers: Record<string, string> = {
      Accept: 'application/fhir+json',
    };

    const accessToken = await this.authenticate();
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`FHIR request failed: ${response.status} ${response.statusText} - ${url}`);
    }
    return response.json();
  }

  async getCapabilityStatement(): Promise<Record<string, any>> {
    return this.request(`${this.baseUrl}/metadata`);
  }

  async searchResources(resourceType: string, pageSize: number): Promise<FhirBundle> {
    return this.request(`${this.baseUrl}/${resourceType}?_count=${pageSize}`) as Promise<FhirBundle>;
  }

  async getNextPage(nextUrl: string): Promise<FhirBundle> {
    if (!nextUrl.startsWith(this.baseUrl)) {
      throw new Error(`SSRF guard: next-page URL "${nextUrl}" is outside base URL "${this.baseUrl}"`);
    }
    return this.request(nextUrl) as Promise<FhirBundle>;
  }

  async *paginateResources(resourceType: string, pageSize: number): AsyncGenerator<Record<string, any>[]> {
    let bundle = await this.searchResources(resourceType, pageSize);

    while (true) {
      const entries = bundle.entry ?? [];
      if (entries.length === 0) break;

      yield entries.map((e) => e.resource);

      const nextLink = bundle.link?.find((l) => l.relation === 'next');
      if (!nextLink) break;

      bundle = await this.getNextPage(nextLink.url);
    }
  }
}
