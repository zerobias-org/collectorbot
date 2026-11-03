import type { HubClientContext } from '@zerobias-com/hub-client';

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The fields of a file-service `FileView` a file-backed mapping reads. Values
 * are kept exactly as file-service returns them.
 */
export interface SourceFileView {
  id?: string | null;
  name?: string | null;
  fileVersionId?: string | null;
  size?: number | null;
  mimeType?: string | null;
  created?: string | null;
  updated?: string | null;
}

/**
 * One page of a file container's records (a workbook sheet's rows, or a
 * CSV's). `count` is the total across all pages, or -1 when file-service
 * didn't say.
 */
export interface SourceRecordsPage {
  items: Record<string, unknown>[];
  count: number;
}

/**
 * The file-service reads a file-backed mapping makes. The collector depends
 * on this interface rather than on `FileSourceClient` so tests can substitute
 * a fake.
 */
export interface FileSourceReader {
  getFile(fileId: string): Promise<SourceFileView>;
  listContainerRecords(
    fileVersionId: string,
    containerPath: string,
    pageNumber: number,
    pageSize: number,
  ): Promise<SourceRecordsPage>;
}

/**
 * Derive the file-service base URL from the hub server URL the job runs
 * against, the same way the generated container derives the platform URL:
 * a trailing `/hub` becomes `/file-service`.
 */
export function fileServiceUrl(server: { toString(): string }): string {
  return server.toString().replace(/\/$/, '').replace(/\/hub\/?$/, '/file-service');
}

/**
 * Minimal file-service client on Node's global `fetch`, for mappings whose
 * source is an uploaded file. It authenticates the way the job's other
 * platform calls do: the org API key as `Authorization: APIKey <key>` plus
 * the `dana-org-id` header. Any non-2xx response rejects.
 */
export class FileSourceClient implements FileSourceReader {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly orgId: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /**
   * Build a client from the hub-client context: the hub server URL, the org
   * API key and the org ID the job runs as.
   */
  static fromContext(
    context: Pick<HubClientContext, 'server' | 'apiKey' | 'orgId'>,
    fetchFn: typeof fetch = fetch,
  ): FileSourceClient {
    return new FileSourceClient(fileServiceUrl(context.server), context.apiKey, context.orgId.toString(), fetchFn);
  }

  /**
   * Read a file's `FileView` — its `fileVersionId` is the current version.
   * file-service serves it at `/files/{id}/metadata`; `/files/{id}` itself
   * only accepts PUT and DELETE.
   */
  async getFile(fileId: string): Promise<SourceFileView> {
    return (await this.request(`/files/${encodeURIComponent(fileId)}/metadata`)).body;
  }

  /**
   * Read one page of a file version's container records through
   * file-service's reader (`GET /files/{versionId}/content/containers/records`).
   * The body is the page's rows; the `count` header is the total.
   */
  async listContainerRecords(
    fileVersionId: string,
    containerPath: string,
    pageNumber: number,
    pageSize: number,
  ): Promise<SourceRecordsPage> {
    const query = new URLSearchParams({ containerPath, pageNumber: String(pageNumber), pageSize: String(pageSize) });
    const { body, headers } = await this.request(
      `/files/${encodeURIComponent(fileVersionId)}/content/containers/records?${query.toString()}`,
    );
    const count = headers.get('count');
    return { items: Array.isArray(body) ? body : [], count: count === null ? -1 : Number(count) };
  }

  /**
   * Send one GET and return the parsed body with the response headers. The
   * body is always read, so the connection is released.
   */
  private async request(path: string): Promise<{ body: any; headers: Headers }> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `APIKey ${this.apiKey}`,
        'dana-org-id': this.orgId,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`file-service GET ${path} returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    return { body: text ? JSON.parse(text) : undefined, headers: response.headers };
  }
}
