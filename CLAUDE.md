# Project Rules

## Error responses must include debugging context

Every error response must include the fields that a developer would need to diagnose the problem without having to re-run the request or inspect the database manually.

Rules:
- "Not found" errors must include the ID that was looked up.
- "Invalid input" errors must include both what was received and what was expected.
- "Business rule violation" errors (insufficient balance, wrong state, etc.) must include the relevant values — e.g. current balance, required cost, shortfall; current state, expected state.
- "Retry exhausted" errors must include which resource was contended and how many attempts were made.

All error values that are `bigint` in the domain must be serialized as strings (same rule as success responses).
