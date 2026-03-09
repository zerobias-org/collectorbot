/* eslint-disable */
import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';
import { Parameters } from '../../generated/model/index.js';

/**
 * Environment variables:
 *   SOURCES         — comma-separated extra "owner/repo" to add on top of defaults (optional)
 *   SERVER_LIMIT    — max servers to process, 0 = unlimited (default: 0)
 *   CONCURRENCY     — parallel source processing (default: 5)
 *   COLLECT_TOOLS   — whether to collect tools (default: true)
 */
describe('CollectorZerbiasMcpserversIT', function () {
  this.timeout(1_200_000);

  let client;

  it('Should run the collector', async () => {
    try {
      client = await getClient(container);

      const extraSources = (process.env.SOURCES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const params = new Parameters(
        extraSources.length > 0 ? extraSources : undefined,
        Number(process.env.SERVER_LIMIT) || 0,
        Number(process.env.CONCURRENCY) || 5,
        process.env.COLLECT_TOOLS !== 'false',
      );

      await client.run(params);
    } catch (e) {
      console.log(e);
    }
  });
});
