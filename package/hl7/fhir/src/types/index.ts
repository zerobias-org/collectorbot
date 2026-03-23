export {
  FhirPatient,
  FhirPractitioner,
  FhirOrganization,
  FhirAuditEvent,
  FhirConsent,
  FhirProvenance,
  FhirEncounter,
  FhirObservation,
  FhirCondition,
  FhirMedicationRequest,
} from '@zerobias-org/schema-hl7-fhir-ts/dist/src/index.js';

export const SUPPORTED_RESOURCE_TYPES = [
  'Patient',
  'Practitioner',
  'Organization',
  'AuditEvent',
  'Consent',
  'Provenance',
  'Encounter',
  'Observation',
  'Condition',
  'MedicationRequest',
] as const;

export type SupportedResourceType = typeof SUPPORTED_RESOURCE_TYPES[number];

export interface FhirBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<{ resource: Record<string, any> }>;
}

export interface OAuthToken {
  access_token: string;
  token_type: string;
  expires_in?: number;
}
