---
name: review-collector
description: Comprehensive validation of collector bot packages using 8 parallel specialized agents. Use to validate existing collector packages for compliance.
---

# review-collector

Comprehensive validation of collector bot packages using 8 parallel specialized agents.

## Usage

`/review-collector [path]`

**Arguments:**
- `path` (optional) - Path to collector package directory. Defaults to current directory.

**Examples:**
```
/review-collector package/amazon/aws/iam
/review-collector .
```

## Description

This skill performs comprehensive validation of a collector bot package by spawning 8 specialized validation agents in PARALLEL. Each agent focuses on a specific aspect and reports violations with specific file:line references and fix suggestions.

## Execution Instructions for Claude

When this skill is invoked:

### Step 1: Determine Collector Path

Parse the `args` parameter. If empty, use current working directory.

### Step 2: Spawn 8 Validation Agents in Parallel

Use the Task tool to spawn ALL 8 agents in a SINGLE message (parallel execution):

For each agent, read the corresponding instruction file from `.claude/agents/` and use it as the agent prompt:

1. **validate-config** - Read `.claude/agents/validate-config.md`
2. **validate-schema** - Read `.claude/agents/validate-schema.md`
3. **validate-mapping** - Read `.claude/agents/validate-mapping.md`
4. **validate-pagination** - Read `.claude/agents/validate-pagination.md`
5. **validate-groupid** - Read `.claude/agents/validate-groupid.md`
6. **validate-security** - Read `.claude/agents/validate-security.md`
7. **validate-performance** - Read `.claude/agents/validate-performance.md`
8. **validate-dependencies** - Read `.claude/agents/validate-dependencies.md`

**CRITICAL:** Spawn all 8 in a single message with 8 Task tool calls for true parallel execution.

Pass to each agent:
```
[Agent Instructions from .md file]

---

TASK: Validate collector at: {absolutePath}

Follow the validation checklist above.

Return results in this EXACT JSON format:
{
  "category": "{AgentName}",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "relative/path/from/collector/root",
      "line": number,
      "message": "Description",
      "severity": "error | warning | info",
      "suggestion": "How to fix"
    }
  ]
}

Wrap JSON in ```json code block.
```

### Step 3: Wait for All Agents to Complete

Collect results from all 8 agents.

### Step 4: Aggregate and Display Results

Parse JSON from each agent and display:

```
=================================================================================
🔍 Collector Review Results
=================================================================================

✅ Configuration: PASS
   📄 8 files checked, 0 issues

✅ Schema: PASS
   📄 3 classes validated, all implemented correctly

❌ Mapping: FAIL (3 issues)
   ❌ src/Mappers.ts:45 - Nested mapping detected (should be flat)
      💡 Use group IDs instead: groups: source.groupIds.sort()

   ❌ src/Mappers.ts:67 - Date field using DateTime format
      💡 Use Object.assign workaround - see ADVANCED_MAPPING_GUIDE.md

   ⚠️  src/Mappers.ts:89 - Enum case mismatch
      💡 Change 'ACTIVE' to 'Active'

✅ Pagination: PASS
   📄 All pages processed, pageSize optimized

⚠️  GroupId: WARN (1 issue)
   ⚠️  src/CollectorImpl.ts:124 - GroupId pattern unclear
       💡 Consider: ${accountId}-${region} for regional resources

✅ Security: PASS
   📄 No vulnerabilities detected

✅ Performance: PASS
   📄 Concurrency within limits, memory managed well

❌ Dependencies: FAIL (1 issue)
   ❌ package.json:38 - @auditlogic/schema-amazon-aws-iam is not allowed in this repository
      💡 Use @zerobias-org/schema-amazon-aws-iam (publish it first if it does not exist)

=================================================================================
📊 Overall Results
=================================================================================
   ✅ Pass: 6
   ❌ Fail: 2
   ⚠️  Warn: 1
   📈 Compliance: 75%

⚠️  Action required: Fix 2 critical issue(s) before commit.
=================================================================================
```

### Step 5: Provide Summary

- If all PASS → "🎉 All validations passed! Collector is ready for commit."
- If any FAIL → "⚠️  Action required: Fix N critical issues."
- If only WARN → "✓ Ready with warnings: Review N warnings."

Compliance score: (pass_count / 8) × 100

## Notes

- All agents run in parallel for speed
- Each agent is independent
- All agent instructions are in `.claude/agents/*.md`
- Results are structured JSON for consistent parsing
- File paths are relative to collector root
- Suggestions are actionable and reference documentation
