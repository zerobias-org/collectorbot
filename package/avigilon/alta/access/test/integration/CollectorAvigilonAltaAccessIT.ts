/* eslint-disable */
import { TestUtils } from '@auditmation/hub-client';
import 'reflect-metadata';
import { container } from '../../generated';

describe('CollectorAvigilonAltaAccessIT', function () {
  let client;
  it('Should run the collector', async () => {
    try {
      client = await TestUtils.getClient(container);
      await client.run();
    } catch (e) {
      console.log(e);
    }
  });
});
