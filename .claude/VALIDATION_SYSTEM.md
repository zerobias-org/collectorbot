# Collector Bot Validation System

This document describes the multi-agent validation system for ensuring collector bot quality, security, and compliance.

## Overview

The complete system consists of:

**Creation System:**
- **1 creation skill** (`/create-collector`) - Full collector creation
- **2 creation agents** - Implementation and Mapping (run in parallel)
- **Automatic validation** - Runs /review-collector at completion

**Validation System:**
- **1 validation skill** (`/review-collector`) - Comprehensive review
- **8 validation agents** - Each validates a specific aspect
- **Parallel execution** - All agents run simultaneously for speed
- **Structured reporting** - Consistent format with file:line references

## Architecture

```
User invokes: /review-collector package/amazon/aws/iam
                         ↓
              ┌──────────────────────┐
              │  review-collector    │
              │  (Orchestrator Skill)│
              └──────────────────────┘
                         ↓
         Spawns 8 agents in parallel (single Task call)
                         ↓
    ┌────────┬─────────┬────────┬─────────┬────────┬─────────┬─────────┬────────┐
    ▼        ▼         ▼        ▼         ▼        ▼         ▼         ▼
  Config  Schema  Mapping  Pagination GroupId Security Performance Dependencies
  Agent   Agent    Agent     Agent     Agent   Agent      Agent        Agent
    │        │         │        │         │        │         │            │
    └────────┴─────────┴────────┴─────────┴────────┴─────────┴───────────┘
                         ↓
              Aggregate results & display
                         ↓
              Compliance score & summary
```

## The 8 Validation Agents

### 1. Configuration Validator

**File:** `.claude/agents/validate-config.md`

**Validates:**
- package.json (naming, version, scripts, metadata)
- hub.yml (modules, products, UUIDs)
- collector.yml (schema classes)
- parameters.yml (OpenAPI 3.0.3)
- tsconfig.json (decorators, output, includes)
- .eslintrc (extends, parser, rules)
- .mocharc.json (timeout, extensions)
- .gitignore (generated/, dist/, node_modules/)
- .npmrc/.nvmrc (symlinks, not files)

**Key Rules:**
- Names follow conventions
- All required scripts present
- Operations omitted from hub.yml
- dataloader-version = 0.5.4
- Symlinks verified

### 2. Schema Validator

**File:** `.claude/agents/validate-schema.md`

**Validates:**
- All classes in collector.yml have mappers
- All classes in collector.yml are collected in run()
- All mappers have corresponding collector.yml entries
- No missing schema classes (under-collection)
- No impossible classes (over-collection)
- Batches created and ended for all classes

**Key Rules:**
- Collect ALL schema classes with module data
- Remove classes without module data
- Every class: mapper + batch + collection method

### 3. Mapping Validator

**File:** `.claude/agents/validate-mapping.md`

**Validates:**
- No nested mapper calls (should be flat)
- Date vs DateTime handled correctly (Object.assign for date)
- Enums mapped semantically and case-correct
- IDs stable (not random)
- Required fields (id, name) always present
- Semantic field matching

**Key Rules:**
- Flat mappers only (no cross-mapper calls)
- Check base schema for date type
- Enum values must match schema exactly
- IDs from source data, never UUID.generateV4()

### 4. Pagination Validator

**File:** `.claude/agents/validate-pagination.md`

**Validates:**
- ALL pages processed (critical - prevents data loss)
- No hard-coded limits in production
- forEach handles pagination correctly
- Page size optimized (≥1000 unless vendor limit)
- Preview mode doesn't cause data loss
- Nested iteration processes all data

**Key Rules:**
- CRITICAL: Detect data loss patterns (only first page)
- Verify hasNext() or forEach pagination
- Optimize pageSize (default 50 is too small)
- Preview count only in preview mode

### 5. GroupId Validator

**File:** `.claude/agents/validate-groupid.md`

**Validates:**
- GroupId consistency across runs
- No duplicate groupIds for independent data sources
- Pattern matches vendor conventions
- System identifier extracted correctly
- No data loss risks from groupId changes

**Key Rules:**
- Different sources = different groupIds (CRITICAL)
- GroupId changes = data deletion risk
- Empty groupId valid for global shared data
- Pattern documented in code

### 6. Security Validator

**File:** `.claude/agents/validate-security.md`

**Validates:**
- No hard-coded credentials/secrets
- No SQL injection vulnerabilities
- No command injection (eval, exec)
- No XSS/code injection
- No path traversal
- Safe logging (no secrets in logs)
- Dependency safety

**Key Rules:**
- No hard-coded API keys/passwords
- No eval() or Function()
- JSON.parse with validation
- No sensitive data in logs
- Only trusted dependencies

### 7. Performance Validator

**File:** `.claude/agents/validate-performance.md`

**Validates:**
- Concurrency ≤30 for nested requests
- Memory management (no large arrays)
- for await for large datasets (>10k)
- API call minimization (no N+1 problems)
- Lazy loading implemented
- Regional serial processing

**Key Rules:**
- Nested: outer × inner ≤ 30
- Don't accumulate all data in memory
- Minimize API calls
- Optimize concurrency appropriately

### 8. Dependency Validator

**File:** `.claude/agents/validate-dependencies.md`

**Validates:**
- All modules from hub.yml in package.json
- All schemas from collector.yml in package.json
- Both base and -ts schema packages
- NO product packages (transitive)
- NO vendor packages except vendor-neverfail
- Version prefixes correct (^ vs exact)
- Required core dependencies present

**Key Rules:**
- Module/schema dependencies match yml files
- Product packages forbidden (transitive)
- Vendor packages forbidden except neverfail
- TypeScript = exact 4.9.5
- Others = ^ versions

## Usage

### Basic Usage

```bash
# Review current directory
/review-collector

# Review specific collector
/review-collector package/amazon/aws/iam

# Review after making changes
/review-collector .
```

### Workflow Integration

**After creating new collector:**
```bash
# 1. Implement collector
# ... create files ...

# 2. Build and lint
npm run build
npm run lint

# 3. Comprehensive validation
/review-collector

# 4. Fix any issues reported
# ... fix violations ...

# 5. Re-validate
/review-collector

# 6. Commit when 100% pass
git commit -m "feat(iam): initial implementation"
```

**After modifying existing collector:**
```bash
# 1. Make changes
# ... edit files ...

# 2. Validate changes
/review-collector

# 3. Check especially:
#    - GroupId didn't change (data loss!)
#    - No new security issues
#    - Pagination still complete

# 4. Commit
git commit -m "fix(iam): ..."
```

## Output Format

Each agent returns structured JSON:

```json
{
  "category": "Configuration | Schema | Mapping | Pagination | GroupId | Security | Performance | Dependencies",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "src/Mappers.ts",
      "line": 45,
      "message": "Nested mapping detected",
      "severity": "error | warning | info",
      "suggestion": "Use IDs: groups: source.groupIds.sort()"
    }
  ],
  "stats": {
    "filesChecked": 8,
    "passed": 7,
    "failed": 1
  }
}
```

## Compliance Scoring

**Score = (Pass Count / 8) × 100**

| Score | Status | Action |
|-------|--------|--------|
| 100% | 🎉 Perfect | Ready for commit |
| ≥90% | ✅ Good | Review warnings, commit OK |
| 75-89% | ⚠️  Needs work | Fix issues before commit |
| <75% | ❌ Not ready | Significant issues, don't commit |

## What Each Agent Catches

### Critical Issues (FAIL collectors)

1. **Data Loss** - Pagination agent catches:
   - Only processing first page
   - Hard-coded limits
   - Missing hasNext() checks

2. **Data Deletion** - GroupId agent catches:
   - Same groupId for independent sources
   - GroupId changes in modifications

3. **Security** - Security agent catches:
   - Hard-coded credentials
   - Injection vulnerabilities

4. **Build Failures** - Configuration agent catches:
   - Invalid templates
   - Missing required files
   - Wrong package names

### Quality Issues (WARN but allow commit)

1. **Performance** - Performance agent catches:
   - Suboptimal concurrency
   - Memory inefficiency
   - N+1 API calls

2. **Consistency** - Mapping agent catches:
   - Enum case mismatches
   - Unclear patterns

3. **Optimization** - Pagination agent catches:
   - Small page sizes
   - Inefficient pagination

## Extending the System

### Adding New Validators

To add a new specialized validator:

1. Create `.claude/agents/validate-{name}.md`
2. Follow template from existing agents
3. Define validation checklist
4. Specify output format
5. Update `/review-collector` skill to spawn it
6. Update this document

### Customizing Validation

Each agent reads from the rules documentation:
- COLLECTORBOT_RULES.md
- DEVELOPMENT_WORKFLOW.md
- ADVANCED_MAPPING_GUIDE.md
- VENDOR_PATTERNS.md

Update these documents to change validation rules.

## Benefits

✅ **Comprehensive** - 8 different aspects validated
✅ **Parallel** - Fast execution (agents run simultaneously)
✅ **Consistent** - All rules from documentation enforced
✅ **Actionable** - Specific file:line with fix suggestions
✅ **Automated** - No manual checklist needed
✅ **Prevents issues** - Catches before commit
✅ **Data safety** - Prevents data loss and deletion
✅ **Security** - Catches vulnerabilities
✅ **Quality** - Enforces best practices

---

*Last Updated: 2024-12-16*
