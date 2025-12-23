import 'reflect-metadata';

import { TestUtils } from '@auditmation/hub-client';
import { expect } from 'chai';
import { container } from '../../generated';

describe('CollectorZerobiasZerobiasDynamicIT', function () {
  let client;

  it('Should collect data from ZeroBias Data Producer Interface', async () => {
    client = await TestUtils.getClient(container);
    try {
      // Example parameters for testing
      // Replace with actual test parameters when available
      // await client.run();
    } catch (e) {
      console.log(e);
    }
    expect(client).to.not.be.null;
  });
});
