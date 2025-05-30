import { newTls } from '@auditlogic/module-auditmation-generic-tls';
import { ServiceEndpoint, X509Certificate } from '@auditlogic/schema-auditmation-auditmation-base-ts';
import { ConnectionMetadata } from '@auditmation/hub-core';
import {
  UnexpectedError,
  URL,
  UUID
} from '@auditmation/types-core-js';
import { Batch } from '@auditmation/util-collector-utils/dist/src';
import { injectable } from 'inversify';

import { BaseClient } from '../generated/BaseClient';
import { Parameters } from '../generated/model';
import { toServiceEndpoint, toX509Certificate } from './Mappers';

@injectable()
export class CollectorAuditmationGenericTlsImpl extends BaseClient {
  private metadata: ConnectionMetadata | undefined;

  private _parameters?: Parameters;

  private _jobId?: UUID;

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  get parameters(): Parameters {
    if (!this._parameters) {
      throw new UnexpectedError('No Parameters were provided');
    }
    return this._parameters;
  }

  set parameters(parameters: Parameters) {
    this._parameters = parameters;
  }

  private serverApi = newTls().getServerApi();

  private classes = {
    cert: X509Certificate,
    endpoint: ServiceEndpoint,
  };

  private async init() {
    try {
      // what tags?
    } catch (err) {
      this.logger.error(`Unable to get connection metadata: ${err.message}`, err);
      throw new UnexpectedError('Unable to get metadata', err);
    }
  }

  private async initBatchForClass<T extends Record<string, any>>(
    batchItemType: new (...args) => T,
    groupId?: string
  ): Promise<Batch<T>> {
    const batch: Batch<T> = new Batch<T>(
      batchItemType.name,
      this.platform,
      this.logger,
      this.jobId,
      [],
      groupId
    );
    await batch.getId();
    return batch;
  }

  private validateParams(params?: Parameters): void {
    if (!params) {
      throw new UnexpectedError('Missing parameters');
    }

    if (!params.urls || !Array.isArray(params.urls) || params.urls.length === 0) {
      throw new UnexpectedError('Missing or empty urls parameter');
    }

    // Validate and ensure all URLs are URL instances
    const validatedUrls: URL[] = [];

    for (const urlItem of params.urls) {
      // If the url is already a URL instance, use it
      if (urlItem instanceof URL) {
        validatedUrls.push(urlItem);
        continue;
      }

      // Otherwise, try to create a new URL from it
      try {
        const urlStr = String(urlItem);
        validatedUrls.push(new URL(urlStr));
      } catch (error) {
        this.logger.error(`Invalid URL: ${String(urlItem)}`, error);
        throw new UnexpectedError(`Invalid URL provided: ${String(urlItem)}`);
      }
    }

    // Update the parameters with validated URLs
    params.urls = validatedUrls;
    this.parameters = params;
  }

  private async loadCertificates(): Promise<void> {
    const { urls } = this.parameters;
    for (const url of urls.slice(0, this.previewCount)) {
      let certSn: string | undefined;

      let certBatch: Batch<X509Certificate> | undefined;
      try {
        const certificate = await this.serverApi.getCertificateDetails(url.host);
        const mappedCert = toX509Certificate(certificate);
        certSn = mappedCert.id;
        certBatch = await this.initBatchForClass(this.classes.cert, `${certSn}`);
        await certBatch.add(mappedCert);
      } catch (error) {
        certBatch = await this.initBatchForClass(this.classes.cert);
        this.logger.error(`Error fetching certificate from ${url}: ${error.message}. ${error.stack}`);
        await certBatch.error(`Error fetching certificate from ${url}: ${error.message}. ${error.stack}`);
      }
      await certBatch?.end();

      const endpointBatch = await this.initBatchForClass(this.classes.endpoint, `${url}`);
      try {
        const config = await this.serverApi.getConfiguration(url.host, url.port ? Number(url.port) : undefined);
        await endpointBatch.add(toServiceEndpoint(url, config, certSn));
      } catch (error) {
        this.logger.error(`Error fetching server configuration from ${url}: ${error.message}. ${error.stack}`);
        await endpointBatch.error(`Error fetching server configuration from ${url}: ${error.message}. ${error.stack}`);
      }
      await endpointBatch.end();
    }
  }

  public async run(parameters?: Parameters): Promise<any> {
    this.validateParams(parameters);
    await this.init();
    await this.loadCertificates();
  }
}
