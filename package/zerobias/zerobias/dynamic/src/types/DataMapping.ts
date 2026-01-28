/**
 * Types for DataMapping configuration
 * These types represent the input structure for dynamic data collection
 */

import { MappingRule, SourceField, DestinationField, TransformConfig } from '@auditmation/zb-client-data-utils';

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
 * Field mapping source (simplified from params)
 */
export interface MappingSourceField {
  key: string;
  name: string;
  type: string;
  level: number;
  sampleValue?: any;
}

/**
 * Field mapping destination (simplified from params)
 */
export interface MappingDestinationField {
  key: string;
  name: string;
  type: string;
  level: number;
  required: boolean;
}

/**
 * Transform configuration from params
 */
export interface MappingTransform {
  type: 'direct' | 'expression' | 'convert' | 'combine' | 'split' | 'default' | 'conditional' | 'lookup';
  options?: {
    expression?: string;
    dataType?: string;
    combineWith?: string;
    splitOn?: string;
    defaultValue?: any;
    applyOnNull?: boolean;
    applyOnEmpty?: boolean;
    conditionOperator?: string;
    conditionValue?: any;
    trueValue?: any;
    falseValue?: any;
    lookupTable?: Record<string, any>;
    lookupDefault?: any;
  };
}

/**
 * Individual field mapping rule from params
 */
export interface ParamsMappingRule {
  id: string;
  source: MappingSourceField;
  transform: MappingTransform;
  destination: MappingDestinationField;
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
  mappings: ParamsMappingRule[];
  metadata: DataMappingMetadata;
  destination: DataMappingDestination;
}

/**
 * Parameters structure containing data mappings
 */
export interface DataMappingParams {
  dataMappings: DataMapping[];
}

/**
 * Convert ParamsMappingRule to MappingRule format used by DataMapper
 */
export function toMappingRule(rule: ParamsMappingRule): MappingRule {
  const source: SourceField = {
    key: rule.source.key,
    name: rule.source.name,
    type: rule.source.type,
    level: rule.source.level,
    sampleValue: rule.source.sampleValue,
  };

  const destination: DestinationField = {
    key: rule.destination.key,
    name: rule.destination.name,
    type: rule.destination.type,
    level: rule.destination.level,
    required: rule.destination.required,
  };

  const transform: TransformConfig = {
    type: rule.transform.type as any,
    options: rule.transform.options as any,
  };

  return {
    id: rule.id,
    source,
    destination,
    transform,
  };
}

/**
 * Convert array of ParamsMappingRule to MappingRule array
 */
export function toMappingRules(rules: ParamsMappingRule[]): MappingRule[] {
  return rules.map(toMappingRule);
}
