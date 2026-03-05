# Anti-Patterns and Fixes

## 1. Business Logic in watch

Anti-pattern:
- Side effects and branching in `.watch` callbacks.

Fix:
- Keep `.watch` for debugging only.
- Move side effects to effects and trigger with `sample`.

## 2. Imperative Calls Inside Effects

Anti-pattern:
- Effect handler imperatively calls events/effects to drive workflow.

Fix:
- Keep effect focused on I/O.
- Connect follow-up reactions via `sample({ clock: effect.doneData, ... })`.

## 3. getState for Business Dataflow

Anti-pattern:
- `$store.getState()` inside effects or handlers for domain logic.

Fix:
- Feed required data through `source` in `sample`.
- Build explicit params for target effect/event.

## 4. Complex Nested sample Chains

Anti-pattern:
- Deeply nested, hard-to-read `sample` composition.

Fix:
- Split into small named links.
- Prefer intermediate named events for readability.

## 5. Runtime Unit Creation

Anti-pattern:
- Creating stores/events/effects dynamically at runtime.

Fix:
- Initialize units statically at module scope.
- Use explicit model factories only when architecture requires them.

## 6. Oversized Stores

Anti-pattern:
- One object store containing unrelated domains.

Fix:
- Keep stores atomic.
- Compose with `combine` only where read models are needed.

## 7. Refactor Procedure

1. Preserve external behavior.
2. Introduce explicit events for hidden transitions.
3. Extract side effects into effects.
4. Rewire with `sample`/`attach`.
5. Add parity tests in forked scopes.
6. Remove legacy code after parity confirmation.

## 8. Startup at Import Time

Anti-pattern:
- Calling events/effects from module top-level code to start app processes.

Fix:
- Keep imports pure and initialization static.
- Add explicit `appStarted` event and wire startup with `sample`.
- Trigger startup from SPA/SSR/test entrypoint, not from model import.
