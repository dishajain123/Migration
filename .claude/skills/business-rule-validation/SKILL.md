---
name: business-rule-validation
description: Extract, validate and approve business rules. Use for Agent 5.
---
- Rules come from: NULL/NOT NULL, CONSTANT/DEFAULT map types, COALESCE(...,-1) lookups, FPM_DA_RULES, REMARK statements (e.g. "MARKET_VALUE must not be summed").
- Each rule: id, text, target, kind (mandatory|default|transform|constraint|derivation), source ref (sheet,rowNo), status.
- Validation results (pass/fail/warn) are checks against mapping metadata only (no real data) and are labelled Simulated where not derivable from the workbook.
- Rule review: pending -> approved | rejected.
