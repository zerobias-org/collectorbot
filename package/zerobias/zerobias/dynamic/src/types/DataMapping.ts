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
 *  - File: `file` points at a file uploaded to file-service (no `objectId`,
 *    no producer). See `MappingFileSource`.
 */
export interface DataMappingSource {
  schema?: SourceSchema;
  /** The producer object; absent on a file source. */
  objectId?: string;
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
  /** Set on a file source: the rows come from file-service, never the producer. */
  file?: MappingFileSource;
}

/**
 * A mapping source read from an uploaded file in file-service. Only the file
 * id is stored, so each run reads the file's current ready version, every
 * page from that one version.
 *
 *  - With `containerPath`: the rows of that container — a workbook sheet
 *    (`/File`) or a CSV (`/`) — one source item per row.
 *  - Without: the file itself, as one item of `FileSourceRecord`.
 */
export interface MappingFileSource {
  fileId: string;
  containerPath?: string;
}

/** The one source item of a whole-file source: its file-service metadata. */
export interface FileSourceRecord {
  id: string;
  fileVersionId: string;
  name: string | null;
  mimeType: string | null;
  size: number | null;
  created: string | null;
  updated: string | null;
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
 * A file attached to the pipeline by the platform's pipeline-files endpoint,
 * which imports a `File` object for it as soon as it is added. The collector
 * collects every entry again on each run so those objects stay current.
 *
 *  - `upload`: the file was uploaded straight to file-service; a run only
 *    re-reads it.
 *  - `hub`: the file was copied into file-service at `destinationPath` from
 *    `objectId` on the hub target `targetId`; a run copies it again first so
 *    the latest remote contents become a new version.
 *
 * Entries arrive as JSON, so the collector checks each one's shape at run
 * time and treats one that does not match as unresolved.
 */
export type PipelineFile =
  | { fileId: string; name: string; source: 'upload' }
  | { fileId: string; name: string; source: 'hub'; targetId: string; objectId: string; destinationPath: string };

/**
 * The `File` object written for a pipeline file. `name` is the pipeline
 * entry's name, not file-service's, and `mimeType` is left out when
 * file-service has none.
 */
export interface PipelineFileRecord {
  id: string;
  name: string;
  fileVersionId: string;
  size: number;
  mimeType?: string;
}

/**
 * Parameters structure containing data mappings, the pipeline-level
 * saved-query registry the mappings reference by `sourceQueryKey`, and the
 * files attached to the pipeline.
 *
 * `queries` is keyed by the entry's own `key` (the same string each
 * `PipelineSavedQuery.key` carries) so a `sourceQueryKey` lookup is a
 * direct hash hit. Missing / empty means the pipeline has no saved
 * queries — only collection-backed mappings, or legacy mappings still
 * carrying inline `source.sql`.
 *
 * The platform sends `files` only to the job that collects the pipeline's
 * files, the first scope job of a run; it is absent from every other job's
 * params. That job collects the list the pipeline holds when it runs, not
 * this launch-time copy, which it falls back to only when the current list
 * cannot be read, and reads the list again right before it sends the batch.
 * There, an absent `files` means the pipeline has no file collection at all,
 * and an empty list means every file was removed, so the run deletes their
 * objects.
 */
export interface DataMappingParams {
  dataMappings?: DataMapping[];
  queries?: Record<string, PipelineSavedQuery>;
  files?: PipelineFile[];
}

