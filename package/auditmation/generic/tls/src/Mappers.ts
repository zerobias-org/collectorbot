import { ServerConfiguration, X509Certificate } from '@auditlogic/module-auditmation-generic-tls';
import { ServiceEndpoint, X509Certificate as X509CertificateSchema } from '@auditlogic/schema-auditmation-auditmation-base-ts';
import { InvalidInputError, URL } from '@auditmation/types-core-js';

export function toX509Certificate(cert: X509Certificate): X509CertificateSchema {
  const aliases: string[] = [];
  if (cert.subject?.cn) {
    aliases.push(cert.subject.cn);
  }

  if (cert.subjectAltName) {
    aliases.push(...cert.subjectAltName.split(',').map((a) => a.trim().replace(/^DNS:/, '')));
  }

  const output: X509CertificateSchema = {
    id: `${cert.serialNumber}`,
    name: `${cert.subject?.cn}`,
    aliases,
    issuer: cert.issuer,
    certificate: cert,
  };

  Object.assign(
    output,
    {
      validFrom: new Date(`${cert.validFrom?.toISOString().split('T')[0]}`),
      validTo: new Date(`${cert.validTo?.toISOString().split('T')[0]}`),
    }
  );

  return output;
}

function toSslEnum(sslVersion: string): string {
  switch (sslVersion) {
    case 'sslv2':
      return 'SSL_2';
    case 'sslv3':
      return 'SSL_3';
    default:
      throw new InvalidInputError('SSL version', sslVersion);
  }
}

function toTlsEnum(tlsVersion: string): string {
  switch (tlsVersion) {
    case 'tls1_0':
      return 'TLS_1_0';
    case 'tls1_1':
      return 'TLS_1_1';
    case 'tls1_2':
      return 'TLS_1_2';
    case 'tls1_3':
      return 'TLS_1_3';
    default:
      throw new InvalidInputError('TLS version', tlsVersion);
  }
}

export function toServiceEndpoint(url: URL, config: ServerConfiguration, certSn?: string): ServiceEndpoint {
  const tlsVersions = config.protocols
    ?.map((p) => p.toString())
    .filter((p) => p.startsWith('tls'))
    .map(toTlsEnum);
  const sslVersions = config.protocols
    ?.map((p) => p.toString())
    .filter((p) => p.startsWith('ssl'))
    .map(toSslEnum);
  const cipherSuites = config.cipherSuites
    ?.map((cs) => cs.description?.toString().toUpperCase());

  const output: ServiceEndpoint = {
    id: `${url}`,
    name: `${url}`,
  };

  Object.assign(
    output,
    {
      tlsCertificate: certSn,
      tlsVersions,
      sslVersions,
      cipherSuites,
    }
  );

  return output;
}
