import 'reflect-metadata';

import { TestUtils } from '@auditmation/hub-client';
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { container } from '../../generated';
import { DataMappingParams, toMappingRules } from '../../src/types';
import { applyMappings } from '../../src/Mappers';

describe('CollectorZerobiasZerobiasDynamicIT', function () {
  this.timeout(60000); // Allow up to 60 seconds for integration tests

  describe('Params Validation', () => {
    it('Should load and validate params-example.json', async () => {
      const paramsPath = path.join(__dirname, '../../resoruces/params-example.json');

      // Check if the file exists
      expect(fs.existsSync(paramsPath)).to.be.true;

      // Load and parse the params
      const paramsContent = fs.readFileSync(paramsPath, 'utf-8');
      const params: DataMappingParams = JSON.parse(paramsContent);

      // Validate structure
      expect(params).to.have.property('dataMappings');
      expect(params.dataMappings).to.be.an('array');
      expect(params.dataMappings.length).to.be.greaterThan(0);

      // Validate first data mapping structure
      const firstMapping = params.dataMappings[0];
      expect(firstMapping).to.have.property('id');
      expect(firstMapping).to.have.property('source');
      expect(firstMapping).to.have.property('context');
      expect(firstMapping).to.have.property('mappings');
      expect(firstMapping).to.have.property('destination');

      // Validate source
      expect(firstMapping.source).to.have.property('objectId');
      expect(firstMapping.source).to.have.property('schema');

      // Validate destination
      expect(firstMapping.destination).to.have.property('className');
      expect(firstMapping.destination).to.have.property('classId');

      // Validate mappings array
      expect(firstMapping.mappings).to.be.an('array');
      expect(firstMapping.mappings.length).to.be.greaterThan(0);

      // Validate individual mapping rule structure
      const firstRule = firstMapping.mappings[0];
      expect(firstRule).to.have.property('id');
      expect(firstRule).to.have.property('source');
      expect(firstRule).to.have.property('transform');
      expect(firstRule).to.have.property('destination');
    });

    it('Should convert params mapping rules to DataMapper format', async () => {
      const paramsPath = path.join(__dirname, '../../resoruces/params-example.json');
      const paramsContent = fs.readFileSync(paramsPath, 'utf-8');
      const params: DataMappingParams = JSON.parse(paramsContent);

      const firstMapping = params.dataMappings[0];
      const rules = toMappingRules(firstMapping.mappings);

      // Validate converted rules
      expect(rules).to.be.an('array');
      expect(rules.length).to.equal(firstMapping.mappings.length);

      // Validate first rule structure after conversion
      const firstConverted = rules[0];
      expect(firstConverted).to.have.property('id');
      expect(firstConverted).to.have.property('source');
      expect(firstConverted).to.have.property('destination');
      expect(firstConverted).to.have.property('transform');

      // Validate source has required fields
      expect(firstConverted.source).to.have.property('key');
      expect(firstConverted.source).to.have.property('type');

      // Validate destination has required fields
      expect(firstConverted.destination).to.have.property('key');
      expect(firstConverted.destination).to.have.property('required');

      // Validate transform has type
      expect(firstConverted.transform).to.have.property('type');
    });

    it('Should apply mappings to sample data', async () => {
      const paramsPath = path.join(__dirname, '../../resoruces/params-example.json');
      const paramsContent = fs.readFileSync(paramsPath, 'utf-8');
      const params: DataMappingParams = JSON.parse(paramsContent);

      const firstMapping = params.dataMappings[0];

      // Create sample source data that matches the source schema
      const sampleData = {
        id: 12345,
        nodeId: 'PR_node_123',
        url: 'https://api.github.com/repos/test/repo/pulls/1',
        htmlUrl: 'https://github.com/test/repo/pull/1',
        diffUrl: 'https://github.com/test/repo/pull/1.diff',
        patchUrl: 'https://github.com/test/repo/pull/1.patch',
        number: 1,
        state: 'open',
        locked: false,
        title: 'Test PR',
        body: 'Test PR body',
        labels: ['bug', 'enhancement'],
        draft: false,
        head: { repo: 'test-repo', ref: 'feature-branch' },
        base: { repo: 'test-repo', ref: 'main' },
        links: { self: 'link' },
        commentsUrl: 'https://api.github.com/repos/test/repo/issues/1/comments',
        commitsUrl: 'https://api.github.com/repos/test/repo/pulls/1/commits',
        reviewCommentsUrl: 'https://api.github.com/repos/test/repo/pulls/1/comments',
        mergeCommitSha: 'abc123',
        autoMerge: null,
        assignee: null,
      };

      // Apply mappings
      const { result, errors } = await applyMappings(sampleData, firstMapping.mappings);

      // Result should be an object
      expect(result).to.be.an('object');

      // Check that some expected destination fields are present
      // Based on the mappings, 'id' should be mapped
      expect(result).to.have.property('id');

      // Log for debugging
      console.log('Mapping result:', JSON.stringify(result, null, 2));
      if (errors.length > 0) {
        console.log('Mapping errors:', errors);
      }
    });
  });

  describe('Hub Integration', function () {
    let client: any;
    const hasHubConnection = !!process.env.HUB_CONN_MODULE_AUDITMATION_INTERFACE_DATAPRODUCER;

    before(async function () {
      // Skip if Hub connection environment variables are not set
      if (!hasHubConnection) {
        this.skip();
      } else {
        client = await TestUtils.getClient(container);
      }
    });

    it('Should instantiate the client', async function () {
      if (!hasHubConnection) {
        this.skip();
      } else {
        expect(client).to.not.be.null;
      }
    });

    it('Should collect data from ZeroBias Data Producer Interface', async function () {
      if (!hasHubConnection) {
        this.skip();
      } else {
        const paramsPath = path.join(__dirname, '../../resoruces/params-example.json');
        const paramsContent = fs.readFileSync(paramsPath, 'utf-8');
        const params: DataMappingParams = JSON.parse(paramsContent);

        client.parameters = params;

        try {
          await client.run();
        } catch (e) {
          console.error('Collection error:', e);
          throw e;
        }
      }
    });
  });
});
