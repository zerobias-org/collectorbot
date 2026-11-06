import type { Certificate } from '@zerobias-org/hub-sdk-nist-cmvp/model';
import { CmvpCertificate } from './SchemaTypes.js';

/**
 * Module's Certificate and schema's CmvpCertificate were deliberately kept
 * field-aligned across Phases 1/2 (same enum value sets, confirmed against
 * live data) — this is a near-1:1 passthrough, not a translation layer.
 * String() on enum-typed fields is safe whether the runtime value is a
 * plain string or an enum object with toString()/valueOf().
 */
export function toCmvpCertificate(cert: Certificate): CmvpCertificate {
  return {
    id: cert.certificateNumber,
    name: cert.moduleName,
    certificateNumber: cert.certificateNumber,
    moduleName: cert.moduleName,
    standard: String(cert.standard),
    status: String(cert.status),
    sunsetDate: cert.sunsetDate?.toISOString().split('T')[0],
    overallLevel: cert.overallLevel,
    moduleType: String(cert.moduleType),
    embodiment: cert.embodiment,
    caveatText: cert.caveatText,
    overview: cert.overview,
    securityLevelExceptions: cert.securityLevelExceptions,
    vendorName: cert.vendorName,
    vendorAddress: cert.vendorAddress,
    vendorContact: cert.vendorContact,
    validationType: cert.validationType,
    validationLab: cert.validationLab,
    validationDate: cert.validationDate?.toISOString().split('T')[0],
    securityPolicyUrl: cert.securityPolicyUrl?.toString(),
    detailUrl: cert.detailUrl.toString(),
    rawEntryHtml: cert.rawEntryHtml,
    lastAcquired: cert.lastAcquired.toISOString(),
    productId: cert.productId?.toString(),
    vendorId: cert.vendorId?.toString(),
  };
}
