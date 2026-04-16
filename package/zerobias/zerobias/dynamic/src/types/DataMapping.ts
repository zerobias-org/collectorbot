/**
 * Types for DataMapping configuration
 * These types represent the input structure for dynamic data collection
 */

import { MappingRule } from '@zerobias-org/data-utils';

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
 * Source configuration - where data comes from
 */
export interface DataMappingSource {
  schema: SourceSchema;
  objectId: string;
  objectName: string;
  objectPath: string[];
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
 * Parameters structure containing data mappings
 */
export interface DataMappingParams {
  dataMappings: DataMapping[];
}

