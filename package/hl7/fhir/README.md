# HL7 FHIR Collector Bot

Collects FHIR R4 resources from any FHIR-compliant API endpoint into AuditgraphDB. Supports standard SMART on FHIR OAuth2 authentication and bulk data collection.

## Supported Resource Types (v1)

| Category | Resources |
|----------|-----------|
| Clinical | Patient, Condition, Observation |
| Medications | MedicationRequest |
| Encounters | Encounter |
| Organizations | Organization, Practitioner |
| Security | AuditEvent, Consent, Provenance |

## Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `fhirServerUrl` | Yes | — | FHIR R4 server base URL |
| `clientId` | No | — | OAuth2 client ID (SMART on FHIR) |
| `clientSecret` | No | — | OAuth2 client secret |
| `tokenUrl` | No | — | OAuth2 token endpoint |
| `scopes` | No | — | OAuth2 scopes (space-delimited) |
| `resourceTypes` | No | all | Filter which types to collect |
| `pageSize` | No | 1000 | Resources per page |
| `concurrency` | No | 5 | Parallel resource type collection |

## Performance

Tested against HAPI FHIR public server (https://hapi.fhir.org/baseR4):
- 11,901 resources in 39s (305 items/s) with pageSize=1000
- 30s request timeout per call
- 500 page max safety limit per resource type

## Future: Expanding Resource Coverage

The current v1 covers 10 core resource types focused on compliance-relevant data (security audit trail, patient access, clinical records). The FHIR R4 spec defines 140+ resource types. The following categories should be added in future iterations:

**Priority 1 — Clinical completeness:**
- Procedure, AllergyIntolerance, FamilyMemberHistory, ClinicalImpression, DiagnosticReport

**Priority 2 — Medications & Care:**
- Medication, MedicationAdministration, MedicationDispense, MedicationStatement, Immunization
- CarePlan, CareTeam, Goal, ServiceRequest, NutritionOrder

**Priority 3 — Administrative:**
- Appointment, AppointmentResponse, EpisodeOfCare
- PractitionerRole, Location, HealthcareService, Endpoint

**Priority 4 — Financial:**
- Claim, ClaimResponse, Coverage, ExplanationOfBenefit, Account, Invoice

**Priority 5 — Diagnostics & Documents:**
- ImagingStudy, Specimen, BodyStructure
- DocumentReference, DocumentManifest, Composition

**Priority 6 — Devices:**
- Device, DeviceMetric, DeviceUseStatement

**Architecture note:** Adding new resource types requires:
1. Add class YAML to `org/schema/package/hl7/fhir/classes/` (extend Element)
2. Add mapper function to `src/mappers.ts`
3. Add to `RESOURCE_MAPPERS` and `SUPPORTED_RESOURCE_TYPES`
4. Add to `collector.yml`

**Scaling approach:** Consider a generic/configurable mapper — most FHIR resources share common patterns (status, code, subject, encounter references) that could be driven by a resource definition table rather than individual mapper functions. This would allow adding new types via config instead of code.

**Test server:** The HAPI FHIR public server at `https://hapi.fhir.org/baseR4` supports all ~150 R4 resource types with full CRUD — any type can be queried at `https://hapi.fhir.org/baseR4/{ResourceType}?_format=json`. No auth required.
