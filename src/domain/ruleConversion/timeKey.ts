/*
 * CrisMac runs on TimeKey: an integer calendar key (SysDayMatrix: TimeKey int, Date datetime). TRAQ has no such key; it runs on
 * the period of the run, FCT_PRODUCT_MASTER.PERIOD_ID, and on the rule variable BUSINESS_DATE = TODATE(PERIOD_ID) ("the run
 * date", FPM_DA_RULES row 6). Every procedure defines `@ProcessDate = (SELECT Date FROM SysDayMatrix WHERE TimeKey = @TIMEKEY)`,
 * so @ProcessDate is BUSINESS_DATE.
 *
 * There is deliberately NO number-to-date conversion here: the workbook lists SysDayMatrix's columns but not its rows, so a CrisMac
 * cut-off such as `@TIMEKEY > 26267` cannot be turned into a TRAQ date without guessing a calendar. Such rules wait, with a note.
 */

/** TRAQ's run date: the rule variable BUSINESS_DATE (FPM_DA_RULES row 6, TODATE(PERIOD_ID)). `{ENTITY}` is the rule's TRAQ table. */
export const RUN_DATE_TEMPLATE = '"{ENTITY}"."var"."BUSINESS_DATE"';
/** The run's period column on the rule's TRAQ table, used where a TRAQ column kept CrisMac's TimeKey format. */
export const PERIOD_ID_TEMPLATE = '"{ENTITY}"."PERIOD_ID"';
export const PERIOD_ID_COLUMN = 'PERIOD_ID';
/** CrisMac run-date variables that mean the same day as TimeKey (each procedure DECLAREs them from SysDayMatrix). */
export const DEFAULT_PARAM_MAPPINGS: Record<string, string> = { '@PROCESSDATE': RUN_DATE_TEMPLATE, '@PROCESSINGDATE': RUN_DATE_TEMPLATE };

/** CrisMac's SCD2 validity columns, and TRAQ columns that kept them (e.g. UPLOAD_*.EFFECTIVEFROMTIMEKEY). */
export const TIMEKEY_COLUMN_RE = /EFFECTIVE_?(?:FROM|TO)_?TIMEKEY/i;

/** Comparison with its operands swapped: `5 < x` is `x > 5`. */
export const MIRROR: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=', '==': '==', '!=': '!=', '<>': '<>' };
