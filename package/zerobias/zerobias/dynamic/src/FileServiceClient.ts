import type { HubClientContext } from '@zerobias-com/hub-client';

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The fields of a file-service `FileView` the collector reads. Values are
 * kept exactly as file-service returns them.
 */
export interface FileServiceFile {
  fileVersionId?: string | null;
  size?: number | null;
  mimeType?: string | null;
}

/**
 * The fields of a file-service `FileStatus` the collector reads.
 */
export interface FileServiceFileStatus {
  status?: string | null;
  fileVersionId?: string | null;
}

/**
 * Body of file-service's `PUT /copyFile`, which copies `sourcePath` (a
 * DataProducer objectId) from the hub target `sourceTarget` over the file at
 * `destinationPath`.
 */
export interface FileServiceCopyRequest {
  sourceTarget: string;
  sourcePath: string;
  destinationPath: string;
}

/**
 * The file-service calls the collector makes. The collector depends on this
 * interface rather than on `FileServiceClient` so tests can substitute a fake.
 */
export interface FileService {
  copyFile(request: FileServiceCopyRequest): Promise<void>;
  getFile(fileId: string): Promise<FileServiceFile>;
  getFileStatus(fileId: string): Promise<FileServiceFileStatus>;
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
 * Minimal file-service client on Node's global `fetch`. It authenticates the
 * way the job's other platform calls do: the org API key as
 * `Authorization: APIKey <key>` plus the `dana-org-id` header. Any non-2xx
 * response rejects, so a 404 reaches the caller the same way a network
 * failure does.
 */
export class FileServiceClient implements FileService {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly orgId: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /**
   * Build a client from the hub-client context: the hub server URL (from
   * `HUB_API`), the org API key and the org ID the job runs as.
   */
  static fromContext(
    context: Pick<HubClientContext, 'server' | 'apiKey' | 'orgId'>,
    fetchFn: typeof fetch = fetch,
  ): FileServiceClient {
    return new FileServiceClient(fileServiceUrl(context.server), context.apiKey, context.orgId.toString(), fetchFn);
  }

  async copyFile(request: FileServiceCopyRequest): Promise<void> {
    await this.send('PUT', '/copyFile', request);
  }

  /**
   * Read a file's `FileView`. file-service serves it at `/files/{id}/metadata`;
   * `/files/{id}` itself only accepts PUT and DELETE.
   */
  async getFile(fileId: string): Promise<FileServiceFile> {
    return this.send('GET', `/files/${encodeURIComponent(fileId)}/metadata`);
  }

  async getFileStatus(fileId: string): Promise<FileServiceFileStatus> {
    return this.send('GET', `/files/${encodeURIComponent(fileId)}/status`);
  }

  /**
   * Send one JSON request and return the parsed response body. The body is
   * always read, so the connection is released even when it is not needed.
   */
  private async send(method: string, path: string, body?: object): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `APIKey ${this.apiKey}`,
      'dana-org-id': this.orgId,
      Accept: 'application/json',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`file-service ${method} ${path} returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    return text ? JSON.parse(text) : undefined;
  }
}
