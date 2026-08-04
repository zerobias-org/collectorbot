import 'reflect-metadata';

import { getClient } from '@zerobias-com/hub-client';
import { expect } from 'chai';
import { container } from '../../generated/index.js';
import { Parameters } from '../../generated/model/index.js';

describe('CollectorMicrosoftAzureResourceGraphIT', function () {
  this.timeout(360_000);

  before(function () {
    // Only run when explicitly opted in via RUN_E2E=true (e.g. source .envrc)
    if (process.env.RUN_E2E !== 'true') {
      this.skip();
    }
  });

  it('Should collect Azure Resource Graph inventory', async () => {
    const client = await getClient(container as any);
    expect(client).to.not.be.null;

    await (client as any).run(new Parameters());
  });
});
