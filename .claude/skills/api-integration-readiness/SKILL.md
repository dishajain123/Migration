---
name: api-integration-readiness
description: Keep the frontend backend-ready (FastAPI + Pydantic + LLMs). Use when adding services or models.
---
- One service interface per agent; mock and http implementations interchangeable via factory.
- All responses use `ApiResult<T> = {data, meta:{simulated, provider?, model?, requestId, latencyMs}, error?}`.
- Types mirror docs/API_CONTRACTS.md so Pydantic models map 1:1.
- Endpoints configured via `VITE_API_BASE_URL`; no provider-specific code in UI. Support cancellation and streaming-ready signatures.
