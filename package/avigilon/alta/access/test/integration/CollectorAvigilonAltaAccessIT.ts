/* eslint-disable */
import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';

describe('CollectorAvigilonAltaAccessIT', function () {
  let client;
  it('Should run the collector', async () => {
    try {
      client = await getClient(container);
      await client.run();
    } catch (e) {
      console.log(e);
    }
  });
});
