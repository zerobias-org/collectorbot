/**
 * Data mapping utilities using @zerobias-org/data-utils
 */

import { DataMapper, MappingRule } from '@zerobias-org/data-utils';
import { ParamsMappingRule, toMappingRules } from './types/index.js';

// Singleton DataMapper instance
const dataMapper = new DataMapper();

/**
 * Apply mapping rules to a single source object
 *
 * @param sourceData - The source data object to transform
 * @param mappingRules - Array of mapping rules from params
 * @returns Transformed object according to mapping rules
 */
export async function applyMappings(
  sourceData: any,
  mappingRules: ParamsMappingRule[]
): Promise<{ result: any; errors: string[] }> {
  const rules = toMappingRules(mappingRules);
  return dataMapper.applyAllMappings(rules, sourceData);
}

/**
 * Apply mapping rules to multiple source objects
 *
 * @param sourceItems - Array of source data objects
 * @param mappingRules - Array of mapping rules from params
 * @returns Array of transformed objects with their errors
 */
export async function applyMappingsToMany(
  sourceItems: any[],
  mappingRules: ParamsMappingRule[]
): Promise<Array<{ result: any; errors: string[]; original: any }>> {
  const rules = toMappingRules(mappingRules);
  const results: Array<{ result: any; errors: string[]; original: any }> = [];

  for (const item of sourceItems) {
    const { result, errors } = await dataMapper.applyAllMappings(rules, item);
    results.push({ result, errors, original: item });
  }

  return results;
}

/**
 * Get the DataMapper instance for advanced usage
 */
export function getDataMapper(): DataMapper {
  return dataMapper;
}

// Legacy exports for backward compatibility
export function toMultipleElements(obj: any): any {
  return obj;
}

export function toSingleElement(obj: any): any {
  return obj;
}
