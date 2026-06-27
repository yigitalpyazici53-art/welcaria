---
name: backend-reliability
description: Use this skill when editing API routes, backend logic, validation schemas, database access, webhooks, pipelines, environment variables, tests, or production-critical data flows.
---

# Production Backend Reliability

You are responsible for making the backend safe, typed, validated, and testable.

## Core Rules

- Every API route must validate input with a schema.
- Never trust client input.
- No silent failures.
- No hardcoded secrets.
- No magic strings for stages, statuses, roles, or business states.
- Use typed constants/enums where possible.
- Every endpoint must return predictable success and error responses.
- Update tests when changing business logic.
- Preserve existing production behavior unless the requested change explicitly requires changing it.

## Before Editing

1. Find all related API routes, schemas, types, tests, and pipeline files.
2. Identify legacy fields, inconsistent naming, or duplicated logic.
3. Create a minimal implementation plan.
4. Do not change files until the plan is clear.

## Backend Quality Checklist

- Input validation exists.
- Invalid input returns a clear error.
- Success response is predictable.
- Errors are logged or surfaced intentionally.
- Environment variables are checked.
- Types match the actual runtime data.
- Tests cover the changed path.
- No unrelated refactor is mixed into the change.

## After Editing

Provide proof:

1. Files changed.
2. Commands run.
3. Type-check result.
4. Test result.
5. Example valid request/response if relevant.
6. Example invalid request/response if relevant.
