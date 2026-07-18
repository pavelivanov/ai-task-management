# Plan 007: Add bounded AI suggestions, confirmations, and evaluations

> **Executor instructions**: The model proposes; deterministic services validate
> and execute. Never let provider output call repositories or lifecycle services
> directly. Run all tests/evals and update `plans/README.md`.
>
> **Drift check (run first)**: verify the MVP hash and inspect changes under
> `apps/api/src/modules/assistant`, `apps/web/src/features/assistant`, contracts,
> and Prisma. Plan 006 must be DONE and the deterministic E2E must pass without
> an LLM key before this plan starts.

## Status

- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH — model mistakes must not become unauthorized state changes
- **Depends on**: `plans/006-deterministic-web-review.md`
- **Category**: direction / security / tests
- **Planned at**: unborn `main`, 2026-07-18; MVP hash `3d915b09…d268`

## Why this matters

AI should reduce planning and task-clarification friction without becoming a
second, unreliable control plane. `MVP.md:389-466` requires strict structured
suggestions and deterministic acceptance; `MVP.md:507-620` names five MVP
capabilities; `MVP.md:661-716` requires action cards and confirmation. This plan
adds those bounded capabilities only after the product works without them.

## Current state

- Plans 003–006 own every state mutation and the deterministic regression suite.
- The assistant context must be limited to relevant overdue/due-soon/carryover,
  today's plan/current focus, preferences, recent outcomes, and a bounded backlog
  candidate list (`MVP.md:468-505`). Never send the full task database.
- Current OpenAI guidance supports strict Structured Outputs in the Responses
  API and JavaScript Zod helpers. It recommends structured `text.format` for
  schema-shaped responses, explicit refusal handling, and still treating
  semantically wrong structured content as possible. Reference:
  `https://developers.openai.com/api/docs/guides/structured-outputs`.
- The OpenAI adapter is the first provider, not the domain boundary. Model ID is
  configuration, not a value scattered through feature modules.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Unit/integration | `npm test --workspace apps/api` | assistant tests pass with fake provider |
| API integration | `npm run test:integration --workspace apps/api` | accept/reject/security pass |
| AI evals | `npm run eval:ai` | schema/reference/safety thresholds pass |
| Browser E2E | `npm run test:e2e -- --grep @assistant` | confirmation flows pass using fake provider |
| Full gate | `npm run verify && npm run test:e2e` | deterministic + assistant suites pass |

## Suggested executor toolkit

- Use `openai-docs` immediately before writing the OpenAI SDK adapter; API/model
  details are current and must not be recalled from memory.
- Use `find-docs` for current Zod and NestJS scheduling APIs.
- Keep a fake deterministic `LlmProvider` as the default in automated tests.

## Scope

**In scope**:

- Conversation/message, AI suggestion/job, prompt-version, and task block-reason
  schema/migrations.
- `packages/contracts/src/assistant/**` Zod schemas for context, five capability
  outputs, action cards, refusal/error states, and accept/reject commands.
- `apps/api/src/modules/assistant/**`, limited context builders, prompt templates,
  `LlmProvider`, OpenAI adapter, DB-backed async runner, and tests/evals.
- `apps/web/src/features/assistant/**` bounded chat and confirmation cards;
  Today/Inbox/Task/Review integration points.
- Versioned evaluation fixtures containing synthetic, non-sensitive data.

**Out of scope**:

- Autonomous writes, arbitrary tools/function calls, embeddings/vector DB,
  custom model training, web browsing, general knowledge chat, voice, attachments,
  weekly/bulk backlog review, notifications, and Redis/BullMQ.

## Git workflow

- Branch: `codex/007-ai-suggestions-evals`.
- Commit by infrastructure, each capability, confirmations, and evals. Example:
  `feat(assistant): validate structured planning suggestions`.
- Never commit API keys, raw personal prompts, or production response fixtures.

## Steps

### Step 1: Define provider-neutral schemas and persistence

Create Zod schemas and inferred types for:

- task extraction;
- daily-plan suggestion with coded warnings;
- task decomposition;
- carryover diagnosis with `BlockReason`;
- end-of-day outcome summary;
- assistant intent/action cards and refusal/unavailable states.

Model `Conversation`, `ConversationMessage`, and `AiSuggestion` with user owner,
type, status (`queued/running/completed/failed/accepted/rejected/expired`),
schema/prompt version, bounded input-context snapshot or hash, validated output,
provider/model metadata, usage, error code, retry/lease fields, timestamps, and
retention expiry. Store no hidden chain-of-thought. Raw prompts/responses must
not enter general logs.

**Verify**: schema tests reject unknown keys, invented task IDs/enums, oversized
content, and malformed/refusal states; migration tests enforce user ownership.

### Step 2: Implement limited context builders and semantic validators

Build one context query per capability. Select only bounded summaries needed by
`MVP.md:468-505`, with explicit limits/order and no conversation-wide database
dump. Tag every task reference with user and current version. After structural
parsing, semantically validate that referenced tasks belong to the user, remain
eligible/current, deadlines were not invented, role limits are explained, and
estimates are within configurable bounds.

**Verify**: tests seed large/multi-user datasets and prove bounded query output,
no foreign-user leakage, stable ordering, stale-reference rejection, and no
invented deadline acceptance.

### Step 3: Add the LLM provider boundary and OpenAI structured-output adapter

Define `LlmProvider.generateStructured({ schema, promptVersion, input,
timeout, idempotencyKey })` returning parsed data or typed refusal/timeout/error.
Implement a deterministic fake provider first. Then add the OpenAI Responses API
adapter using the official SDK's Zod structured-output helper and configured
model ID. Handle refusals, incomplete responses, timeout/cancellation, provider
rate limits, and retryable vs permanent errors. Application Zod/semantic
validation remains mandatory even when provider schema adherence succeeds.

Do not give the model task-mutating tools. Do not log prompt bodies. Add per-user
rate and concurrency limits before enabling real requests.

**Verify**: fake-provider contract suite passes for success/refusal/timeout/
malformed/stale cases. A manually gated real-provider smoke test may run only
when an operator supplies a key; CI never requires one.

### Step 4: Implement synchronous and durable asynchronous request flows

Use synchronous calls for task extraction, quick decomposition, and bounded chat
when latency is acceptable. For plan analysis and day summary, create a queued
`AiSuggestion`, return 202, and process it with a single-process scheduled worker
that claims rows atomically (`FOR UPDATE SKIP LOCKED` or equivalent), leases,
retries with limits, and recovers expired leases after restart. Emit SSE
`suggestion.changed` invalidations without content.

Keep this DB-backed runner behind an interface so BullMQ can replace it later.

**Verify**: integration tests cover duplicate/idempotent request, concurrent
workers claiming once, retry/backoff, expired lease recovery, cancellation, and
SSE completion. Do not use sleeps; inject clock/scheduler.

### Step 5: Implement the five capabilities without direct mutation

1. **Extraction**: user text → proposed tasks; saving multiple tasks requires
   confirmation.
2. **Plan suggestion**: eligible task IDs/roles/warnings/explanation; no schedule
   writes before acceptance.
3. **Decomposition**: proposed child tasks with estimates; parent relation is
   written only on acceptance.
4. **Carryover diagnosis**: one focused question and proposed structured block
   reason after threshold; no automatic status change.
5. **Outcome summary**: narrative strictly grounded in deterministic review
   metrics; accepted/completed output may populate `assistantSummary`.

Version prompt templates in code. Separate instructions from user data and make
untrusted task text clearly delimited data.

**Verify**: capability tests assert no domain rows change before acceptance and
outputs cannot reference ineligible/foreign tasks.

### Step 6: Add deterministic accept/edit/reject handlers

Each suggestion type has an explicit application handler. On accept, reload and
validate current user-owned resources/version, call the existing task/plan/review
service in a transaction, append `ai_suggestion_accepted`, and mark the
suggestion accepted. Edit validates the same contract before execution. Reject
records reason category without changing task data. Duplicate acceptance is
idempotent; stale suggestions return conflict with a refreshed path.

**Verify**: integration tests cover each type, edit, reject, duplicate retry,
stale state, cross-user IDs, partial-failure rollback, and exact audit events.

### Step 7: Build bounded assistant UI and confirmation cards

Add a task-system assistant surface supporting only create/update/find/reschedule,
plan/explain today, decompose, blocker diagnosis, and progress review. Render
typed action cards with Create/Apply, Edit, and Cancel. Integrate extraction in
quick capture, suggestion on Today, decomposition on task details, diagnosis on
carryover, and summary on Review. Clearly render loading, refusal, unavailable,
stale, and provider-offline states. The deterministic UI remains fully usable.

**Verify**: browser tests use the fake provider to prove no mutation occurs
before confirmation, edits are validated, stale suggestions recover, and all
screens work with assistant disabled.

### Step 8: Build the fixed evaluation suite

Create synthetic versioned fixtures matching `MVP.md:1313-1333`:

- 20 task-capture cases;
- 20 decomposition cases;
- 20 daily-plan cases;
- 10 carryover-diagnosis cases.

Score structural validity, valid/current task references, no invented deadlines,
estimate plausibility, useful decomposition, and zero unauthorized state changes.
Separate deterministic fake-provider CI gates from optional real-model evals.
Record model/prompt/schema versions and aggregate scores, never sensitive text.

**Verify**: `npm run eval:ai` runs offline in CI and fails on schema/reference/
unauthorized-mutation regressions; the optional live eval command is explicit
and cost-bearing.

## Test plan

- Contract/property tests for every Zod schema and semantic validator.
- Integration tests for context minimization, user scoping, async leasing,
  acceptance transactions, stale/idempotent flows, retention, and rate limits.
- Browser tests for all confirmation cards and disabled/refusal states.
- Fixed synthetic evaluation dataset with hard zero-tolerance gates for foreign
  references, invented deadlines accepted as fact, and pre-confirmation writes.

## Done criteria

- [ ] All five MVP AI capabilities exist behind structured contracts.
- [ ] No provider output can directly mutate persistence.
- [ ] Every write requires a typed accepted/edited suggestion and audit event.
- [ ] Context is bounded and cross-user leakage tests pass.
- [ ] Real provider is optional for tests and app remains usable when unavailable.
- [ ] Prompt bodies and raw sensitive responses are absent from general logs.
- [ ] `npm run eval:ai`, `npm run verify`, and assistant E2E pass.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- A provider/model lacks strict structured outputs or reliable refusal handling.
- Real API access is required to make CI deterministic.
- A capability requires model tools that directly execute application writes.
- Context minimization cannot satisfy a capability without sending unbounded data.
- Retention/deletion rules for stored prompt context remain undecided.
- Live model evals would spend money without explicit operator approval.

## Maintenance notes

Model and prompt changes require eval comparison and version bumps. Review any
new assistant action for confirmation, semantic validation, ownership checks,
audit events, and deterministic fallback. Redis/BullMQ is justified only when
the DB runner's measured reliability/throughput is insufficient.
