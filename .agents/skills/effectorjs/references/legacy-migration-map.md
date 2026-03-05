# Legacy Migration Map (to Effector v23+ defaults)

Use this map when codebase contains deprecated or legacy Effector patterns.

## 1. `forward` / `guard` legacy flows

Status:
- Keep as legacy-compatible if immediate migration is risky.
- Prefer modern declarative composition with `sample` (and `split` for branching).

Migration pattern:
1. Identify source/clock/filter/target semantics in legacy chain.
2. Re-express semantics with explicit `sample` links.
3. Add parity tests before removing legacy wiring.

## 2. `effector-react/scope` and compat-era imports

Status:
- Treat `effector-react/scope` as legacy.
- Prefer `effector-react` modern hooks and `Provider` from modern package.

Migration pattern:
1. Replace scope-specific imports with `effector-react` imports.
2. Migrate all related imports in one coherent pass to avoid mixed-provider runtime issues.
3. Validate with integration tests under forked scope.

## 3. `useStore` / `useEvent` old usage

Status:
- Legacy-friendly but not preferred.
- Prefer `useUnit` for stores and callable units.

Migration pattern:
1. Replace `useStore($x)` with `useUnit($x)`.
2. Replace `useEvent(x)` with `useUnit(x)` where appropriate.
3. Re-run UI tests to ensure handler identity and behavior remain stable.

## 4. Imperative orchestration inside effects

Status:
- Legacy anti-pattern.
- Prefer effect-as-IO and declarative links with `sample`.

Migration pattern:
1. Keep effect focused on request/response.
2. Move follow-up transitions to `sample({ clock: fx.doneData|fx.failData, ... })`.
3. Verify success/failure branches independently.

## 5. `$store.getState()` in business flow

Status:
- Legacy anti-pattern for model orchestration.

Migration pattern:
1. Move required state into `source` of `sample`.
2. Build explicit payload with `fn`.
3. Send to event/effect target.

## 6. Migration Safety Protocol

1. Freeze behavior with tests first.
2. Migrate one chain/module at a time.
3. Keep temporary adapters if needed.
4. Remove legacy code only after parity confirmation.
