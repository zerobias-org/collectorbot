# CLAUDE.md - Community Collector Bot Repository

This file provides guidance to Claude Code (claude.ai/code) when working with collector bot content in this repository.

## Project Overview

This is the **ZeroBias Community Collector Bot Repository** containing open-source ETL (Extract/Transform/Load) logic for data collection. Collector bots read from source systems using Hub Modules and write to AuditgraphDB (objects described by Schema classes).

**Repository Role:** Community-contributed content for automated data collection from external systems

This repository follows the same structure as `auditlogic/collectorbot` but contains community-contributed, open-source collector bots.

## Current Status

⚠️ **AI-Assisted Development Workflows Needed**

This CLAUDE.md is a placeholder. Comprehensive AI-assisted development workflows for creating and maintaining collector bots are planned but not yet implemented.

**What's Needed:**
- Step-by-step workflows for creating new collector bots
- Module integration patterns and best practices
- Schema selection and mapping guidelines
- Error handling and retry strategies
- Testing procedures with mock and real data
- Performance optimization techniques
- Scheduling and pipeline integration

## Repository Structure

```
collectorbot/
├── package/zerobias/          # Community collector bot packages
│   └── <bot-name>/            # Individual collector bot
│       ├── package.json       # NPM package configuration
│       ├── collectorbot.yml   # Bot metadata and configuration
│       ├── src/               # TypeScript implementation
│       │   └── index.ts       # Main collection logic
│       ├── test/              # Unit and integration tests
│       └── schema/            # Schema references (optional)
├── scripts/                   # Creation and validation scripts
├── lerna.json                 # Monorepo configuration
└── README.md
```

## File Format Reference

**Source of Truth:** `../../auditmation/platform/dataloader/src/processors/collectorbot/`

**Key Files:**
- `CollectorbotArtifactLoader.ts` - Main processor
- `CollectorbotFileHandler.ts` - File processing

**Expected Structure:**
- `collectorbot.yml` - Metadata (name, description, source systems, target schemas)
- `src/` - TypeScript implementation of collection logic
- `package.json` - Must include `auditmation.import-artifact: "collectorbot"`

## Basic Usage

### Loading Collector Bot
```bash
# Load collector bot into platform
dataloader -d package/zerobias/<bot-name>
```

### Execution
Collector bots are invoked via:
- **Caller Pipelines** - Scheduled execution with parameters
- **Manual Triggers** - On-demand execution via UI/API
- **Event-Driven** - Triggered by platform events

## Integration with Platform

### Dataloader Integration
**Handler Location:** `../../auditmation/platform/dataloader/src/processors/collectorbot/`
**Database Table:** `catalog.collector_bot`

### Runtime Integration
- **Hub Modules:** Collector bots invoke Hub module operations
- **AuditgraphDB:** Write collected data as objects with versions
- **Schemas:** Objects conform to schema class definitions
- **Pipelines:** Scheduled via caller pipeline configuration

## Collector Bot Architecture

### Typical Flow
```
Collector Bot
  → Hub Module (via Hub Client)
    → External API/System
  → Transform Data
  → Create/Update Objects in AuditgraphDB
  → Publish Events
```

### Key Components
- **Module Invocation:** Call Hub module operations with connection profiles
- **Data Transformation:** Map external data to schema objects
- **Object Creation:** Create/update objects and versions in PostgreSQL
- **Link Establishment:** Create relationships between objects
- **Event Publishing:** Notify platform of new/changed data

## Related Documentation

- **[Root CLAUDE.md](../../CLAUDE.md)** - Meta-repo guidance
- **[ContentArtifacts.md](../../ContentArtifacts.md)** - Content catalog system
- **[auditlogic/collectorbot/CLAUDE.md](../../auditlogic/collectorbot/CLAUDE.md)** - Proprietary collector bots (same pattern)
- **[auditmation/platform/dataloader/CLAUDE.md](../../auditmation/platform/dataloader/CLAUDE.md)** - Dataloader processor
- **[auditmation/hub/CLAUDE.md](../../auditmation/hub/CLAUDE.md)** - Hub integration platform
- **[auditlogic/schema/CLAUDE.md](../../auditlogic/schema/CLAUDE.md)** - Schema definitions
- **[zerobias-org/module/CLAUDE.md](../module/CLAUDE.md)** - Community Hub modules

## Important Notes

### Community vs Proprietary

**This Repository (zerobias-org/collectorbot):**
- Open-source, community-contributed collector bots
- Public GitHub repository
- MIT/Apache license
- Community support

**Proprietary Repository (auditlogic/collectorbot):**
- Closed-source, Auditmation-developed collector bots
- Private GitHub repository
- Commercial license
- Official support

Both follow identical structure and use same dataloader processor.

## Future Development

Once AI-assisted development workflows are implemented, this CLAUDE.md will include:
- Creating new collector bot from template
- Integrating with Hub modules
- Mapping external data to schemas
- Testing and validation
- Publishing to NPM registry
- Integration testing with platform

---

**Last Updated:** 2025-11-11
**Maintainers:** ZeroBias Community

