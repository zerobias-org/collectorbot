import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';

describe('CollectorNistCmvpIT', function () {
  this.timeout(1_200_000);

  let client;

  it('Should run the collector against the live CMVP registry', async () => {
    try {
      client = await getClient(container);
      await client.run();
    } catch (e) {
      console.log(e);
    }
  });
});
