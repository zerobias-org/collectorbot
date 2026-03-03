/* eslint-disable */
import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';
import { Parameters } from '../../generated/model/index.js';

/**
 * Environment variables:
 *   REPOS           — comma-separated extra "owner/repo" to add on top of discovery (optional)
 *   REPO_LIMIT      — max repos to process, 0 = unlimited (default: 0)
 *   GITHUB_TOKEN    — GitHub personal access token
 */
describe('CollectorZerobiasAgentskillsIT', function () {
  this.timeout(1_200_000);

  let client;

  it('Should run the collector', async () => {
    try {
      client = await getClient(container);

      const extraRepos = (process.env.REPOS || '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);

      const params = new Parameters(extraRepos.length > 0 ? extraRepos : undefined);
      params.githubToken = process.env.GITHUB_TOKEN;
      params.repoLimit = Number(process.env.REPO_LIMIT) || 0;

      await client.run(params);
    } catch (e) {
      console.log(e);
    }
  });
});
