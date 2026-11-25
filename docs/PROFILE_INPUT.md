# Optional profile & metadata input (Agent 4)

The workbook stays the only source of truth. This is an **opt-in extra input** that lets Agent 4 compare columns whose
names differ, using what the columns *mean* and what their data *looks like*. If you load nothing, nothing changes.

- Load it on the Mapping page (Suggestions tab, "Profile & metadata"). It lives in browser memory only: it is not saved,
  not written to localStorage and not part of any export.
- Suggestions it changes are labelled **`profile_enriched`** (workbook-only ones are `workbook`). Their confidence is the
  raw score, **not** calibrated, because the calibration was measured without profile data. They still need approval.
- Parser: `src/domain/profile.ts` (strict: invalid entries are reported and skipped, never guessed).
  Signals: `profileSimilarity` in `src/domain/mappingSemantics.ts`. Weight: `PROFILE_WEIGHT` in `mappingEngine.ts`.

## Privacy: sample values
`topValues`, `patterns` and value-set members are real data. They are matched locally always, but are sent to an AI model
(prompts, embeddings) **only if `shareSampleValuesWithAi` is `true`** in the file (CSV: the checkbox on the panel). Names,
descriptions, glossary terms, counts, null rates and min/max are not treated as sample values.

## JSON schema (version 1)
```json
{
  "version": 1,
  "label": "CrisMac profile 2026-11",
  "generatedAt": "2026-11-20",
  "shareSampleValuesWithAi": false,
  "columns": [
    {
      "table": "ACCOUNT_MASTER", "column": "CUST_SEG",
      "description": "Customer segment code",
      "glossaryTerm": "Customer segment",
      "valueSet": "SEGMENT_CODES",
      "profile": { "rowCount": 120000, "distinctCount": 6, "nullRate": 0.01, "min": "A", "max": "F",
                   "topValues": ["A", "B", "C"], "patterns": ["A"] }
    }
  ],
  "glossary": [ { "term": "Customer segment", "definition": "Bank-defined client tier", "synonyms": ["client class"] } ],
  "valueSets": [ { "name": "SEGMENT_CODES", "values": ["A", "B", "C", "D", "E", "F"] } ]
}
```
Rules: `version` must be 1. `table`/`column` required per column (matched case-insensitively against workbook names).
`nullRate` is a fraction 0..1. `distinctCount`/`rowCount` are non-negative integers. At most 200 values per list.

## CSV
One row per column, `|` separates list values. Header (unknown headers are reported):
`table,column,description,glossary_term,glossary_definition,value_set,value_set_values,row_count,distinct_count,null_rate,min,max,top_values,patterns`

## How it is used
For a target column and a candidate source column that both have entries, `profileSimilarity` combines (noisy-OR):
description wording overlap, a shared glossary term/synonym, the same value set or overlapping code values, and coarse
statistics (numeric range overlap, similar distinct counts, same pattern). A similarity of at least 0.3 adds
`0.35 x similarity` to the candidate's score. A type clash is still rejected and the 0.35 acceptance threshold is unchanged.
