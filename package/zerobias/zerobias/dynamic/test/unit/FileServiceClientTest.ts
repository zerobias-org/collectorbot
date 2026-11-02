import { expect } from 'chai';
import { URL, UUID } from '@zerobias-org/types-core-js';
import { FileServiceClient, fileServiceUrl } from '../../src/FileServiceClient.js';

const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';
const FILE_ID = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b01';

interface FetchCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** A `fetch` fake that records each request and answers with the queued responses in order. */
function fakeFetch(...responses: { status: number; body?: unknown }[]) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function newClient(fn: typeof fetch): FileServiceClient {
  return FileServiceClient.fromContext(
    { server: new URL('https://app.example.com/api/hub'), apiKey: 'test-api-key', orgId: new UUID(ORG_ID) },
    fn,
  );
}

describe('FileServiceClient', () => {
  it('derives the file-service URL from the hub server URL', () => {
    expect(fileServiceUrl(new URL('https://app.example.com/api/hub'))).to.equal('https://app.example.com/api/file-service');
    expect(fileServiceUrl('https://app.example.com/api/hub/')).to.equal('https://app.example.com/api/file-service');
  });

  it('copies a file with PUT /copyFile, authenticated as the org API key', async () => {
    const { fn, calls } = fakeFetch({ status: 202, body: { transactionId: 'tx' } });
    const request = { sourceTarget: 'target-1', sourcePath: 'content_acme/a.csv', destinationPath: '/pipelines/a.csv' };

    await newClient(fn).copyFile(request);

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

  it('reads a file status from /files/{id}/status', async () => {
    const { fn, calls } = fakeFetch({ status: 200, body: { fileId: FILE_ID, fileVersionId: 'v-1', status: 'ready' } });

    const result = await newClient(fn).getFileStatus(FILE_ID);

    expect(result).to.include({ status: 'ready', fileVersionId: 'v-1' });
    expect(calls[0].url).to.equal(`https://app.example.com/api/file-service/files/${FILE_ID}/status`);
  });

  it('rejects on a non-2xx response', async () => {
    const { fn } = fakeFetch({ status: 404, body: { message: 'No such file' } });

    let failure: Error | undefined;
    try {
      await newClient(fn).getFile(FILE_ID);
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).to.contain('returned 404');
  });
});
