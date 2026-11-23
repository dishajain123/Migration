---
name: migration-mapping
description: Mapping suggestions, confidence, review workflow. Use for Agent 4.
---
- Existing workbook mappings = `source: 'workbook'`, status `documented`. Suggested ones = `source: 'mock'`, labelled Simulated.
- Confidence heuristic (documented, deterministic): name similarity + type compatibility + MAP TYPE; never present as LLM output.
- Flag: type incompatibility, size truncation (e.g. 50 -> 30), target collisions (multiple sources -> one target), unmapped (DECISION blank), ambiguous (`confirmation required`).
- Review workflow states: suggested -> approved | rejected | manual. Persist in store; service `submitReview` returns an ApiResult.
