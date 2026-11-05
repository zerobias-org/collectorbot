import { expect } from 'chai';
import { URL, UUID } from '@zerobias-org/types-core-js';
import {
  FileServiceClient,
  FileServiceClientOptions,
  FileServiceError,
  MIN_ATTEMPT_MS,
  RETRY_DELAYS_MS,
  fileServiceUrl,
  isFileNotFound,
  resolveFileServiceUrl,
} from '../../src/FileServiceClient.js';

const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';
const FILE_ID = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b01';
const VERSION_ID = '5b2e8d14-3c7a-4f9e-a1b6-0d4c3e2f1a09';

interface FetchCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** A queued answer: a response with this status, JSON body and headers, or a rejection with `error` as no response would. */
type FakeAnswer = { status: number; body?: unknown; headers?: Record<string, string> } | { error: Error };

/** A `fetch` fake that records each request and answers with the queued answers in order, then 200s. */
function fakeFetch(...answers: FakeAnswer[]) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    const next = answers.shift() ?? { status: 200 };
    if ('error' in next) {
      throw next.error;
    }
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/**
 * A `fetch` fake that never answers: each request hangs until its signal aborts it, as against a file-service that
 * accepts connections but stops responding.
 */
function hangingFetch() {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** A client on the hub server URL, with no `FILE_SERVICE_API` and, unless `options` says otherwise, no waits between attempts. */
function newClient(fn: typeof fetch, options: FileServiceClientOptions = {}): FileServiceClient {
  return FileServiceClient.fromContext(
    { server: new URL('https://app.example.com/api/hub'), apiKey: 'test-api-key', orgId: new UUID(ORG_ID) },
    { fetchFn: fn, retryDelaysMs: [0, 0, 0], env: {}, ...options },
  );
}

/** The error `promise` rejects with, or undefined when it resolves. */
async function failureOf(promise: Promise<unknown>): Promise<Error | undefined> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  return undefined;
}

describe('FileServiceClient', () => {
  describe('base URL', () => {
    it('derives the file-service URL from the hub server URL', () => {
      expect(fileServiceUrl(new URL('https://app.example.com/api/hub'))).to.equal('https://app.example.com/api/file-service');
      expect(fileServiceUrl('https://app.example.com/api/hub/')).to.equal('https://app.example.com/api/file-service');
    });

    it('prefers FILE_SERVICE_API when it is set', () => {
      const server = new URL('https://app.example.com/api/hub');

      expect(resolveFileServiceUrl(server, { FILE_SERVICE_API: 'https://files.example.com/file-service/' }))
        .to.equal('https://files.example.com/file-service');
      expect(resolveFileServiceUrl(server, { FILE_SERVICE_API: '  ' })).to.equal('https://app.example.com/api/file-service');
      expect(resolveFileServiceUrl(server, {})).to.equal('https://app.example.com/api/file-service');
    });

    it('sends requests to FILE_SERVICE_API rather than the hub-derived URL', async () => {
      const { fn, calls } = fakeFetch({ status: 200, body: { fileVersionId: 'v-1', size: 1 } });
      const client = FileServiceClient.fromContext(
        { server: new URL('https://app.example.com/api/hub'), apiKey: 'test-api-key', orgId: new UUID(ORG_ID) },
        { fetchFn: fn, env: { FILE_SERVICE_API: 'https://slot-7.example.com/file-service' } },
      );

      await client.getFile(FILE_ID);

      expect(calls[0].url).to.equal(`https://slot-7.example.com/file-service/files/${FILE_ID}/metadata`);
    });
  });

  describe('calls', () => {
    it('copies a file with PUT /copyFile, authenticated as the org API key, and returns the copy job', async () => {
      const job = {
        transactionId: 'a8d1f0c2-7b3e-4c5d-9e6f-1a2b3c4d5e6f',
        file: { id: FILE_ID, fileVersionId: null, size: null },
        status: { fileId: FILE_ID, fileVersionId: VERSION_ID, status: 'created' },
      };
      const { fn, calls } = fakeFetch({ status: 202, body: job });
      const request = { sourceTarget: 'target-1', sourcePath: 'content_acme/a.csv', destinationPath: '/pipelines/a.csv' };

      const result = await newClient(fn).copyFile(request);

      expect(result).to.deep.equal(job);
      expect(calls).to.have.length(1);
      expect(calls[0].url).to.equal('https://app.example.com/api/file-service/copyFile');
      expect(calls[0].init.method).to.equal('PUT');
      expect(calls[0].init.headers).to.include({
        Authorization: 'APIKey test-api-key',
        'dana-org-id': ORG_ID,
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(calls[0].init.body as string)).to.deep.equal(request);
    });

    it('reads a file view from /files/{id}/metadata, keeping its value types', async () => {
      const view = { id: FILE_ID, fileVersionId: 'v-1', size: 2048, mimeType: 'application/pdf' };
      const { fn, calls } = fakeFetch({ status: 200, body: view });

      const result = await newClient(fn).getFile(FILE_ID);

      expect(result).to.deep.equal(view);
      expect(calls[0].url).to.equal(`https://app.example.com/api/file-service/files/${FILE_ID}/metadata`);
      expect(calls[0].init.method).to.equal('GET');
      expect(calls[0].init.body).to.equal(undefined);
      expect(calls[0].init.headers).to.include({ Authorization: 'APIKey test-api-key', 'dana-org-id': ORG_ID });
    });

    it('reads a version status from /files/{id}/status', async () => {
      const { fn, calls } = fakeFetch({ status: 200, body: { fileId: FILE_ID, fileVersionId: VERSION_ID, status: 'fetching' } });

      const result = await newClient(fn).getFileStatus(VERSION_ID);

      expect(result).to.include({ status: 'fetching', fileVersionId: VERSION_ID });
      expect(calls[0].url).to.equal(`https://app.example.com/api/file-service/files/${VERSION_ID}/status`);
    });
  });

  describe('container records', () => {
    it('reads a container of a version from /files/{id}/content/container, authenticated as the org API key', async () => {
      const { fn, calls } = fakeFetch({ status: 200, body: { path: '/Physical Space', records: 150, subcontainers: 0 } });

      const container = await newClient(fn).getContainer(VERSION_ID, '/Physical Space');

      expect(container).to.deep.equal({ path: '/Physical Space', records: 150, subcontainers: 0 });
      expect(calls[0].url).to.equal(
        `https://app.example.com/api/file-service/files/${VERSION_ID}/content/container?containerPath=%2FPhysical+Space`,
      );
      expect(calls[0].init.method).to.equal('GET');
      expect(calls[0].init.headers).to.include({ Authorization: 'APIKey test-api-key', 'dana-org-id': ORG_ID });
    });

    it('reads a page of container records, with the total from the count header', async () => {
      const rows = [{ id: 'space-1', name: 'Room 1' }];
      const { fn, calls } = fakeFetch({ status: 200, body: rows, headers: { count: '150', link: '' } });

      const page = await newClient(fn).listContainerRecords(VERSION_ID, '/Physical Space', 2, 100);

      expect(page).to.deep.equal({ items: rows, count: 150 });
      expect(calls[0].url).to.equal(
        `https://app.example.com/api/file-service/files/${VERSION_ID}/content/containers/records` +
        '?containerPath=%2FPhysical+Space&pageNumber=2&pageSize=100',
      );
      expect(calls[0].init.headers).to.include({ Authorization: 'APIKey test-api-key', 'dana-org-id': ORG_ID });
    });

    it('reports a missing or malformed count header as -1, as file-service omits it for an empty container', async () => {
      for (const headers of [undefined, { count: 'many' }, { count: '-3' }]) {
        const { fn } = fakeFetch({ status: 200, body: [], headers });

        expect(await newClient(fn).listContainerRecords(VERSION_ID, '/', 1, 100), JSON.stringify(headers))
          .to.deep.equal({ items: [], count: -1 });
      }
    });

    it('rejects a records answer that is not a list', async () => {
      const { fn } = fakeFetch({ status: 200, body: { items: [] } });

      const failure = await failureOf(newClient(fn).listContainerRecords(VERSION_ID, '/', 1, 100));

      expect(failure).to.be.instanceOf(FileServiceError);
      expect(failure?.message).to.contain('did not return a list of records');
    });

    it('retries a records page answered 503, and rejects a 404 at once', async () => {
      const retried = fakeFetch({ status: 503 }, { status: 200, body: [{ id: 'a' }], headers: { count: '1' } });

      expect(await newClient(retried.fn).listContainerRecords(VERSION_ID, '/', 1, 100)).to.deep.equal({ items: [{ id: 'a' }], count: 1 });
      expect(retried.calls).to.have.length(2);

      const missing = fakeFetch({ status: 404, body: { message: 'Not found: /Sheet9' } });
      const failure = await failureOf(newClient(missing.fn).getContainer(VERSION_ID, '/Sheet9'));
      expect(isFileNotFound(failure)).to.equal(true);
      expect(missing.calls).to.have.length(1);
    });
  });

  describe('failures and retries', () => {
    it('waits 0.5 s, 1 s and 2 s between attempts by default', () => {
      expect(RETRY_DELAYS_MS).to.deep.equal([500, 1000, 2000]);
    });

    it('rejects a 404 at once, as a not-found FileServiceError', async () => {
      const { fn, calls } = fakeFetch({ status: 404, body: { message: 'No such file' } });

      const failure = await failureOf(newClient(fn).getFile(FILE_ID));

      expect(failure).to.be.instanceOf(FileServiceError);
      expect((failure as FileServiceError).status).to.equal(404);
      expect(failure?.message).to.contain('returned 404');
      expect(isFileNotFound(failure)).to.equal(true);
      expect(calls).to.have.length(1);
    });

    it('rejects a 400 at once', async () => {
      const { fn, calls } = fakeFetch({ status: 400, body: { message: 'Bad id' } });

      const failure = await failureOf(newClient(fn).getFileStatus('not-a-uuid'));

      expect((failure as FileServiceError).status).to.equal(400);
      expect(isFileNotFound(failure)).to.equal(false);
      expect(calls).to.have.length(1);
    });

    it('retries a 503 and returns the answer that follows', async () => {
      const { fn, calls } = fakeFetch({ status: 503 }, { status: 200, body: { fileVersionId: 'v-1', size: 5 } });

      const result = await newClient(fn).getFile(FILE_ID);

      expect(result).to.deep.equal({ fileVersionId: 'v-1', size: 5 });
      expect(calls).to.have.length(2);
    });

    it('retries 429, 502, 504 and network errors, the copy included', async () => {
      const { fn, calls } = fakeFetch(
        { status: 429 },
        { status: 502 },
        { error: new TypeError('fetch failed') },
        { status: 202, body: { transactionId: 'tx', file: {}, status: { status: 'ready' } } },
      );

      const result = await newClient(fn).copyFile({ sourceTarget: 't', sourcePath: 'p', destinationPath: '/d' });

      expect(result.status.status).to.equal('ready');
      expect(calls.map((c) => c.init.method)).to.deep.equal(['PUT', 'PUT', 'PUT', 'PUT']);

      const timeouts = fakeFetch({ status: 504 }, { status: 200, body: { status: 'ready' } });
      await newClient(timeouts.fn).getFileStatus(VERSION_ID);
      expect(timeouts.calls).to.have.length(2);
    });

    it('gives up after four attempts with the last failure', async () => {
      const { fn, calls } = fakeFetch(
        { status: 503 },
        { error: new TypeError('fetch failed') },
        { status: 502 },
        { status: 503, body: { message: 'still down' } },
        { status: 200, body: {} },
      );

      const failure = await failureOf(newClient(fn).getFile(FILE_ID));

      expect((failure as FileServiceError).status).to.equal(503);
      expect(failure?.message).to.contain('still down');
      expect(calls).to.have.length(4);
    });

    it('reports a request with no answer as a FileServiceError with no status', async () => {
      const { fn } = fakeFetch(...Array.from({ length: 4 }, () => ({ error: new TypeError('fetch failed') })));

      const failure = await failureOf(newClient(fn).getFile(FILE_ID));

      expect(failure).to.be.instanceOf(FileServiceError);
      expect((failure as FileServiceError).status).to.equal(undefined);
      expect(failure?.message).to.contain('fetch failed');
      expect(isFileNotFound(failure)).to.equal(false);
    });
  });

  describe('copy answers', () => {
    const request = { sourceTarget: 'target-1', sourcePath: 'content_acme/a.csv', destinationPath: '/pipelines/a.csv' };

    it('rejects a copy Hub refused (409) at once', async () => {
      const { fn, calls } = fakeFetch({ status: 409, body: { message: 'Hub refused the copy' } });

      const failure = await failureOf(newClient(fn).copyFile(request));

      expect((failure as FileServiceError).status).to.equal(409);
      expect(failure?.message).to.contain('Hub refused the copy');
      expect(isFileNotFound(failure)).to.equal(false);
      expect(calls).to.have.length(1);
    });

    it('rejects a copy of an object missing from the target (404) at once', async () => {
      const { fn, calls } = fakeFetch({ status: 404, body: { message: 'No such object' } });

      const failure = await failureOf(newClient(fn).copyFile(request));

      expect((failure as FileServiceError).status).to.equal(404);
      expect(calls).to.have.length(1);
    });

    it('retries a copy answered 502 (Hub unavailable)', async () => {
      const job = { transactionId: 'tx', file: {}, status: { status: 'fetching', fileVersionId: VERSION_ID } };
      const { fn, calls } = fakeFetch({ status: 502 }, { status: 502 }, { status: 202, body: job });

      const result = await newClient(fn).copyFile(request);

      expect(result).to.deep.equal(job);
      expect(calls.map((c) => c.init.method)).to.deep.equal(['PUT', 'PUT', 'PUT']);
    });
  });

  describe('deadline', () => {
    it('needs a second left before a deadline to start an attempt, by default', () => {
      expect(MIN_ATTEMPT_MS).to.equal(1000);
    });

    it('does not send a request once its deadline leaves too little time', async () => {
      const { fn, calls } = fakeFetch({ status: 200, body: { fileVersionId: 'v-1', size: 1 } });

      const failure = await failureOf(newClient(fn).getFile(FILE_ID, { deadline: Date.now() + 500 }));

      expect(failure).to.be.instanceOf(FileServiceError);
      expect((failure as FileServiceError).status).to.equal(undefined);
      expect(failure?.message).to.contain('was not sent');
      expect(calls).to.have.length(0);
    });

    it('does not wait for a retry that the deadline leaves too little time for', async () => {
      const { fn, calls } = fakeFetch({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
      const client = newClient(fn, { retryDelaysMs: [60, 100, 100], minAttemptMs: 10 });

      const started = Date.now();
      const failure = await failureOf(client.getFileStatus(VERSION_ID, { deadline: started + 150 }));
      const elapsed = Date.now() - started;

      expect((failure as FileServiceError).status).to.equal(503);
      expect(calls).to.have.length(2);
      expect(elapsed).to.be.lessThan(150);
    });

    it('cuts a hanging attempt off at the deadline and does not retry it', async () => {
      const { fn, calls } = hangingFetch();
      const client = newClient(fn, { minAttemptMs: 10 });

      const started = Date.now();
      const failure = await failureOf(client.copyFile(
        { sourceTarget: 't', sourcePath: 'p', destinationPath: '/d' },
        { deadline: started + 80 },
      ));
      const elapsed = Date.now() - started;

      expect(failure).to.be.instanceOf(FileServiceError);
      expect((failure as FileServiceError).status).to.equal(undefined);
      expect(calls).to.have.length(1);
      expect(elapsed).to.be.within(60, 1000);
    });

    it('gives a call every attempt when no deadline is set', async () => {
      const { fn, calls } = fakeFetch({ status: 503 }, { status: 503 }, { status: 503 }, { status: 200, body: { status: 'ready' } });

      await newClient(fn, { minAttemptMs: 10 }).getFileStatus(VERSION_ID);

      expect(calls).to.have.length(4);
    });
  });
});
