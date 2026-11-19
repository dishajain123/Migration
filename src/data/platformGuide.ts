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
      '- Choose a target table. Suggestions for unfed columns show a confidence %, which is a **Simulated** name/type heuristic, not an AI result.',
      '- To review a mapping: use the green tick to approve or the red cross to reject; the undo button resets it to pending.',
      '- Manual mapping lets you pick a source column for a target column yourself. Decisions are stored in your browser and feed validation check C7.',
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
      '- 3 Map to TRAQ: every CrisMac column a rule writes or reads is replaced by its TRAQ column, from Agent 4 manual mappings and approved suggestions first, then workbook mappings, then a same-name TRAQ column (unconfirmed). Use Map to add a missing mapping; it is saved as an Agent 4 manual mapping. Settings give values or TRAQ expressions for procedure parameters such as @TIMEKEY and @ProcessDate.',
      '- 4 Review: each rule shows the original SQL statements with line numbers, the composed CrisMac logic, the column mapping used, the translated TRAQ expression (editable), data type, effective date, issues and a Simulated confidence. Approve, reject or reset; Approve clean rules approves every rule with no open issues after a confirmation.',
      '- 5 Export: choose the TRAQ layout (dd_export, the data-dictionary derivation format, or FPM_DA_RULES from the workbook), preview the exact rows and download CSV or Excel. Empty mandatory fields, [[...]] placeholders and duplicate target columns block the download. The conversion report (Excel, CSV, PDF, JSON) is always available.',
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
