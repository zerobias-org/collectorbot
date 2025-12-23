---
description: Comprehensive validation of collector bot packages using 8 parallel specialized agents. Validates configuration, schema, mappings, pagination, groupId, security, performance, and dependencies.
argument-hint: [path]
---

# Review Collector Bot

Comprehensive validation using 8 specialized validation agents running in parallel.

## Task

You are the validation orchestrator. Execute comprehensive validation of a collector bot package.

### Step 1: Determine Collector Path

```javascript
const collectorPath = $ARGUMENTS.trim() || process.cwd();
```

Verify path has collector files:
```bash
ls -la ${collectorPath}/package.json
ls -la ${collectorPath}/collector.yml
ls -la ${collectorPath}/src/
```

If missing core files, report error and exit.

---

### Step 2: Spawn 8 Validation Agents in Parallel

**CRITICAL:** Use a SINGLE message with 8 Task tool calls to run agents in parallel.

Spawn these agents simultaneously:

1. **validate-config** - Configuration files validation
2. **validate-schema** - Schema class usage validation
3. **validate-mapping** - Field mapping validation
4. **validate-pagination** - Pagination optimization validation
5. **validate-groupid** - GroupId pattern validation
6. **validate-security** - Security practices validation
7. **validate-performance** - Performance & concurrency validation
8. **validate-dependencies** - Package dependency validation

Each agent call:
```javascript
Task({
  subagent_type: 'general-purpose',
  description: 'Validate [aspect]',
  prompt: `You are the [aspect] validator agent.

Read and follow the instructions in .claude/agents/validate-[name].md exactly.

Collector path: ${collectorPath}

Your task:
1. Read all relevant files for [aspect] validation
2. Check against rules in .claude/COLLECTORBOT_RULES.md and related guides
3. Report violations with file:line references
4. Suggest fixes for each issue
5. Output as JSON:
{
  "aspect": "[name]",
  "status": "pass|fail|warning",
  "violations": [
    {
      "severity": "critical|warning|info",
      "file": "path/to/file",
      "line": 123,
      "issue": "Description of issue",
      "rule": "Rule violated",
      "fix": "Suggested fix"
    }
  ],
  "summary": "Brief summary of findings"
}
`
})
```

---

### Step 3: Collect and Parse Results

Wait for all 8 agents to complete. Parse each agent's JSON output.

---

### Step 4: Generate Compliance Report

**Calculate compliance score:**
```javascript
totalChecks = sum of all checks across agents
passedChecks = checks without violations
score = (passedChecks / totalChecks) * 100
```

**Report format:**

```markdown
# Validation Report: [Package Name]

**Overall Compliance:** [score]% ([passedChecks]/[totalChecks] checks passed)

## Summary by Category

| Category | Status | Violations |
|----------|--------|-----------|
| Configuration | ✅/⚠️/❌ | [count] |
| Schema | ✅/⚠️/❌ | [count] |
| Mapping | ✅/⚠️/❌ | [count] |
| Pagination | ✅/⚠️/❌ | [count] |
| GroupId | ✅/⚠️/❌ | [count] |
| Security | ✅/⚠️/❌ | [count] |
| Performance | ✅/⚠️/❌ | [count] |
| Dependencies | ✅/⚠️/❌ | [count] |

## Critical Issues ([count])

[List all critical violations with file:line and fix suggestions]

## Warnings ([count])

[List all warnings with file:line and fix suggestions]

## Recommendations

[Prioritized list of fixes to improve compliance]

---

**Status:**
- ✅ **Ready for commit** (>95% compliance, no critical issues)
- ⚠️ **Needs fixes** (>80% compliance, some critical issues)
- ❌ **Major issues** (<80% compliance, multiple critical issues)
```

---

### Step 5: Auto-Fix Critical Issues (Optional)

If user confirms, can auto-fix simple issues:
- Missing YAML frontmatter
- Incorrect symlinks
- Missing required fields in package.json

---

## Example Usage

```bash
# Validate current directory
/review-collector

# Validate specific collector
/review-collector package/amazon/aws/s3
```

## Expected Output

Comprehensive report with:
- Overall compliance score
- Category-by-category breakdown
- All violations with file:line references
- Suggested fixes
- Readiness assessment

## Reference

Uses agents from `.claude/agents/validate-*.md` for detailed validation rules.
