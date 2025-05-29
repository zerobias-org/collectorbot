/* eslint-disable */
import { TestUtils } from '@auditmation/hub-client';
import { URL } from '@auditmation/types-core-js';
import 'reflect-metadata';
import { container } from '../../generated';
import { Parameters } from '../../generated/model';

describe('CollectorAuditmationGenericTlsIT', function () {
  let client;
  it('Should run the collector', async () => {
    try {
      client = await TestUtils.getClient(container);
      await client.run(new Parameters([
        new URL('https://github.com'),
        new URL('https://google.com'),
      ]));
    } catch (e) {
      console.log(e);
    }
  });
});
