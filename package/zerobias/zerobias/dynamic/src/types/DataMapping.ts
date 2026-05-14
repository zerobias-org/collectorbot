/**
 * Types for DataMapping configuration
 * These types represent the input structure for dynamic data collection
 */

import { MappingRule, PipelineSavedQuery } from '@zerobias-org/data-utils';

/**
 * Schema field definition from source system
 */
export interface SchemaField {
  name: string;
  multi: boolean;
  dataType: string;
  required: boolean;
  primaryKey: boolean;
  format?: string;
  description?: string;
  references?: {
    schemaId: string;
  };
}

/**
 * Data type definition
 */
export interface DataTypeDefinition {
  name: string;
  isEnum: boolean;
  examples?: any[];
  jsonType: string;
  htmlInput: string;
  description: string;
  pattern?: string;
}

/**
 * Source schema configuration
 */
export interface SourceSchema {
  id: string;
  name: string;
  type: string;
  fields: SchemaField[];
  version: string;
  metadata: Record<string, any>;
  required: string[];
  dataTypes: DataTypeDefinition[];
  properties: SchemaField[];
  additionalProperties?: boolean;
}

/**
 * Source configuration - where data comes from.
 *
 * Two source variants:
 *  - Collection: `objectId` points at a producer collection; rows come from
 *    `getCollectionElements`. Identified by absence of both `sql` and
 *    `sourceQueryKey`.
 *  - Query: `objectId` points at a producer query function; the SQL to
 *    invoke is resolved at run time by `resolveMappingSql` from a saved
 *    query on `DataMappingParams.queries` (referenced by `sourceQueryKey`)
 *    or — for legacy mappings written before pipeline-saved-queries
 *    landed — read directly from `sql`. Schema is inferred from the
 *    result set at design time and stored on the mapping (no producer-
 *    stored schema id exists for ad-hoc query results).
 */
export interface DataMappingSource {
  schema: SourceSchema;
  objectId: string;
  objectName: string;
  objectPath: string[];
  /** Reference to an entry in `DataMappingParams.queries`. When set, the
   *  collector looks up the SQL there at run time, so one edit to a saved
   *  query propagates to every mapping that references its key. Takes
   *  precedence over `sql`. */
  sourceQueryKey?: string;
  /** Legacy inline SQL — used by mappings written before pipeline-saved-
   *  queries existed. New mappings carry `sourceQueryKey` instead.
   *  `resolveMappingSql` falls through to this field when no
   *  `sourceQueryKey` is present. */
  sql?: string;
}

/**
 * Context for the data mapping operation
 */
export interface DataMappingContext {
  scopeId: string;
  targetId: string;
  productId: string;
  boundaryId: string;
}

/**
 * Destination class property definition
 */
export interface DestinationProperty {
  id: string;
  name: string;
  type: string;
  keyed: boolean;
  multi: boolean;
  created: string;
  example?: any;
  fieldId: string;
  indexed: boolean;
  ownerId: string;
  updated: string;
  parentId: string;
  required: boolean;
  className: string;
  fieldName: string;
  dataTypeId: string;
  description: string;
  displayName: string;
  packageCode: string;
  dataTypeName: string;
  dataTypeType: string;
  defaultValue?: any;
  linkedClassInfo?: {
    id?: string;
    name?: string;
    description?: string;
    linkedFieldId?: string;
    linkedFieldName?: string;
    linkedPropertyId?: string;
    linkedPropertyName?: string;
  };
}

/**
 * Destination schema configuration
 */
export interface DestinationSchema {
  dataTypes: DataTypeDefinition[];
  properties: DestinationProperty[];
}

/**
 * Destination configuration - where data goes
 */
export interface DataMappingDestination {
  schema: DestinationSchema;
  classId: string;
  className: string;
}

/**
 * Metadata for the data mapping
 */
export interface DataMappingMetadata {
  name: string;
  createdAt: string;
  description: string;
}

/**
 * Complete data mapping configuration
 */
export interface DataMapping {
  id: string;
  source: DataMappingSource;
  context: DataMappingContext;
  mappings: MappingRule[];
  metadata: DataMappingMetadata;
  destination: DataMappingDestination;
}

/**
 * Parameters structure containing data mappings and the pipeline-level
 * saved-query registry the mappings reference by `sourceQueryKey`.
 *
 * `queries` is keyed by the entry's own `key` (the same string each
 * `PipelineSavedQuery.key` carries) so a `sourceQueryKey` lookup is a
 * direct hash hit. Missing / empty means the pipeline has no saved
 * queries — only collection-backed mappings, or legacy mappings still
 * carrying inline `source.sql`.
 */
export interface DataMappingParams {
  dataMappings: DataMapping[];
  queries?: Record<string, PipelineSavedQuery>;
}

