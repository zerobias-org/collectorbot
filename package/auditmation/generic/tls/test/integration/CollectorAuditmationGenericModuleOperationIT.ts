/* eslint-disable */
import { getClient } from '@zerobias-com/hub-client';
import { URL } from '@zerobias-org/types-core-js';
import 'reflect-metadata';
import { container } from '../../generated/index.js';
import { Parameters } from '../../generated/model/index.js';

describe('CollectorAuditmationGenericTlsIT', function () {
  let client;
  it('Should run the collector', async () => {
    try {
      client = await getClient(container);
      await client.run(new Parameters([
        new URL('https://github.com'),
        new URL('https://google.com'),
      ]));
    } catch (e) {
      console.log(e);
    }
  });
});
