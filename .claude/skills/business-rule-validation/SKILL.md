---
name: business-rule-validation
description: Extract, validate and approve business rules. Use for Agent 5.
---
- Rules come from: NULL/NOT NULL, CONSTANT/DEFAULT map types, COALESCE(...,-1) lookups, FPM_DA_RULES, REMARK statements (e.g. "MARKET_VALUE must not be summed").
- Each rule: id, text, target, kind (mandatory|default|transform|constraint|derivation), source ref (sheet,rowNo), status.
- Validation results (pass/fail/warn) are checks against mapping metadata only (no real data) and are labelled Simulated where not derivable from the workbook.
- Rule review: pending -> approved | rejected.

## CrisMac SQL -> TRAQ rule migration (Phase 10, `src/domain/ruleConversion/`)
- Separate modules, all pure: `intake` (file checks, procedure name), `sqlExpr` (T-SQL expression parser -> AST), `resolve` (CrisMac column -> TRAQ via Agent 4 manual > Agent 4 approved > workbook mapping > same-name match), `translate` (AST -> TRAQ syntax), `convert` (compose statements per column, issues, confidence), `templates` (layouts, rows, export checks, report), `views` (UI selectors). Service: `RuleConversionService` (`services/mock/ruleConversion.ts`).
- Target layouts are real: dd_export.csv header (TRAQ data-dictionary derivation) and FPM_DA_RULES row 4. Allowed values = values in those files. Do not add columns or values that are not in them; if a new template is supplied, add it to `TEMPLATES` with its provenance.
- TRAQ syntax may only use forms seen in FPM_DA_RULES live rules ("T"."C", "T"."FK_X"."C", IF()THEN()ELSE(), AND(), OR(), (x)IN[...], ==, !=, COALESCE, ISEMPTY, ISNOTEMPTY, TRIM, TODATE, DATEDIFF(later,earlier,"d")). Anything else is rewritten into those forms or kept and flagged; never silently change logic.
- Rules must use TRAQ names: an unmapped column stays `[[UNMAPPED T.C]]`, an unset parameter `[[PARAM @X]]`, unsupported SQL `[[UNSUPPORTED ...]]`; each blocks export. Missing mappings are added as Agent 4 manual mappings (reviewStore), never in a separate mapping store.
- One rule per CrisMac table.column per procedure: statements compose in execution order (later statements see earlier results), WHERE / INNER JOIN / IF guards become IF conditions. Confidence is a labelled heuristic (`source: 'mock'`).
