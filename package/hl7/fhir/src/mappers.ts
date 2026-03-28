import type {
  FhirPatient, FhirPractitioner, FhirOrganization, FhirAuditEvent,
  FhirConsent, FhirProvenance, FhirEncounter, FhirObservation,
  FhirCondition, FhirMedicationRequest, FhirResource,
} from './types/index.js';

// --- Shared helpers ---

const INVALID_ID_CHARS = /[^\w.-]/g;

/** Schema date type requires YYYY-MM-DD. TS types declare Date but runtime needs a string. */
function toDate(value?: string): Date | undefined {
  if (!value) return undefined;
  return value.slice(0, 10) as unknown as Date;
}

function makeId(r: FhirResource): string {
  return `${r.resourceType ?? 'Unknown'}_${r.id ?? 'unknown'}`.replaceAll(INVALID_ID_CHARS, '_');
}

function base(r: FhirResource, name: string) {
  const id = makeId(r);
  return { id, externalId: id, name, resourceType: r.resourceType, fhirId: r.id };
}

function humanName(names?: any[]): string | undefined {
  if (!names?.length) return undefined;
  const n = names[0];
  const parts = [n.prefix, n.given, n.family, n.suffix].flat().filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : n.text;
}

function coding(codeable?: Record<string, any>): string | undefined {
  if (!codeable) return undefined;
  if (codeable.text) return codeable.text;
  const c = codeable.coding?.[0];
  return c?.display ?? c?.code;
}

function reference(reference?: Record<string, any>): string | undefined {
  if (!reference?.reference) return undefined;
  return reference.reference.replaceAll(INVALID_ID_CHARS, '_');
}

// --- Resource mappers ---

export function toFhirPatient(r: FhirResource): FhirPatient {
  return {
    ...base(r, humanName(r.name) ?? `Patient/${r.id}`),
    gender: r.gender,
    birthDate: r.birthDate,
    active: r.active,
    deceasedBoolean: r.deceasedBoolean,
    maritalStatus: coding(r.maritalStatus),
    managingOrganization: reference(r.managingOrganization),
  };
}

export function toFhirPractitioner(r: FhirResource): FhirPractitioner {
  return {
    ...base(r, humanName(r.name) ?? `Practitioner/${r.id}`),
    gender: r.gender,
    birthDate: r.birthDate,
    active: r.active,
    qualification: r.qualification ? JSON.stringify(r.qualification) : undefined,
  };
}

export function toFhirOrganization(r: FhirResource): FhirOrganization {
  return {
    ...base(r, r.name ?? `Organization/${r.id}`),
    active: r.active,
    organizationType: coding(r.type?.[0]),
    partOf: reference(r.partOf),
  };
}

export function toFhirAuditEvent(r: FhirResource): FhirAuditEvent {
  const agent = r.agent?.[0];
  return {
    ...base(r, `AuditEvent/${r.id}`),
    description: coding(r.type) ?? 'FHIR AuditEvent',
    action: r.action,
    outcome: r.outcome,
    recorded: toDate(r.recorded),
    agentName: agent?.name ?? agent?.who?.display,
    agentRole: coding(agent?.role?.[0]),
    sourceObserver: r.source?.observer?.display ?? r.source?.observer?.reference,
    entityReference: r.entity?.[0]?.what?.reference,
  };
}

export function toFhirConsent(r: FhirResource): FhirConsent {
  return {
    ...base(r, `Consent/${r.id}`),
    status: r.status,
    scope: coding(r.scope),
    category: coding(r.category?.[0]),
    dateTime: toDate(r.dateTime),
    patient: reference(r.patient),
    organization: reference(r.organization?.[0]),
  };
}

export function toFhirProvenance(r: FhirResource): FhirProvenance {
  const agent = r.agent?.[0];
  return {
    ...base(r, `Provenance/${r.id}`),
    recorded: toDate(r.recorded),
    activity: coding(r.activity),
    agentType: coding(agent?.type),
    agentWho: agent?.who?.reference ?? agent?.who?.display,
    targetReference: r.target?.[0]?.reference,
  };
}

export function toFhirEncounter(r: FhirResource): FhirEncounter {
  return {
    ...base(r, `Encounter/${r.id}`),
    description: coding(r.type?.[0]) ?? 'FHIR Encounter',
    status: r.status,
    encounterClass: r.class?.code ?? r.class?.display,
    priority: coding(r.priority),
    periodStart: toDate(r.period?.start),
    periodEnd: toDate(r.period?.end),
    reasonCode: coding(r.reasonCode?.[0]),
    subject: reference(r.subject),
    serviceProvider: reference(r.serviceProvider),
  };
}

export function toFhirObservation(r: FhirResource): FhirObservation {
  return {
    ...base(r, coding(r.code) ?? `Observation/${r.id}`),
    status: r.status,
    category: coding(r.category?.[0]),
    observationCode: coding(r.code),
    effectiveDateTime: toDate(r.effectiveDateTime),
    valueString: r.valueString ?? r.valueCodeableConcept?.text ?? coding(r.valueCodeableConcept),
    valueQuantity: r.valueQuantity ? JSON.stringify(r.valueQuantity) : undefined,
    interpretation: coding(r.interpretation?.[0]),
    subject: reference(r.subject),
    encounter: reference(r.encounter),
  };
}

export function toFhirCondition(r: FhirResource): FhirCondition {
  return {
    ...base(r, coding(r.code) ?? `Condition/${r.id}`),
    clinicalStatus: coding(r.clinicalStatus),
    verificationStatus: coding(r.verificationStatus),
    category: coding(r.category?.[0]),
    conditionSeverity: coding(r.severity),
    conditionCode: coding(r.code),
    onsetDateTime: toDate(r.onsetDateTime),
    abatementDateTime: toDate(r.abatementDateTime),
    subject: reference(r.subject),
    encounter: reference(r.encounter),
  };
}

export function toFhirMedicationRequest(r: FhirResource): FhirMedicationRequest {
  return {
    ...base(r, coding(r.medicationCodeableConcept) ?? `MedicationRequest/${r.id}`),
    status: r.status,
    intent: r.intent,
    priority: r.priority,
    medicationCode: coding(r.medicationCodeableConcept),
    authoredOn: toDate(r.authoredOn),
    dosageInstruction: r.dosageInstruction ? JSON.stringify(r.dosageInstruction) : undefined,
    subject: reference(r.subject),
    encounter: reference(r.encounter),
    requester: reference(r.requester),
  };
}

// --- Registry ---

type MapperFunction = (r: FhirResource) => any;

export const RESOURCE_MAPPERS: Record<string, { schemaName: string; mapper: MapperFunction }> = {
  Patient:             { schemaName: 'FhirPatient',             mapper: toFhirPatient },
  Practitioner:        { schemaName: 'FhirPractitioner',        mapper: toFhirPractitioner },
  Organization:        { schemaName: 'FhirOrganization',        mapper: toFhirOrganization },
  AuditEvent:          { schemaName: 'FhirAuditEvent',          mapper: toFhirAuditEvent },
  Consent:             { schemaName: 'FhirConsent',             mapper: toFhirConsent },
  Provenance:          { schemaName: 'FhirProvenance',          mapper: toFhirProvenance },
  Encounter:           { schemaName: 'FhirEncounter',           mapper: toFhirEncounter },
  Observation:         { schemaName: 'FhirObservation',         mapper: toFhirObservation },
  Condition:           { schemaName: 'FhirCondition',           mapper: toFhirCondition },
  MedicationRequest:   { schemaName: 'FhirMedicationRequest',   mapper: toFhirMedicationRequest },
};
