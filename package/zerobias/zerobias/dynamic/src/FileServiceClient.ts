import { setTimeout as sleep } from 'node:timers/promises';
import type { HubClientContext } from '@zerobias-com/hub-client';

/** How long one attempt at a file-service request may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The waits between attempts at a file-service request: up to four attempts, 0.5 s, 1 s and 2 s apart. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

/** Statuses after which the same request may succeed on another attempt. */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * The fields of a file-service `FileView` the collector reads. Values are
 * kept exactly as file-service returns them. A file with no ready version has
 * a null `fileVersionId` and a null `size`.
 */
export interface FileServiceFile {
  fileVersionId?: string | null;
  size?: number | null;
  mimeType?: string | null;
}

/**
 * The fields of a file-service `FileStatus` the collector reads: the state of
 * one file version (`created`, `uploading`, `fetching`, `error` or `ready`).
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
 * Response of `PUT /copyFile`. file-service fetches the bytes in the
 * background, so `status` is that of the new version, usually still
 * `created` or `fetching`.
 */
export interface FileServiceCopyJob {
  transactionId: string;
  file: FileServiceFile;
  status: FileServiceFileStatus;
}

/**
 * A failed file-service request. `status` is the HTTP status of the answer,
 * or undefined when none arrived (a network error or a timeout).
 */
export class FileServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'FileServiceError';
  }
}

/**
 * Whether `error` is file-service answering 404: the file does not exist, or
 * the job cannot see it.
 */
export function isFileNotFound(error: unknown): boolean {
  return error instanceof FileServiceError && error.status === 404;
}

/**
 * The file-service calls the collector makes. The collector depends on this
 * interface rather than on `FileServiceClient` so tests can substitute a fake.
 */
export interface FileService {
  copyFile(request: FileServiceCopyRequest): Promise<FileServiceCopyJob>;
  getFile(fileId: string): Promise<FileServiceFile>;
  getFileStatus(versionOrFileId: string): Promise<FileServiceFileStatus>;
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
 * The file-service base URL a job uses: `FILE_SERVICE_API` when the
 * environment sets it, as it does for hub-client jobs and the slot collector,
 * otherwise the URL derived from the hub server URL.
 */
export function resolveFileServiceUrl(
  server: { toString(): string },
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env.FILE_SERVICE_API?.trim();
  return configured ? configured.replace(/\/+$/, '') : fileServiceUrl(server);
}

/**
 * How a `FileServiceClient` sends requests: the `fetch` to use and the waits
 * between attempts, whose count plus one is the most attempts a request gets.
 * Tests pass a fake `fetch` and shorter waits.
 */
export interface FileServiceClientOptions {
  fetchFn?: typeof fetch;
  retryDelaysMs?: readonly number[];
}

/**
 * Whether a failed request may succeed when sent again: no answer arrived,
 * or the answer was a 429, 502, 503 or 504.
 */
function isTransient(error: unknown): boolean {
  return error instanceof FileServiceError && (error.status === undefined || RETRY_STATUSES.has(error.status));
}

/**
 * Minimal file-service client on Node's global `fetch`. It authenticates the
 * way the job's other platform calls do: the org API key as
 * `Authorization: APIKey <key>` plus the `dana-org-id` header.
 */
export class FileServiceClient implements FileService {
  private readonly fetchFn: typeof fetch;

  private readonly retryDelaysMs: readonly number[];

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly orgId: string,
    options: FileServiceClientOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  /**
   * Build a client from the hub-client context: the file-service URL (see
   * `resolveFileServiceUrl`), the org API key and the org ID the job runs as.
   */
  static fromContext(
    context: Pick<HubClientContext, 'server' | 'apiKey' | 'orgId'>,
    options: FileServiceClientOptions & { env?: Record<string, string | undefined> } = {},
  ): FileServiceClient {
    const { env, ...clientOptions } = options;
    return new FileServiceClient(
      resolveFileServiceUrl(context.server, env),
      context.apiKey,
      context.orgId.toString(),
      clientOptions,
    );
  }

  async copyFile(request: FileServiceCopyRequest): Promise<FileServiceCopyJob> {
    return this.send('PUT', '/copyFile', request);
  }

  /**
   * Read a file's `FileView`. file-service serves it at `/files/{id}/metadata`;
   * `/files/{id}` itself only accepts PUT and DELETE.
   */
  async getFile(fileId: string): Promise<FileServiceFile> {
    return this.send('GET', `/files/${encodeURIComponent(fileId)}/metadata`);
  }

  /**
   * Read the status of a file version, or of a file's latest version:
   * file-service looks the ID up as a version first, then as a file.
   */
  async getFileStatus(versionOrFileId: string): Promise<FileServiceFileStatus> {
    return this.send('GET', `/files/${encodeURIComponent(versionOrFileId)}/status`);
  }

  /**
   * Send one JSON request and return the parsed response body. A transient
   * failure (see `isTransient`) is retried after each of `retryDelaysMs`,
   * which is safe for every call made here: the GETs only read, and
   * file-service dedupes a repeated copy by its fetcher. Any other non-2xx
   * answer rejects at once, so a 404 reaches the caller on the first attempt.
   */
  private async send(method: string, path: string, body?: object): Promise<any> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.sendOnce(method, path, body);
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined || !isTransient(error)) {
          throw error;
        }
        await sleep(delay);
      }
    }
  }

  /**
   * Make one attempt at a request, abandoned after `REQUEST_TIMEOUT_MS`. The
   * body is always read, so the connection is released even when it is not
   * needed.
   */
  private async sendOnce(method: string, path: string, body?: object): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `APIKey ${this.apiKey}`,
      'dana-org-id': this.orgId,
      Accept: 'application/json',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    let response: Response;
    let text: string;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      throw new FileServiceError(`file-service ${method} ${path} failed: ${(error as Error).message}`);
    }
    if (!response.ok) {
      throw new FileServiceError(
        `file-service ${method} ${path} returned ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
        response.status,
      );
    }
    return text ? JSON.parse(text) : undefined;
  }
}
