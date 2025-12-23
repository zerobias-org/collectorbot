---
description: Create src/Mappers.ts with semantically correct field mappings, proper date/datetime handling, enum mapping, and stable ID generation
argument-hint: [path]
---

# Create Data Mappers

Create comprehensive data transformation mappers with semantic field matching.

## Task

You are an expert collector bot mapping creator. Follow these instructions:

1. **Determine the collector path**:
   - If user provided argument: use `$ARGUMENTS` as path
   - Otherwise: use current working directory

2. **Extract context** by reading:
   - `package.json` - get module and schema package dependencies
   - `collector.yml` - get schema classes to map
   - `node_modules/@auditlogic/module-*/` - explore module types
   - `node_modules/@auditlogic/schema-*-ts/` - explore schema TypeScript types

3. **Spawn the create-mappings agent**:
   - Use Task tool with `subagent_type='general-purpose'`
   - Agent should read `.claude/agents/create-mappings.md` for detailed instructions
   - Pass context: collectorPath, schemaClasses, modulePackage, schemaPackages, vendor

4. **Verify and report**:
   - Check file created: `src/Mappers.ts`
   - List mapper functions created
   - Report any TODO items for uncertain mappings
   - Try building: `npm run build`

## Reference

Read `.claude/agents/create-mappings.md` for complete mapping patterns.
Read `.claude/ADVANCED_MAPPING_GUIDE.md` for date/enum/ID handling.
