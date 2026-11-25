import type { PlatformTopic } from '@/types';

/**
 * Hand-written usage guide for this application. It describes the UI only (no workbook facts), and is the single
 * place to update when screens change. Retrieved by the guidance chatbot like any other knowledge source.
 */
export const PLATFORM_GUIDE: PlatformTopic[] = [
  {
    id: 'overview', title: 'Getting started with the platform', route: '/',
    keywords: ['start', 'begin', 'overview', 'workflow', 'order', 'how to use', 'platform', 'navigate', 'first time', 'new user'],
    text: [
      '**Getting started** - the sidebar has the Dashboard and five agent screens. A sensible order:',
      '- 1 Data Model: browse tables, columns, relationships and the workbook scope and gaps.',
      '- 2 Data Flow & Lineage: see how tables feed each other and trace a column.',
      '- 3 Procedure Analyzer: see which procedures, views and DI mappings the workbook references.',
      '- 4 Mapping Engine: review mappings, handle unmapped columns, approve or reject suggestions.',
      '- 5 Rules & Validation: approve business rules and run validation checks.',
      'The Dashboard summarises all of it. Anything labelled **Simulated** is not workbook data.',
    ].join('\n'),
  },
  {
    id: 'dashboard', title: 'Dashboard', route: '/',
    keywords: ['dashboard', 'readiness', 'coverage', 'summary', 'home', 'score', 'progress'],
    text: [
      '**Dashboard** - totals for tables in scope, mappings, column coverage, procedures, rules and validation, plus a readiness score.',
      '- Readiness = 50% column coverage + 30% validation pass rate + 20% review completion. It is a simple formula, not an AI score.',
      '- Workflow cards link to each agent screen and show how many reviews are done (kept in your browser).',
    ].join('\n'),
  },
  {
    id: 'data-model', title: 'Data Model screen', route: '/data-model',
    keywords: ['data model', 'tables', 'columns', 'relationships', 'compare', 'scope', 'export', 'metadata', 'json', 'download'],
    text: [
      '**1 Data Model** has four tabs: Table detail, Relationships, Source vs target, and Scope & gaps.',
      '- Pick a table to see its columns, types, nullability, and which mappings feed each column. It links to Lineage and Mapping for that table.',
      '- Relationships are derived from LOOKUP/JOIN mappings; the workbook has no physical foreign-key list.',
      '- Scope & gaps lists the in-scope sheets and known workbook gaps, and can download the extracted metadata as JSON.',
    ].join('\n'),
  },
  {
    id: 'lineage', title: 'Data Flow & Lineage screen', route: '/lineage',
    keywords: ['lineage', 'graph', 'flow', 'trace', 'column lineage', 'upstream', 'downstream', 'diagram', 'react flow'],
    text: [
      '**2 Data Flow & Lineage** draws tables as boxes with their columns, connected by arrows for each documented column mapping.',
      '- Pick tables in the list at the top (search, filter by layer or system). The large diagram sits below it, full width, with a Fullscreen button (top right of the diagram; Esc or Exit fullscreen to leave) that keeps your selection, options and details panel. The graph shows where each table gets its data (upstream) and where it goes (downstream); choose the direction and depth above the graph.',
      '- Solid grey arrows are direct copies (MAP TYPE DIRECT or RENAME); dashed purple arrows are transformations. Click an arrow to see source and target column, MAP TYPE and the remark text from the workbook.',
      '- Click a table to highlight its path (blue upstream, green downstream); click a column row to trace it hop by hop. Collapse or expand tables, use Auto-arrange, zoom, pan and the mini map.',
      '- Links from other screens open it with a table preselected. Reset returns to the default table.',
    ].join('\n'),
  },
  {
    id: 'procedures', title: 'Procedure Analyzer screen', route: '/procedures',
    keywords: ['procedure', 'procedures', 'sql', 'analyzer', 'views', 'expressions', 'business logic', 'stored procedure'],
    text: [
      '**3 Procedure Analyzer** has four tabs: Source procedures (SQL), Referenced objects, Documented expressions, and SQL analyzer.',
      '- Source procedures shows the 14 sample CrisMac procedures in execution order. For each: header and parameters, every statement with the IF/ELSE conditions and the expression assigned to each column, TRAQ traceability (written columns that match TRAQ columns, related FPM_DA_RULES rows), dated change comments, and the dd_export table when its CSV is present.',
      '- The workbook itself contains no SQL bodies, so Referenced objects lists the other objects by name with the text around each reference.',
      '- Documented expressions are shown verbatim from remark cells.',
      '- The SQL analyzer lets you paste SQL; it uses simple client-side pattern matching and is not AI. You can mark objects as analysed.',
    ].join('\n'),
  },
  {
    id: 'mapping', title: 'Mapping Engine screen', route: '/mapping',
    keywords: ['mapping', 'mapping engine', 'approve', 'reject', 'review', 'manual mapping', 'unmapped', 'ambiguous', 'confidence', 'suggestion'],
    text: [
      '**4 Mapping Engine** has three tabs: Documented mappings, Unmapped & ambiguous, and Manual mapping.',
      '- Choose a target table. Suggestions for unfed columns show a confidence %, which is a **Simulated** name/type heuristic (with workbook-learned abbreviations and remark / FPM_DA_RULES / procedure-SQL evidence), not an AI result. The % is calibrated: it is the share of held-out documented workbook mappings with a similar score that the engine got right (see docs/MAPPING_EVAL.md); when the workbook has too few documented mappings it falls back to the raw score and says so. Every suggestion is also checked against the schema by a deterministic validator.',
      '- Date keys: a numeric column named like a workbook calendar table key (for example TimeKey in SysDayMatrix) is compared to DATE columns as the date it stands for. The suggestion shows the lookup transformation and is flagged "Requires transformation"; it still needs human approval.',
      '- The "Unmapped & ambiguous" tab gives every unfed column one outcome: Resolved (a reviewer approved or manually mapped it), Suggested, Ambiguous, Found-but-rejected (a candidate failed the score or type check), No match, Insufficient context (nothing to compare) or Declared unmapped (the workbook says not fed). Click a row to see each candidate, its score parts and why it was accepted or rejected. The skill files in .claude/skills are developer guidance and are not loaded by the app.',
      '- To review a mapping: use the green tick to approve or the red cross to reject; the undo button resets it to pending.',
      '- Manual mapping lets you pick a source column for a target column yourself. Decisions are stored in your browser and feed validation check C7.',
      '- Optional "Profile & metadata" (Suggestions tab): load a JSON/CSV file with column descriptions, glossary terms, code value sets and data profiles (see docs/PROFILE_INPUT.md). It is NOT workbook data. It is kept in browser memory only, and suggestions it changes are tagged profile_enriched and are not calibrated. Sample values are sent to an AI model only if the file explicitly allows it. Without a file nothing changes.',
      '- Optional "semantic embeddings" button: sends this table\'s column names, types and profile descriptions to your OpenAI or Gemini embedding model and adds cosine similarity as a small signal. It only supports a match that already has name, workbook or profile evidence; matches it influences are tagged embedding_enriched.',
      '- "AI mapping proposals": the AI model sees the full candidate source schema (not just the top heuristic hits) and may propose columns with different names, several sources for one target, or one source for several targets. Every proposal is validated against the workbook schema (invented tables/columns and type clashes are discarded) and any transformation it suggests (cast, CASE lookup, concatenation) must be read back by the SQL parser. Survivors are labelled AI_DRAFT; none is applied until you approve it. The AI estimate is not calibrated.',
      '- "Bulk AI run" starts a background job on the gateway for many tables, shows progress, lets you cancel or retry failures, and validates each table\'s result when you open it. It never switches provider or model by itself.',
      '- Approvals and rejections are also stored by the gateway (server/.data/mapping-decisions.json). Approved ones become few-shot examples for the next AI run, rejected ones are passed as pairings not to propose again, and `npm run eval:mapping -- --decisions=...` compares the engine with them.',
    ].join('\n'),
  },
  {
    id: 'rules', title: 'Rules & Validation screen', route: '/rules',
    keywords: ['rules', 'validation', 'validate', 'approve rule', 'pass', 'warn', 'fail', 'checks', 'business rules'],
    text: [
      '**5 Rules & Validation** has three tabs: CrisMac SQL → TRAQ rules (opens first), Workbook rules and Validation.',
      '- Workbook rules are extracted from workbook cells (mandatory columns, constants, derivations, constraints) and from the sample procedure SQL (derivation rules for columns that match a TRAQ column, showing the SQL file and line). Each shows its source; approve or reject with the tick or cross.',
      '- Check C8 reports whether each sample procedure can be traced to the TRAQ model.',
      '- Validation runs deterministic checks C1-C7 and reports pass, warn or fail per table. Use Re-run validation after reviewing mappings.',
    ].join('\n'),
  },
  {
    id: 'rule-conversion', title: 'Converting CrisMac SQL procedures to TRAQ rules', route: '/rules?tab=convert',
    keywords: ['convert', 'conversion', 'migrate rules', 'rule migration', 'upload sql', 'sql file', 'dd_export', 'traq rule', 'excel', 'csv', 'derived attribute', 'translate', 'template', 'export rules'],
    text: [
      '**Agent 5 > CrisMac SQL → TRAQ rules** migrates business rules in five steps (the bar at the top shows progress):',
      '- 1 Upload SQL: drag .sql files in or browse (one stored procedure per file, up to 5 MB, UTF-8 or UTF-16), or use the 14 sample procedures. Each file shows its procedure name, status and a preview.',
      '- 2 Analyse: per procedure, the INSERT/UPDATE/MERGE statements, JOINs, WHERE and IF conditions, CASE expressions, tables read and written, and dependencies between procedures (Agent 3 parser, pattern matching, not AI).',
      '- 3 Map to TRAQ: every CrisMac column a rule writes or reads is replaced by its TRAQ column, from Agent 4 manual mappings and approved suggestions first, then workbook mappings, then a same-name TRAQ column (unconfirmed). Use Map to add a missing mapping; it is saved as an Agent 4 manual mapping. Settings give values or TRAQ expressions for procedure parameters. CrisMac runs on @TIMEKEY (a calendar key) while TRAQ runs on the run date BUSINESS_DATE: @ProcessDate/@ProcessingDate map to BUSINESS_DATE by default (every procedure sets them from SysDayMatrix at TimeKey = @TIMEKEY). @TIMEKEY itself is never turned into a date: the workbook has no SysDayMatrix rows, so a cut-off such as @TIMEKEY > 26267 stays a [[PARAM @TIMEKEY]] placeholder until you give it a known value in Settings. The Corrected rules tab (dd_export rules) converts @TIMEKEY only against CrisMac EffectiveFromTimeKey/EffectiveToTimeKey whose mapping is confirmed (RECORD_START_DATE/RECORD_END_DATE are compared with BUSINESS_DATE; a TRAQ column that kept the TimeKey format is compared with the entity\'s PERIOD_ID) and rewrites DATEDIFF(earlier, later, "DAY") to TRAQ\'s DATEDIFF(later, earlier, "d"). A "Names only" switch there keeps the CrisMac syntax and replaces only the names, for a side-by-side audit. Rules that still need a parameter or mapping are listed with the reason, grouped by the columns that block the most rules.',
      '- 4 Review: each rule shows the original SQL statements with line numbers, the composed CrisMac logic, the column mapping used, the translated TRAQ expression (editable), data type, effective date, issues and a Simulated confidence. Approve, reject or reset; Approve all (every pending rule that can be approved) and Approve selected (ticked rows) ask for a confirmation that shows how many rules can and cannot be approved and which mappings will be saved. Approving a rule also saves its verified CrisMac to TRAQ column mappings in Agent 4 automatically (marked "Saved from rule approval", linked to the rule); existing or documented mappings are reused, conflicts block the rule and nothing is overwritten. A rule with an unmapped, suggested or ambiguous column, or a [[...]] placeholder, cannot be approved and the reason is shown. Removing such a mapping in Agent 4 sends the rules that relied on it back to review. Export defaults to "Validated TRAQ rules only" (approved, every column confirmed); the Export menu gives the complete report with Ready/Pending status and the original CrisMac logic.',
      '- The tab "Corrected rules → TRAQ names" (/rules?tab=migrate) takes the corrected rules from the dd_export.csv files beside the sample procedures and replaces only the CrisMac names (Entity Name, Column Name, each quoted "Table"."Column") with confirmed TRAQ columns. Format, logic, literals, run parameters, explanation, dates, status and data type stay exactly as written. A rule with any column that has no confirmed mapping is kept in a separate "Needs a mapping first" list with its original text and is not in the ready file; the ready file never contains placeholder text. Both lists export as Excel, CSV, PDF or JSON.',
      '- 5 Export: choose the TRAQ layout (dd_export, the data-dictionary derivation format, or FPM_DA_RULES from the workbook), preview the exact rows and download CSV or Excel. Empty mandatory fields, [[...]] placeholders and duplicate target columns block the download. The conversion report (Excel, CSV, PDF, JSON) is always available.',
      '- Missing in TRAQ tab (/rules?tab=gaps): a separate, read-only list of the CrisMac columns used by the uploaded SQL rules that have no confirmed TRAQ column (no column, Simulated suggestion only, or ambiguous), with the rules each one blocks, the original CrisMac logic and the unresolved TRAQ expression. It maps nothing by itself; add the mapping in Agent 4 and the column drops off. Exportable. "Map the missing columns with AI" (top of the tab, needs an AI provider in AI Settings) asks the model to propose a TRAQ column for each missing one, using the rule logic, how the workbook already maps the same CrisMac table and only the in-scope TRAQ columns; invented columns, TRAQ-only columns, type-incompatible pairs and duplicates are dropped. The survivors are AI drafts with an AI estimate (not calibrated): tick the ones you accept and they are saved as Agent 4 manual mappings (labelled "AI draft, accepted by reviewer"). Rules still need approval in step 4, and @TIMEKEY cut-offs still need a value in Settings.',
      '- Statuses: Converted = all columns mapped through documented or approved mappings and no issues; Needs review = something needs a person; Failed = the CrisMac column has no TRAQ column.',
    ].join('\n'),
  },
  {
    id: 'simulated', title: 'What "Simulated" means', route: '/',
    keywords: ['simulated', 'mock', 'ai', 'fake', 'real', 'llm', 'chatbot', 'accurate', 'trust', 'model'],
    text: [
      '**Simulated** marks values that are not read from the workbook and not produced by an AI model: heuristic confidence percentages and template summaries.',
      '- Results badged **AI · provider · model** were written by the AI model you selected in AI Settings, from workbook-derived context only. Verify them against the cited sources.',
      '- Workbook-derived data is labelled "Workbook-derived". Missing facts are shown as "Not provided in workbook".',
    ].join('\n'),
  },
  {
    id: 'ai-settings', title: 'AI Settings, providers and models', route: '/ai-settings',
    keywords: ['ai settings', 'api key', 'provider', 'model', 'groq', 'openai', 'anthropic', 'claude', 'gemini', 'openrouter', 'ollama', 'key', 'switch', 'test connection', 'activate', 'login', 'log out', 'sign in'],
    text: [
      '**AI Settings** (sidebar) chooses the AI provider and model used by the five agents and this assistant. Supported: Groq, Google Gemini, OpenAI, Anthropic Claude, OpenRouter and Ollama (local).',
      '- Select a provider, paste its API key (or set it in the gateway server\'s environment), click **Test connection** to list its models, pick a model, then **Save & activate**.',
      '- Keys are stored encrypted on the gateway server and are never sent back to the browser. The active provider and model are shown at the top of this assistant.',
      '- Sign in and **Log out** are in the top bar. The login is a demo: any non-empty credentials are accepted.',
    ].join('\n'),
  },
  {
    id: 'rate-limit', title: 'Rate limit errors and switching model', route: '/ai-settings',
    keywords: ['rate limit', '429', 'too many requests', 'quota', 'retry', 'switch provider', 'switch model', 'billing', 'invalid key', 'error'],
    text: [
      'When a provider answers with a rate limit (HTTP 429) a dialog opens. Pick another provider and/or model and click **Retry**: the same question is sent again with your conversation preserved. Nothing switches without your choice.',
      '- Other failures show their own message instead: exhausted quota or billing, invalid key (401), permission denied (403), provider server error (5xx) and network failure.',
    ].join('\n'),
  },
  {
    id: 'sidebar-chat', title: 'Sidebar, theme and this assistant', route: '/',
    keywords: ['sidebar', 'collapse', 'expand', 'resize', 'drag', 'theme', 'dark mode', 'light mode', 'chat', 'assistant', 'help', 'suggested questions'],
    text: [
      '**Sidebar** - use the arrow button at the top to collapse it to icons (hover an icon for its name) or expand it. Drag its right edge to resize; dragging far left collapses it.',
      '- The Light/Dark button in the top bar switches theme.',
      '- **This assistant** is the round button at the bottom-right. It is an AI chatbot that answers from retrieved project knowledge and cites sources; answers stream in, and you can copy, regenerate or stop them. Drag the panel\'s top-left corner to resize it, or use the maximise button. History lasts for the browser tab session.',
    ].join('\n'),
  },
];
