import { expect } from 'chai';
import { URL, UUID } from '@zerobias-org/types-core-js';
import { FileSourceClient, fileServiceUrl } from '../../src/FileSourceReader.js';

const ORG_ID = '9d3f7e21-5a4b-4c6d-8e9f-0a1b2c3d4e5f';
const FILE_ID = '0e7c2a14-9b3d-4f6a-8c21-5d4e3f2a1b01';

interface FetchCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

/** A `fetch` fake that records each request and answers with the queued responses in order. */
function fakeFetch(...responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: any) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { status: 200 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function newClient(fn: typeof fetch): FileSourceClient {
  return FileSourceClient.fromContext(
    { server: new URL('https://app.example.com/api/hub'), apiKey: 'test-api-key', orgId: new UUID(ORG_ID) },
    fn,
  );
}

describe('FileSourceClient', () => {
  it('derives the file-service URL from the hub server URL', () => {
    expect(fileServiceUrl(new URL('https://app.example.com/api/hub'))).to.equal('https://app.example.com/api/file-service');
    expect(fileServiceUrl('https://app.example.com/api/hub/')).to.equal('https://app.example.com/api/file-service');
  });

  it('reads a file view from /files/{id}/metadata, authenticated as the org API key', async () => {
    const view = { id: FILE_ID, fileVersionId: 'v-1', name: 'floorplan.xlsx', size: 2048 };
    const { fn, calls } = fakeFetch({ status: 200, body: view });

    expect(await newClient(fn).getFile(FILE_ID)).to.deep.equal(view);
    expect(calls[0].url).to.equal(`https://app.example.com/api/file-service/files/${FILE_ID}/metadata`);
    expect(calls[0].init.method).to.equal('GET');
    expect(calls[0].init.headers).to.include({ Authorization: 'APIKey test-api-key', 'dana-org-id': ORG_ID });
  });

  it('reads a page of container records, with the total from the count header', async () => {
    const rows = [{ id: 'space-1', name: 'Room 1' }];
    const { fn, calls } = fakeFetch({ status: 200, body: rows, headers: { count: '150' } });

    const page = await newClient(fn).listContainerRecords('v-1', '/Physical Space', 2, 100);

    expect(page).to.deep.equal({ items: rows, count: 150 });
    expect(calls[0].url).to.equal(
      'https://app.example.com/api/file-service/files/v-1/content/containers/records' +
      '?containerPath=%2FPhysical+Space&pageNumber=2&pageSize=100',
    );
  });

  it('reports an unknown total as -1', async () => {
    const { fn } = fakeFetch({ status: 200, body: [] });

    expect(await newClient(fn).listContainerRecords('v-1', '/', 1, 100)).to.deep.equal({ items: [], count: -1 });
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
