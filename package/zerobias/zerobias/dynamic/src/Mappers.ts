/**
 * Data mapping utilities using @zerobias-org/data-utils
 */

import { DataMapper, MappingBindings, MappingRule } from '@zerobias-org/data-utils';

// Singleton DataMapper instance
const dataMapper = new DataMapper();

/**
 * Apply mapping rules to a single source object
 *
 * @param sourceData - The source data object to transform
 * @param mappingRules - Array of mapping rules
 * @param bindings - Variables every expression can read with a `$` in front, such as `$pipelineId`
 * @returns Transformed object according to mapping rules
 */
export async function applyMappings(
  sourceData: any,
  mappingRules: MappingRule[],
  bindings?: MappingBindings
): Promise<{ result: any; errors: string[] }> {
  return dataMapper.applyAllMappings(mappingRules, sourceData, bindings);
}

/**
 * Apply mapping rules to multiple source objects
 *
 * @param sourceItems - Array of source data objects
 * @param mappingRules - Array of mapping rules
 * @param bindings - Variables every expression can read with a `$` in front, such as `$pipelineId`
 * @returns Array of transformed objects with their errors
 */
export async function applyMappingsToMany(
  sourceItems: any[],
  mappingRules: MappingRule[],
  bindings?: MappingBindings
): Promise<Array<{ result: any; errors: string[]; original: any }>> {
  const results: Array<{ result: any; errors: string[]; original: any }> = [];

  for (const item of sourceItems) {
    const { result, errors } = await dataMapper.applyAllMappings(mappingRules, item, bindings);
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
