import { setTimeout as sleep } from 'node:timers/promises';
import type { HubClientContext } from '@zerobias-com/hub-client';

/** How long one attempt at a file-service request may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The waits between attempts at a file-service request: up to four attempts, 0.5 s, 1 s and 2 s apart. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

/**
 * The least time an attempt must have before its call's deadline to be started. With less left, the request is not
 * sent, or not retried, since it could only be cut off.
 */
export const MIN_ATTEMPT_MS = 1_000;

/**
 * Statuses after which the same request may succeed on another attempt. A 409 (Hub refused a copy) and a 404 (no
 * such file, or no such object on the Hub target) are answers, not outages, so they are never retried.
 */
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

/**
 * The fields of a file-service `FileView` the collector reads. Values are
 * kept exactly as file-service returns them. A file with no ready version has
 * a null `fileVersionId` and a null `size`.
 */
export interface FileServiceFile {
  id?: string | null;
  name?: string | null;
  fileVersionId?: string | null;
  size?: number | null;
  mimeType?: string | null;
  created?: string | null;
  updated?: string | null;
}

/**
 * The fields of a file-reader `Container` the collector reads: a workbook
 * sheet, a CSV, or a JSON or YAML path. `records` is how many records it
 * holds, counted as the records endpoint counts them.
 */
export interface FileServiceContainer {
  path?: string | null;
  records?: number | null;
  subcontainers?: number | null;
}

/**
 * One page of a container's records. `count` is file-service's `count`
 * header, the container's total, or -1 when it sent none, as it does for an
 * empty container. A file-service that ignores `pageNumber` and `pageSize`
 * there (2.0.18 does) sends the length of the page it returned instead.
 */
export interface FileServiceRecordsPage {
  items: Record<string, unknown>[];
  count: number;
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
 * How long a file-service call may take: `deadline` is the epoch time in ms by
 * which the call, its retries included, must be done. Without one, a call
 * gets all its attempts.
 */
export interface FileServiceCallOptions {
  deadline?: number;
}

/**
 * The file-service calls the collector makes, for pipeline files and for
 * mappings whose source is an uploaded file. The collector depends on this
 * interface rather than on `FileServiceClient` so tests can substitute a fake.
 */
export interface FileService {
  copyFile(request: FileServiceCopyRequest, options?: FileServiceCallOptions): Promise<FileServiceCopyJob>;
  getFile(fileId: string, options?: FileServiceCallOptions): Promise<FileServiceFile>;
  getFileStatus(versionOrFileId: string, options?: FileServiceCallOptions): Promise<FileServiceFileStatus>;
  getContainer(versionId: string, containerPath: string, options?: FileServiceCallOptions): Promise<FileServiceContainer>;
  listContainerRecords(
    versionId: string,
    containerPath: string,
    pageNumber: number,
    pageSize: number,
    options?: FileServiceCallOptions,
  ): Promise<FileServiceRecordsPage>;
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
 * How a `FileServiceClient` sends requests: the `fetch` to use, the waits
 * between attempts, whose count plus one is the most attempts a request gets,
 * and the least time before a deadline an attempt needs to be started (see
 * `MIN_ATTEMPT_MS`). Tests pass a fake `fetch` and shorter times.
 */
export interface FileServiceClientOptions {
  fetchFn?: typeof fetch;
  retryDelaysMs?: readonly number[];
  minAttemptMs?: number;
}

/**
 * Whether a failed request may succeed when sent again: no answer arrived,
 * or the answer was a 429, 502, 503 or 504.
 */
function isTransient(error: unknown): boolean {
  return error instanceof FileServiceError && (error.status === undefined || RETRY_STATUSES.has(error.status));
}

/** A file-service answer: its parsed JSON body, if it had one, and its headers. */
interface FileServiceResponse {
  body: any;
  headers: Headers;
}

/**
 * The record total in a records page's `count` header, or -1 when the header
 * is missing or is not a whole number.
 */
function recordCount(header: string | null): number {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header) : -1;
}

/**
 * Minimal file-service client on Node's global `fetch`, for pipeline files
 * and file-backed mappings. It authenticates the way the job's other
 * platform calls do: the org API key as `Authorization: APIKey <key>` plus
 * the `dana-org-id` header.
 */
export class FileServiceClient implements FileService {
  private readonly fetchFn: typeof fetch;

  private readonly retryDelaysMs: readonly number[];

  private readonly minAttemptMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly orgId: string,
    options: FileServiceClientOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    this.minAttemptMs = options.minAttemptMs ?? MIN_ATTEMPT_MS;
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

  /**
   * Copy a Hub object over a file-service file (see `FileServiceCopyRequest`).
   * file-service answers 409 when Hub refused the copy and 404 when the object
   * is not on the target; neither is retried.
   */
  async copyFile(request: FileServiceCopyRequest, options: FileServiceCallOptions = {}): Promise<FileServiceCopyJob> {
    return (await this.send('PUT', '/copyFile', request, options.deadline)).body;
  }

  /**
   * Read a file's `FileView`. file-service serves it at `/files/{id}/metadata`;
   * `/files/{id}` itself only accepts PUT and DELETE.
   */
  async getFile(fileId: string, options: FileServiceCallOptions = {}): Promise<FileServiceFile> {
    return (await this.send('GET', `/files/${encodeURIComponent(fileId)}/metadata`, undefined, options.deadline)).body;
  }

  /**
   * Read the status of a file version, or of a file's latest version:
   * file-service looks the ID up as a version first, then as a file.
   */
  async getFileStatus(versionOrFileId: string, options: FileServiceCallOptions = {}): Promise<FileServiceFileStatus> {
    return (await this.send('GET', `/files/${encodeURIComponent(versionOrFileId)}/status`, undefined, options.deadline)).body;
  }

  /**
   * Read the container at `containerPath` of one file version
   * (`GET /files/{id}/content/container`): a workbook sheet such as `/Sheet1`,
   * or `/` for a CSV. Its `records` is how many records it holds.
   */
  async getContainer(versionId: string, containerPath: string, options: FileServiceCallOptions = {}): Promise<FileServiceContainer> {
    const query = new URLSearchParams({ containerPath });
    return (await this.send('GET', `/files/${encodeURIComponent(versionId)}/content/container?${query}`, undefined, options.deadline)).body;
  }

  /**
   * Read one page of the records of the container at `containerPath` of one
   * file version (`GET /files/{id}/content/containers/records`). The body is
   * the page's rows and the `count` header the total (see
   * `FileServiceRecordsPage`); a body that is not a list rejects.
   */
  async listContainerRecords(
    versionId: string,
    containerPath: string,
    pageNumber: number,
    pageSize: number,
    options: FileServiceCallOptions = {},
  ): Promise<FileServiceRecordsPage> {
    const query = new URLSearchParams({ containerPath, pageNumber: String(pageNumber), pageSize: String(pageSize) });
    const path = `/files/${encodeURIComponent(versionId)}/content/containers/records?${query}`;
    const { body, headers } = await this.send('GET', path, undefined, options.deadline);
    if (!Array.isArray(body)) {
      throw new FileServiceError(`file-service GET ${path} did not return a list of records`);
    }
    return { items: body, count: recordCount(headers.get('count')) };
  }

  /**
   * Send one JSON request and return the parsed response body with the
   * response headers. A transient failure (see `isTransient`) is retried
   * after each of `retryDelaysMs`, which is safe for every call made here:
   * the GETs only read, and file-service dedupes a repeated copy by its
   * fetcher. Any other non-2xx answer rejects at once, so a 404 or a 409
   * reaches the caller on the first attempt.
   *
   * A `deadline` bounds the whole call: each attempt is abandoned at it, and
   * neither an attempt nor the wait before a retry is started unless at least
   * `minAttemptMs` would be left before it. A request refused that way rejects
   * with a `FileServiceError` that has no status.
   */
  private async send(method: string, path: string, body?: object, deadline = Number.POSITIVE_INFINITY): Promise<FileServiceResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const timeLeftMs = deadline - Date.now();
      if (timeLeftMs < this.minAttemptMs) {
        throw new FileServiceError(`file-service ${method} ${path} was not sent: too little time is left before its deadline`);
      }
      try {
        return await this.sendOnce(method, path, body, Math.min(REQUEST_TIMEOUT_MS, timeLeftMs));
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined || !isTransient(error) || deadline - Date.now() - delay < this.minAttemptMs) {
          throw error;
        }
        await sleep(delay);
      }
    }
  }

  /**
   * Make one attempt at a request, abandoned after `timeoutMs`. The body is
   * always read, so the connection is released even when it is not needed.
   */
  private async sendOnce(method: string, path: string, body: object | undefined, timeoutMs: number): Promise<FileServiceResponse> {
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
        signal: AbortSignal.timeout(timeoutMs),
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
    return { body: text ? JSON.parse(text) : undefined, headers: response.headers };
  }
}
