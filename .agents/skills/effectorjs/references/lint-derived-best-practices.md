# Lint-Derived Best Practices (eslint-plugin-effector)

## Source and Coverage

- Source repository: `../eslint-plugin` (`eslint-plugin-effector`).
- Coverage includes all presets: `recommended`, `react`, `scope`, `patronum`, and `future`.
- This document normalizes rule intent into practical modeling/review guidance.

## Naming Discipline

- Name stores with a clear `$` marker (default style: prefix, for example `$user`).
- Name effects with `Fx` suffix (for example `loadUserFx`).
- Name React gates in PascalCase like components (for example `UserPageGate`).
- Keep naming consistent per module to reduce refactor and review ambiguity.

## Declarative Dataflow Rules

- Prefer `sample` as the primary composition primitive.
- Replace legacy `forward` and `guard` flows with equivalent `sample` links.
- Do not use `$store.getState()` for business orchestration; pass state via `source`.
- Keep `.watch` for observability/debug and non-critical integration only.
- Keep options order readable and semantic: `clock -> source -> filter -> fn -> target`.
- Avoid ambiguous constructions where `target` is provided and result is assigned simultaneously.

## Structural Hygiene

- Do not register duplicate `.on(event, reducer)` handlers on the same store.
- Avoid duplicate units in array `clock` or `source`.
- Avoid repeating the same unit in both `clock` and `source` unless truly required; simplify when equivalent.
- Do not keep `sample`/`guard` calls without effect (must use `target` or captured returned unit).
- Avoid unnecessary `combine`/`merge` wrappers inside `clock`/`source` when array/object shorthand expresses the same intent.

## Scope and Effect Safety

- In effect handlers, avoid mixing nested effect calls with ad-hoc async primitives in the same chain.
- If an effect calls other effects, keep flow effect-only or isolate external async into dedicated effects.
- For `effector-storage` with scopes, require explicit `pickup` when persisting scoped state.
- Treat scope consistency as a first-class requirement for SSR/tests and parallel execution.

## React Integration Defaults

- Prefer `useUnit` over deprecated `useStore` and `useEvent`.
- In React components, bind events/effects with `useUnit` before passing to handlers.
- Avoid direct raw unit usage in JSX callbacks to preserve scope-safe behavior.

## Future-Leaning and Tooling Constraints

- Prefer factory APIs with `{ domain }` over `domain.createEvent/createStore/createEffect`.
- Remove `patronum/debug` usage from production-delivered code.
- Favor AST-tooling-friendly patterns that remain analyzable by linters and codemods.

## Migration Notes

1. Lock current behavior with tests first.
2. Replace orchestration anti-patterns (`watch`, `getState`, `forward`, `guard`) incrementally.
3. Normalize naming and structural issues (`Fx`, `$`, duplicates, option order).
4. Apply scope/react safety constraints (`useUnit`, strict effect chaining, pickup in persist).
5. Remove temporary debug and legacy constructs after parity confirmation.

## Delivery Checklist

- Naming conventions are consistent (`$store`, `effectFx`, Gate PascalCase).
- Dataflow is declarative with `sample`-first orchestration.
- No business `.watch` or `.getState()` flow.
- No duplicate `.on` handlers or duplicate units in `clock/source` arrays.
- `sample`/`guard` calls are meaningful and unambiguous.
- Scope-sensitive code respects strict effect and binding expectations.
- React integration uses `useUnit` as default.
- Legacy domain creators and debug leftovers are removed or explicitly marked.
