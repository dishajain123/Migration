---
name: frontend-development
description: Build UI for the migration platform (React/TS/Vite/Tailwind/shadcn). Use when creating screens, components, stores, themes.
---
- Follow CLAUDE.md layers: types -> data -> services -> stores -> features -> components.
- No business logic in components; call services via hooks (`useAsync`) that expose `{status, data, error}`.
- Always render loading, error, empty and success states; label simulated output with a `<SimulatedBadge/>`.
- Theme with CSS variables (light/dark); use shadcn/ui primitives; Lucide icons; every button must do something.
- Charts: Recharts; graphs: React Flow. Large tables are virtualised/paginated (STG_ASSET_BASE lists 400+ rows).
- Before finishing: `npm run build`, `npm run lint`, click-test each control.
