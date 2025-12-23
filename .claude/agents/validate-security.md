---
name: validate-security
description: Validates security practices, credential handling, sensitive data exposure, and ensures no hardcoded secrets in collector bot implementations.
tools: Read, Grep, Glob
---

# Security Validator Agent

## Mission

Validate collector code for security vulnerabilities: secrets exposure, injection attacks, unsafe operations.

## Security Checklist

### Secrets & Credentials

**CRITICAL:** No hard-coded credentials or secrets

- [ ] No hard-coded API keys, passwords, tokens
- [ ] No credentials in code comments
- [ ] No credentials in README examples
- [ ] No .env files with real credentials
- [ ] No secrets in test files

**Check for:**
```typescript
// ❌ CRITICAL SECURITY ISSUE
const apiKey = 'sk-live-abc123...';
const password = 'MyPassword123';

// ✅ CORRECT - from parameters or environment
const apiKey = this.context.parameters.apiKey;
const password = process.env.PASSWORD;
```

### SQL Injection

- [ ] No string concatenation for SQL (shouldn't have SQL in collectors anyway)
- [ ] All database operations via Batch API (parameterized)

### Command Injection

- [ ] No `eval()` or `Function()` constructor
- [ ] No unsanitized input to `child_process.exec()`
- [ ] No dynamic require() with user input

### XSS / Code Injection

- [ ] No innerHTML or DOM manipulation (server-side code)
- [ ] No unsafe deserialization of untrusted data
- [ ] Proper JSON parsing with try-catch

### Path Traversal

- [ ] No user-controlled file paths without validation
- [ ] No `../` in file operations
- [ ] If reading files, paths are validated

### Data Validation

- [ ] User input validated before use
- [ ] Parameters validated against OpenAPI schema
- [ ] Enum values validated before use
- [ ] Array/object destructuring has safeguards

### Safe Coding Practices

**Check for dangerous patterns:**

**1. Unsafe eval:**
```typescript
// ❌ DANGEROUS
eval(userInput);
new Function(userInput)();

// ✅ SAFE - don't use eval at all
```

**2. Unsafe deserialization:**
```typescript
// ⚠️ RISKY - if data comes from untrusted source
const obj = JSON.parse(untrustedData);

// ✅ SAFER - with validation
try {
  const obj = JSON.parse(data);
  if (!isValidStructure(obj)) throw new Error('Invalid');
} catch (err) {
  // Handle
}
```

**3. Prototype pollution:**
```typescript
// ❌ DANGEROUS
Object.assign(target, userInput);

// ✅ SAFER - validate keys first
const safe = {
  knownKey1: userInput.knownKey1,
  knownKey2: userInput.knownKey2
};
```

### Logging Sensitive Data

- [ ] No passwords/secrets in logs
- [ ] API responses sanitized before logging
- [ ] Error messages don't expose sensitive paths/config

```typescript
// ❌ DANGEROUS
this.logger.error(`Failed with key: ${apiKey}`);

// ✅ SAFE
this.logger.error(`Failed with key: ${apiKey.substring(0, 8)}...`);
// Or better: don't log key at all
this.logger.error('Failed to authenticate');
```

### Third-Party Dependencies

- [ ] All dependencies are from trusted scopes (@auditlogic, @auditmation)
- [ ] No suspicious dependencies
- [ ] Dependency versions use ^ (allow security patches)

## Common Vulnerabilities to Check

| Vulnerability | Pattern | Severity |
|---------------|---------|----------|
| Hard-coded secrets | String literals with keys/passwords | CRITICAL |
| eval() usage | `eval(`, `new Function(` | CRITICAL |
| Command injection | `exec(`, `spawn(` with user input | CRITICAL |
| SQL injection | String concat in queries | CRITICAL |
| Path traversal | `../` in file operations | HIGH |
| Unsafe deserialization | `JSON.parse` without validation | MEDIUM |
| Prototype pollution | Object.assign with user data | MEDIUM |
| Secrets in logs | Logging API keys, passwords | HIGH |
| Regex DoS | Complex regex with user input | MEDIUM |

## Output Format

```json
{
  "category": "Security",
  "status": "PASS | FAIL | WARN",
  "issues": [
    {
      "file": "src/CollectorImpl.ts",
      "line": 45,
      "message": "CRITICAL: Hard-coded API key detected",
      "severity": "error",
      "suggestion": "Move to parameters.yml or environment variable"
    },
    {
      "file": "src/Utils.ts",
      "line": 23,
      "message": "Unsafe JSON.parse without validation",
      "severity": "warning",
      "suggestion": "Wrap in try-catch and validate structure"
    }
  ]
}
```

## Instructions

1. Read all source files (src/**, test/**)
2. Scan for security vulnerability patterns
3. Check for hard-coded credentials
4. Verify no injection vulnerabilities
5. Check logging doesn't expose sensitive data
6. Report ALL security issues as errors
7. Return structured results
