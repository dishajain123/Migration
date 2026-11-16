// Scope definition. See docs/DATA_DICTIONARY.md section 2.

export const IN_SCOPE_SHEETS: string[] = [
  'FCT_COLLATERAL', 'FCT_CURRENCY_RATE', 'FCT_PRODUCT_MASTER', 'FCT_UNIFIED_CUSTOMER',
  'Recp_Collateral', 'Recp_Customer', 'Recp_Joint_Account_Holding', 'Recp_Party', 'Recp_Securities',
  'STG_ASSET_BASE', 'STG_BILLS', 'STG_PC', 'STG_TRANSACTIONS', 'DIM Tables', 'ACCOUNT_EXCEPTION_STATUS',
  'INVESTMENT_TO_FPM', 'ASSET_BASE_TO_FPM', 'STG_INVESTMENT_BASE', 'UPLOAD_RESTRUCTURE_DETAIL',
  'FCT_COLLATERAL_PRODUCT_LINK', 'FCT_RESTRUCTURE_DETAIL', 'UPLOAD_PUI_DETAIL_MAIN', 'UPLOAD_PUI_DETAIL_SUB',
  'FCT_PUI_DETAIL', 'STG_BUYOUT_HIST', 'UPLOAD_BUYOUT_MAPPER', 'UPLOAD_BUYOUT_MAPPER_MASTER',
  'FCT_BUYOUT_DETAIL', 'DERIVATIVE_TO_FPM', 'FCT_BILLS', 'FCT_PC', 'FCT_TRANSACTION',
];

export const RULES_SHEET = 'FPM_DA_RULES';
export const INDEX_SHEET = '01 Index';

// Downstream of FCT_PRODUCT_MASTER - explicitly excluded.
export const OUT_OF_SCOPE_TABLES: string[] = [
  'FCT_NPA_PRODUCT', 'FCT_NPA_PROVISION', 'FCT_PRODUCT_MASTER_AGG', 'FCT_SMA_EVALUATION',
  'Recp_NPA_Details', 'DI_WORKFLOWS',
];

// Map types that do not actually feed a target column.
export const NONFEED = new Set(['NOT FED', 'NOT USED', 'NOT MAPPED', 'NOT CARRIED', 'DROPPED']);

// Known gaps, taken from docs/DATA_DICTIONARY.md section 6 (workbook-derived).
export const KNOWN_GAPS: string[] = [
  'The workbook contains no stored-procedure, view or DI-mapping SQL bodies - only object names and prose/expressions in remark cells.',
  'No physical PK/FK catalogue: primary keys are stated only in some sheet banners.',
  'FCT_PRODUCT_MASTER is mapped across several sheets (its own sheet maps 18 columns; ASSET_BASE_TO_FPM, INVESTMENT_TO_FPM and DERIVATIVE_TO_FPM map the rest).',
  'Row counts disagree between index and banners in places (e.g. STG_INVESTMENT_BASE: index 0, banner 215).',
  'All DECISION cells in the "CrisMac columns with no TRAQ target" blocks are blank (unresolved), except a few STG_ASSET_BASE VisionPlus rows.',
  'Target collisions on VisionPlus staging columns are flagged but unresolved.',
  'The workbook states no mapping confidence values; confidence shown here is a labelled heuristic.',
  'DI_WORKFLOWS sheet has no body rows (treated as out of scope).',
  'Datatype notation mixes SQL Server (CrisMac) and Oracle (TRAQ) types.',
];
