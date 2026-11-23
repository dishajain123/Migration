# Data Dictionary - Workbook Analysis (Phase 0)

Source of truth: `CrisMac_to_TRAQ_Combined.csv` (all worksheets flattened: `Sheet_Name, Row_No, Col_1..Col_11`).
The original `.xlsx` is NOT in the project directory; only the flattened CSV was supplied. Row numbers below refer to `Row_No` in that CSV.
Everything here was read from the workbook; nothing is inferred beyond what is stated. Gaps are listed explicitly in section 6.

## 1. Sheet inventory and layout conventions

`01 Index` (rows 4-79) lists each TRAQ table with: LAYER (MART / STAGING / RECEPTION / APP / DI), COLUMNS, MAPPED, ROWS IN DB, STRUCTURE FROM.

Three sheet shapes exist:

| Shape | Header row (Col_1..) | Used by |
|---|---|---|
| A. Column mapping, TRAQ-centric | TRAQ COLUMN, DATATYPE, NULL, CRISMAC SOURCE, CRISMAC TABLE, CRISMAC COLUMN, CRISMAC DATATYPE, MAP TYPE, REMARK | FCT_COLLATERAL, FCT_CURRENCY_RATE, FCT_NPA_*, FCT_PRODUCT_MASTER, FCT_UNIFIED_CUSTOMER, FCT_COLLATERAL_PRODUCT_LINK, FCT_RESTRUCTURE_DETAIL, FCT_PUI_DETAIL, FCT_BUYOUT_DETAIL, Recp_* , STG_ASSET_BASE |
| B. Column mapping, source-centric | CRISMAC SOURCE, CRISMAC TABLE, CRISMAC COLUMN, CRISMAC DATATYPE, TRAQ TABLE, TRAQ COLUMN, TRAQ DATATYPE, MAP TYPE, REMARK | STG_BILLS, STG_PC, STG_TRANSACTIONS, DIM Tables, ACCOUNT_EXCEPTION_STATUS |
| C. Target-from-staging mapping | SOURCE SYSTEM, SOURCE TABLE, SOURCE COLUMN, SOURCE DATATYPE, TARGET TABLE, TARGET COLUMN, TARGET DATATYPE, MAP TYPE, REMARK | ASSET_BASE_TO_FPM, INVESTMENT_TO_FPM, DERIVATIVE_TO_FPM, STG_INVESTMENT_BASE, UPLOAD_*, FCT_BILLS, FCT_PC, FCT_TRANSACTION |

Banner row 2 of every sheet is a pipe-delimited summary (layer, column counts, row counts, load notes). Parse it as free text, not structure.
Sheets with trailing "CRISMAC COLUMNS WITH NO TRAQ TARGET" blocks (Recp_*, STG_ASSET_BASE): 5 columns SOURCE, TABLE, COLUMN, DATATYPE, TRAQ TABLE/COLUMN, DECISION; DECISION is blank (unresolved) except a few STG_ASSET_BASE VisionPlus rows.
MAP TYPE values seen: DIRECT, DERIVED, LOOKUP, JOIN, CONSTANT, RENAME, ADDITION, FALLBACK, NOT FED, NOT USED, NOT MAPPED, NOT CARRIED, DROPPED, DA RULE, ETL, "confirmation required", blank.

## 2. Scope decision (up to and including FCT_PRODUCT_MASTER)

Derived from the flow diagram (`RBL TRAQ FLOW`) and the sheet banners.

IN scope (upstream of / feeding FCT_PRODUCT_MASTER):
- Reception: Recp_Collateral, Recp_Customer, Recp_Party, Recp_Securities, Recp_Joint_Account_Holding (dictionary tables, mostly "NOT USED" in the load path)
- Staging: STG_ASSET_BASE, STG_BILLS, STG_PC, STG_TRANSACTIONS, STG_INVESTMENT_BASE, STG_UNIFIED_CUSTOMER, STG_BUYOUT_HIST
- Dimensions (MART DIM_*, plus DH2.0 Dim_* dictionary and the `DIM Tables` sheet CrisMac->TRAQ mapping)
- Facts/support feeding FPM: FCT_CURRENCY_RATE, FCT_COLLATERAL, FCT_COLLATERAL_PRODUCT_LINK, FCT_UNIFIED_CUSTOMER, FCT_BILLS, FCT_PC, FCT_TRANSACTION, FCT_BUYOUT_DETAIL, FCT_RESTRUCTURE_DETAIL, FCT_PUI_DETAIL, ACCOUNT_EXCEPTION_STATUS
- Uploads: UPLOAD_RESTRUCTURE_DETAIL, UPLOAD_PUI_DETAIL_MAIN, UPLOAD_PUI_DETAIL_SUB, UPLOAD_BUYOUT_MAPPER, UPLOAD_BUYOUT_MAPPER_MASTER
- To-FPM mapping sheets: ASSET_BASE_TO_FPM, INVESTMENT_TO_FPM, DERIVATIVE_TO_FPM (sources: STG_INVESTMENT_BASE, RECP.DERIVATIVE_CANCELLED)
- FCT_PRODUCT_MASTER itself, and FPM_DA_RULES (Derived Attribute rules that run on FPM, incl. NPA_ID)

OUT of scope (downstream, per instruction): FCT_NPA_PRODUCT, FCT_NPA_PROVISION, FCT_PRODUCT_MASTER_AGG, FCT_SMA_EVALUATION, Recp_NPA_Details, and the diagram boxes after FCT_PRODUCT_MASTER (DD/DA/SMA triggers, provision, RDM, reports, user MOC, reverse feed).
Borderline, flagged for the user: `DI_WORKFLOWS` (index says 8 workflows / 14 mappings but the sheet body contains only a title and a banner - no rows), `INVESTMENT_TO_FPM` also covers Recp_Customer issuer data.

## 3. Key tables (facts verified in workbook)

| Table | Layer | Cols | Rows in DB | Notes |
|---|---|---|---|---|
| STG_ASSET_BASE | STAGING | 177 (index) | 840,427 | Six account feeds (Finacle, FIS, VisionPlus, ECBF, EIFS, MetaGrid); sheet lists one row per source per column. 208 CrisMac columns unmapped. |
| STG_BILLS | STAGING | 29 | 9,206 | Finacle 2,198 + SCF 7,008. PK (PERIOD_ID, DATA_SOURCE_ID, BILL_NUMBER). |
| STG_PC | STAGING | 15 | 384 | Packing credit. PK (PERIOD_ID, DATA_SOURCE_ID, PRODUCT_INSTANCE_BKEY, EXT_LOAN_REFERENCE). |
| STG_TRANSACTIONS | STAGING | 14 | 368,364 | PK (..., TRANSACTION_REFERENCE, PART_TRAN_SRL_NUM). Feeds CUR_QTR_CREDIT / CUR_QTR_INT. |
| STG_INVESTMENT_BASE | STAGING | 34 | 0 (index) / 215 per banner | Index and banner disagree - see gaps. |
| STG_UNIFIED_CUSTOMER | STAGING | 11 | 630,647 | Mirrors FCT_UNIFIED_CUSTOMER (573,654). |
| STG_BUYOUT_HIST | STAGING | 6 | 0 | |
| FCT_COLLATERAL | MART | 53 | 466,869 | Grain (PERIOD, COLLATERAL, ACCOUNT). MARKET_VALUE must not be summed. |
| FCT_COLLATERAL_PRODUCT_LINK | MART | 45 | 458,420 | No PK (open item). |
| FCT_UNIFIED_CUSTOMER | MART | 11 | 573,654 | 7 sources incl. CALYPSO. |
| FCT_CURRENCY_RATE | MART | 15 | 0 | Feed empty; FX falls back to 1. |
| FCT_BILLS / FCT_PC / FCT_TRANSACTION | MART | 30 / 15 / 14 | 0 | Created 2026-11-12 |
| FCT_BUYOUT_DETAIL | MART | 15 | 0 | SCD2, PK (PRODUCT_INSTANCE_ID, RECORD_START_DATE) |
| FCT_RESTRUCTURE_DETAIL | MART | 43 | 0 | SCD2, same PK shape |
| FCT_PUI_DETAIL | MART | 43 | 0 | SCD2, same PK shape |
| ACCOUNT_EXCEPTION_STATUS | MART | 7 | 9 | PK (SL_NO, PRODUCT_INSTANCE_ID) |
| FCT_PRODUCT_MASTER | MART | 186 | 0 | PK (PERIOD_ID, DATA_SOURCE_ID?, PRODUCT_INSTANCE_ID, SYSTEM_IDENTIFIER) - see gaps. Fed by 3 branches (accounts, INV_, DER_) unioned in one insert. |

FCT_PRODUCT_MASTER feeds (from banners): ASSET_BASE_TO_FPM (163 mapped columns), INVESTMENT_TO_FPM (48), DERIVATIVE_TO_FPM (28). Also joins E_TRAQ_TXN_ACCOUNT_DATA, E_TRAQ_BILL_OVERDUE_ACCOUNT_DATA, E_TRAQ_PC_OVERDUE_ACCOUNT_DATA, FCT_BUYOUT_DETAIL (PREFIX BUY_).

Dimensions in DB (index): DIM_COLLATERAL_TYPE (8 rows), DIM_CONF_PARAM (72), DIM_CURRENCY (7), DIM_CUSTOMER (0), DIM_DATA_SOURCE (9), DIM_INDUSTRY (230), DIM_NPA_ACTION (7), DIM_PRIORITY_SECTOR (39), DIM_PRODUCT_TYPE (569), DIM_SERVICE_OUTLET (660), DIM_SMA_GROUPING (4), DIM_SOLUTION (1), DIM_SOLUTION_TYPE (1), DIM_STAGE_CLASSIFICATION (4), DIM_STD_PRODUCT_TYPE (5), DIM_TIME_BASIS (57). DH2.0 dictionary dims (no row counts): Dim_Activity, Dim_Area, Dim_Asset_Classification, Dim_Bank, Dim_Banking_Arrangement, Dim_Credit_Rating, Dim_Designation, Dim_Issuer_Category, Dim_Segment, Dim_Collateral_Sub_Type, Dim_User_Role.
Not in `DIM Tables` sheet but built in DB (sheet note row 1045): DIM_COLLATERAL_MASTER, DIM_PRODUCT_TYPE, DIM_RESTRUCTURE_TYPE.

## 4. Relationships documented (join keys)

- FCT_COLLATERAL.COLLATERAL_ID -> DIM_COLLATERAL_MASTER on COLLATERAL_BKEY = SECURITY_ID (-1 on miss)
- FCT_COLLATERAL.UNIFIED_CUSTOMER_ID -> FCT_UNIFIED_CUSTOMER on (PERIOD_ID, CHILD_CUSTOMER_BKEY = CUSTOMER_ID) AND CHILD_DATA_SOURCE_ID = 1
- FCT_PRODUCT_MASTER dimension lookups (ASSET_BASE_TO_FPM rows 147-152, all COALESCE(...,-1)): PRODUCT_TYPE_ID<-DIM_PRODUCT_TYPE, CURRENCY_ID<-DIM_CURRENCY, DATA_SOURCE_ID<-DIM_DATA_SOURCE (by name), SERVICE_OUTLET_ID<-DIM_SERVICE_OUTLET, NPA_STD_PRODUCT_TYPE_ID<-DIM_STD_PRODUCT_TYPE, PRIORITY_SECTOR_ID<-DIM_PRIORITY_SECTOR
- FCT_PRODUCT_MASTER.PRODUCT_INSTANCE_ID joins FCT_BILLS/FCT_PC/FCT_TRANSACTION/FCT_RESTRUCTURE_DETAIL/FCT_PUI_DETAIL/FCT_BUYOUT_DETAIL/ACCOUNT_EXCEPTION_STATUS on the same account key
- STG_BILLS / STG_PC product-instance keys from Finacle trade finance do NOT match STG_ASSET_BASE (documented caveat)
- UPLOAD_BUYOUT_MAPPER.ACCOUNTNOOFSELLER <-> STG_BUYOUT_HIST.VENDOR_ACCOUNT_NO; ACCOUNTNOINRBLHOSTSYSTEM -> FCT_BUYOUT_DETAIL.PRODUCT_INSTANCE_ID

## 5. Documented business logic available (no SQL text)

Logic exists only as prose/expressions in REMARK cells: DPD expressions (DATEDIFF forms) in ASSET_BASE_TO_FPM rows 17, 46, 48, 53, 109, 117, 137, 163-165; overdue-date overrides for bills / packing credit / buyout (rows 156-162); NPA_NORM = ASSET_CLASS_NORM+1 (91 when empty); FPM_DA_RULES (IS_DPD_BREACH, IS_PUI_NPA, IS_BLOCK_CODE, RESTRUCTURE_TYPE, IS_PREVIOUS_NPA, NPA_ID 17-row decision table); FCT_COLLATERAL effective-amount rules.

## 6. Gaps, inconsistencies and missing information (do not fabricate)

1. **No stored procedure / view SQL text exists in the workbook.** Only names are referenced: E_TRAQ_FCT_COLLATERAL, E_TRAQ_FCT_COLLATERAL_PRODUCT_LINK, E_TRAQ_FCT_UNIFIED_CUSTOMER, E_TRAQ_FCT_CURRENCY_RATE, E_TRAQ_TXN_ACCOUNT_DATA, E_TRAQ_BILL_OVERDUE_ACCOUNT_DATA, E_TRAQ_PC_OVERDUE_ACCOUNT_DATA, E_TRAQ_STG_<feed>, RECP.PRC_FCT_BUYOUT_DETAIL_LOAD, DI mappings (m_TRAQ_*_NPA_4X) and workflows. Agent 3 can only show documented logic fragments and these object names; procedure bodies must be marked "not provided".
2. No physical FK/PK catalogue. PKs are mentioned only in banners (FCT_BILLS, FCT_PC, FCT_TRANSACTION, FCT_BUYOUT_DETAIL, FCT_RESTRUCTURE_DETAIL, FCT_PUI_DETAIL, ACCOUNT_EXCEPTION_STATUS, FCT_COLLATERAL via text). FCT_COLLATERAL_PRODUCT_LINK has none. FCT_PRODUCT_MASTER PK is described elsewhere as 4 columns (PERIOD_ID, third=PRODUCT_INSTANCE_ID, fourth=SYSTEM_IDENTIFIER) - the exact list is not stated on its own sheet.
3. FCT_PRODUCT_MASTER sheet maps only 18 columns (the DPD/date ones); the real mapping to 160+ columns is on ASSET_BASE_TO_FPM. Index shows FCT_PRODUCT_MASTER mapped=18 and ASSET_BASE_TO_FPM mapped=163 - a model must merge both.
4. Row-count inconsistencies: Index shows STG_INVESTMENT_BASE 0 rows but its banner says 215; FCT_PRODUCT_MASTER 0 rows in DB (index) yet ASSET_BASE_TO_FPM cites run results on 840,427 accounts.
5. Recp_Collateral says 72 columns but 92 dictionary rows are listed (plus 8 unmapped).
6. DIM Tables banner says 384 tables / 4,208 columns / 35 mapped; the mapped block holds the first dimension set only; 349 CrisMac dimensions have no TRAQ target (pure CrisMac metadata, no column-level target).
7. TARGET COLLISIONS flagged in STG_ASSET_BASE (OUTSTANDING_CHARGES_AMT, OUTSTANDING_INTEREST_AMT, OUTSTANDING_PRINC_AMT, WRITE_OFF_AMT, WRITTEN_OFF_DATE for VisionPlus): unresolved ("one must win, be summed, or have its own column").
8. Unresolved decisions: DECISION columns blank in all "no TRAQ target" blocks (Recp_Collateral 8, Recp_Customer 25, Recp_Party 21, Recp_Securities 16, Recp_Joint_Account_Holding 2, STG_ASSET_BASE 208).
9. Open items stated by the bank: DIM_PRODUCT_TYPE not seeded for investment types; DIM_STD_PRODUCT_TYPE lacks INV / DER; CurrencyRateMaster empty; derivative CUSTID extract defect; CrisMac PRO.InvestmentDataProcessing / PRO.DerivativeDataProcessing not supplied; ACCOUNT_EXCEPTION_STATUS SL_NO and STATUSTYPE length needs confirmation; `confirmation required` on Recp_Joint_Account_Holding.
10. DI_WORKFLOWS sheet has no body rows.
11. Datatype notation is inconsistent: CrisMac uses SQL Server types (`varchar(30)`, `decimal(16,2)`), TRAQ uses Oracle types (`VARCHAR2(35)`, `NUMBER(21,3)`), staging feeds quote declared sizes that exceed target sizes (e.g., Finacle 50-char WriteOffFlag -> VARCHAR2(30)).
12. The workbook states no mapping confidence values; Agent 4 confidence must be derived by a documented heuristic or labelled mock.
13. Mixed casing (DIM_* vs Dim_*) refers to different things (MART live dims vs DH2.0 dictionary dims) and must not be merged.

## 7. Structured representation (planned)

Built in the browser by `src/domain/parse.ts` from `public/data/CrisMac_to_TRAQ_Combined.csv` (no extraction script). The `WorkbookModel` (see `src/types`) holds tables (with columns), mappings, unmapped-column decisions, Derived Attribute rules and decision-table rows, and sheet info. Every record carries `sheet` and `rowNo` for traceability. Section 6 is mirrored in `src/domain/constants.ts` (`KNOWN_GAPS`).
