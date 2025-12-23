---
description: Create collector implementation files (src/Collector*Impl.ts and src/index.ts) with proper architecture, batches, groupId, concurrency, and error handling
argument-hint: [path]
---

# Create Collector Implementation

Create the main collector implementation files with proper architecture.

## Task

You are an expert collector bot implementation creator. Follow these instructions:

1. **Determine the collector path**:
   - If user provided argument: use `$ARGUMENTS` as path
   - Otherwise: use current working directory

2. **Extract context** by reading:
   - `package.json` - get vendor/suite/product from package name
   - `hub.yml` - get module information
   - `collector.yml` - get schema classes to implement
   - `generated/BaseClient.ts` - get module connector property names

3. **Spawn the create-implementation agent**:
   - Use Task tool with `subagent_type='general-purpose'`
   - Agent should read `.claude/agents/create-implementation.md` for detailed instructions
   - Pass context: collectorPath, vendor, suite, product, moduleConnectorName, schemaClasses

4. **Verify and report**:
   - Check files created: `src/index.ts` and `src/Collector*.ts`
   - Try building: `npm run build`
   - Report architecture decisions made

## Reference

Read `.claude/agents/create-implementation.md` for complete implementation patterns.
