import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';
import { Parameters } from '../../generated/model/index.js';

/**
 * The collector takes no parameters — the dataset ships inside the package.
 * Set the usual hub-client environment to point the run at a target graph.
 */
describe('CollectorZerobiasQualificationsIT', function () {
  this.timeout(1_200_000);

  let client;

  it('Should run the collector', async () => {
    try {
      client = await getClient(container);
      await client.run(new Parameters());
    } catch (e) {
      console.log(e);
    }
  });
});
