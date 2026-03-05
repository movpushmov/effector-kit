# Checklists

## 1. Design Checklist (New Feature)

- Stores are atomic and named clearly.
- Events represent intents/facts.
- Effects isolate all async and side effects.
- Dataflow is declarative with `sample`/`attach`.
- `sample` targets writable units only (not derived stores).
- App bootstrap uses explicit start events (for example `appStarted`).
- No hidden reads via `getState`.
- Public model API is minimal.
- Terminology in solution matches Effector glossary (`unit`, `derived store`, `reducer`, `watcher`, `subscription`).

## 2. Refactor Checklist (Existing Code)

- Legacy behavior captured before changes.
- `watch` logic removed or justified for debug only.
- Side effects removed from pure computation (`map`, `.on`, pure transforms).
- Imperative in-effect orchestration replaced.
- Derived stores are not used as writable targets.
- Reducers (`.on`) return explicit next state and avoid accidental no-op by mutation.
- Scope-sensitive flows validated.
- Diff is split into safe incremental steps.

## 3. Scope + Startup Safety Checklist

- Startup logic is not executed at module import time.
- Scope boundaries are explicit for SPA/test/SSR entry layers.
- Deterministic preload uses `allSettled` where needed.
- SSR path uses `serialize` + fork hydration and correct `Provider`.
- No cross-run state leakage paths.

## 4. Review Checklist

- Potential regressions listed with severity.
- Deprecated patterns marked and migration path provided.
- Execution order assumptions validated against computation priority.
- Watchers/subscriptions are treated as observability/integration mechanics, not business orchestration.
- Domain hooks (`onCreate*`) are used only for infra-level cross-cutting concerns.
- Tests cover success/failure/branching paths.
- Parallel-test safety validated via forked scopes.

## 5. Acceptance Scenarios

### A. Model Design
- Given a feature request, output includes model topology + wiring snippets.

### B. Anti-Pattern Refactor
- Given logic in `watch` or `getState`, output provides declarative replacement.

### B1. Glossary Semantics
- Given model/dataflow review, output validates glossary semantics (common unit usage, derived store constraints, reducer purity/no-op behavior).

### C. SSR Scope
- Given SSR requirement, output includes request-scoped fork + serialization lifecycle.

### D. Explicit Start
- Given startup requirement, output includes explicit `appStarted` flow and entrypoint trigger strategy.

### E. React Integration
- Given React integration, output routes unit usage through `useUnit`.

### F. Solid Integration
- Given Solid integration, output routes unit usage through `useUnit` with correct accessor handling.

### G. Vue Integration
- Given Vue integration, output provides modern `effector-vue` integration guidance.

### H. Legacy Input
- Given legacy API usage/imports, output marks it as legacy and offers modern v23+ migration path.
