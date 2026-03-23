/* eslint-disable */
import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';
import { Parameters } from '../../generated/model/index.js';

/**
 * Environment variables:
 *   FHIR_SERVER_URL  — FHIR server base URL (default: https://hapi.fhir.org/baseR4)
 *   RESOURCE_TYPES   — comma-separated resource types to collect (optional, default: all)
 *   PAGE_SIZE        — resources per page (default: 10)
 *   CONCURRENCY      — parallel resource type collection (default: 2)
 *   CLIENT_ID        — OAuth2 client ID (optional)
 *   CLIENT_SECRET    — OAuth2 client secret (optional)
 *   TOKEN_URL        — OAuth2 token endpoint (optional)
 */
describe('CollectorHl7FhirIT', function () {
  this.timeout(1_200_000);

  let client;

  it('Should run the collector against FHIR server', async () => {
    try {
      client = await getClient(container);

      const resourceTypes = (process.env.RESOURCE_TYPES || '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      const params = new Parameters();
      params.fhirServerUrl = process.env.FHIR_SERVER_URL || 'https://hapi.fhir.org/baseR4';
      params.pageSize = Number(process.env.PAGE_SIZE) || 10;
      params.concurrency = Number(process.env.CONCURRENCY) || 2;

      if (resourceTypes.length > 0) {
        params.resourceTypes = resourceTypes;
      }

      if (process.env.CLIENT_ID) {
        params.clientId = process.env.CLIENT_ID;
        params.clientSecret = process.env.CLIENT_SECRET;
        params.tokenUrl = process.env.TOKEN_URL;
      }

      await client.run(params);
    } catch (e) {
      console.log(e);
    }
  });
});
