import type {
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
  SupportedResourceType,
} from './types/index.js';

const INVALID_ID_CHARS = /[^a-zA-Z0-9._-]/g;

/**
 * Schema `date` type validates against YYYY-MM-DD pattern.
 * TS schema types declare Date but runtime serialization expects a date-only string.
 */
function toDateOnly(value?: string): Date | undefined {
  if (!value) return undefined;
  return value.substring(0, 10) as unknown as Date;
}

function fhirId(resource: Record<string, any>): string {
  const rt = resource.resourceType ?? 'Unknown';
  const id = resource.id ?? 'unknown';
  return `${rt}/${id}`.replaceAll(INVALID_ID_CHARS, '_');
}

function humanName(nameArray?: any[]): string | undefined {
  if (!nameArray?.length) return undefined;
  const n = nameArray[0];
  const parts = [n.prefix, n.given, n.family, n.suffix]
    .flat()
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : n.text;
}

function codingDisplay(codeable?: Record<string, any>): string | undefined {
  if (!codeable) return undefined;
  if (codeable.text) return codeable.text;
  const coding = codeable.coding?.[0];
  return coding?.display ?? coding?.code;
}

function referenceId(ref?: Record<string, any>): string | undefined {
  if (!ref?.reference) return undefined;
  return ref.reference.replaceAll(INVALID_ID_CHARS, '_');
}

export function toFhirPatient(r: Record<string, any>): FhirPatient {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: humanName(r.name) ?? `Patient/${r.id}`,
    description: `FHIR Patient resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    gender: r.gender,
    birthDate: r.birthDate,
    active: r.active,
    deceasedBoolean: r.deceasedBoolean,
    maritalStatus: codingDisplay(r.maritalStatus),
    managingOrganization: referenceId(r.managingOrganization),
  };
}

export function toFhirPractitioner(r: Record<string, any>): FhirPractitioner {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: humanName(r.name) ?? `Practitioner/${r.id}`,
    description: `FHIR Practitioner resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    gender: r.gender,
    birthDate: r.birthDate,
    active: r.active,
    qualification: r.qualification ? JSON.stringify(r.qualification) : undefined,
  };
}

export function toFhirOrganization(r: Record<string, any>): FhirOrganization {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: r.name ?? `Organization/${r.id}`,
    description: `FHIR Organization resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    active: r.active,
    organizationType: codingDisplay(r.type?.[0]),
    partOf: referenceId(r.partOf),
  };
}

export function toFhirAuditEvent(r: Record<string, any>): FhirAuditEvent {
  const id = fhirId(r);
  const agent = r.agent?.[0];
  return {
    id,
    externalId: id,
    name: `AuditEvent/${r.id}`,
    description: codingDisplay(r.type) ?? 'FHIR AuditEvent resource',
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    action: r.action,
    outcome: r.outcome,
    recorded: toDateOnly(r.recorded),
    agentName: agent?.name ?? agent?.who?.display,
    agentRole: codingDisplay(agent?.role?.[0]),
    sourceObserver: r.source?.observer?.display ?? r.source?.observer?.reference,
    entityReference: r.entity?.[0]?.what?.reference,
  };
}

export function toFhirConsent(r: Record<string, any>): FhirConsent {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: `Consent/${r.id}`,
    description: `FHIR Consent resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    status: r.status,
    scope: codingDisplay(r.scope),
    category: codingDisplay(r.category?.[0]),
    dateTime: toDateOnly(r.dateTime),
    patient: referenceId(r.patient),
    organization: referenceId(r.organization?.[0]),
  };
}

export function toFhirProvenance(r: Record<string, any>): FhirProvenance {
  const id = fhirId(r);
  const agent = r.agent?.[0];
  return {
    id,
    externalId: id,
    name: `Provenance/${r.id}`,
    description: `FHIR Provenance resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    recorded: toDateOnly(r.recorded),
    activity: codingDisplay(r.activity),
    agentType: codingDisplay(agent?.type),
    agentWho: agent?.who?.reference ?? agent?.who?.display,
    targetReference: r.target?.[0]?.reference,
  };
}

export function toFhirEncounter(r: Record<string, any>): FhirEncounter {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: `Encounter/${r.id}`,
    description: codingDisplay(r.type?.[0]) ?? 'FHIR Encounter resource',
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    status: r.status,
    encounterClass: r.class?.code ?? r.class?.display,
    priority: codingDisplay(r.priority),
    periodStart: toDateOnly(r.period?.start),
    periodEnd: toDateOnly(r.period?.end),
    reasonCode: codingDisplay(r.reasonCode?.[0]),
    subject: referenceId(r.subject),
    serviceProvider: referenceId(r.serviceProvider),
  };
}

export function toFhirObservation(r: Record<string, any>): FhirObservation {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: codingDisplay(r.code) ?? `Observation/${r.id}`,
    description: `FHIR Observation resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    status: r.status,
    category: codingDisplay(r.category?.[0]),
    observationCode: codingDisplay(r.code),
    effectiveDateTime: toDateOnly(r.effectiveDateTime),
    valueString: r.valueString ?? r.valueCodeableConcept?.text ?? codingDisplay(r.valueCodeableConcept),
    valueQuantity: r.valueQuantity ? JSON.stringify(r.valueQuantity) : undefined,
    interpretation: codingDisplay(r.interpretation?.[0]),
    subject: referenceId(r.subject),
    encounter: referenceId(r.encounter),
  };
}

export function toFhirCondition(r: Record<string, any>): FhirCondition {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: codingDisplay(r.code) ?? `Condition/${r.id}`,
    description: `FHIR Condition resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    clinicalStatus: codingDisplay(r.clinicalStatus),
    verificationStatus: codingDisplay(r.verificationStatus),
    category: codingDisplay(r.category?.[0]),
    conditionSeverity: codingDisplay(r.severity),
    conditionCode: codingDisplay(r.code),
    onsetDateTime: toDateOnly(r.onsetDateTime),
    abatementDateTime: toDateOnly(r.abatementDateTime),
    subject: referenceId(r.subject),
    encounter: referenceId(r.encounter),
  };
}

export function toFhirMedicationRequest(r: Record<string, any>): FhirMedicationRequest {
  const id = fhirId(r);
  return {
    id,
    externalId: id,
    name: codingDisplay(r.medicationCodeableConcept) ?? `MedicationRequest/${r.id}`,
    description: `FHIR MedicationRequest resource`,
    url: undefined,
    resourceType: r.resourceType,
    fhirId: r.id,
    status: r.status,
    intent: r.intent,
    priority: r.priority,
    medicationCode: codingDisplay(r.medicationCodeableConcept),
    authoredOn: toDateOnly(r.authoredOn),
    dosageInstruction: r.dosageInstruction ? JSON.stringify(r.dosageInstruction) : undefined,
    subject: referenceId(r.subject),
    encounter: referenceId(r.encounter),
    requester: referenceId(r.requester),
  };
}

type MapperFn = (r: Record<string, any>) => any;

export const RESOURCE_MAPPERS: Record<string, { className: string; mapper: MapperFn }> = {
  Patient: { className: 'FhirPatient', mapper: toFhirPatient },
  Practitioner: { className: 'FhirPractitioner', mapper: toFhirPractitioner },
  Organization: { className: 'FhirOrganization', mapper: toFhirOrganization },
  AuditEvent: { className: 'FhirAuditEvent', mapper: toFhirAuditEvent },
  Consent: { className: 'FhirConsent', mapper: toFhirConsent },
  Provenance: { className: 'FhirProvenance', mapper: toFhirProvenance },
  Encounter: { className: 'FhirEncounter', mapper: toFhirEncounter },
  Observation: { className: 'FhirObservation', mapper: toFhirObservation },
  Condition: { className: 'FhirCondition', mapper: toFhirCondition },
  MedicationRequest: { className: 'FhirMedicationRequest', mapper: toFhirMedicationRequest },
};
