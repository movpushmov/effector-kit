# Computation Priority (Effector)

Use this note when reviewing execution order, debugging race-like behavior, or deciding where side effects should live.

## Why It Matters

Effector runs graph work by priority to keep dataflow deterministic. Pure computation should complete before side effects observe results.

## Priority Order

1. `child` -> `forward`
2. `pure` -> `map`, `.on`
3. `sampler` -> `sample`, `guard`, `combine`
4. `effect` -> `.watch`, effect handlers

Implications:
- `sample`/`guard`/`combine` run before `.watch`.
- Side effects in pure stages can break consistency expectations.

## Practical Rules

- Keep `map` and store reducers (`.on`) pure.
- Do not put side effects in pure transforms or in pure `fn` mapping.
- Use `sample` for sequencing instead of relying on watcher timing.
- Keep `.watch` mostly for debugging/observability and non-critical reactions.

## Review Add-on

- Are there side effects inside `map`, `.on`, or other pure transforms?
- Is sequencing encoded declaratively (`sample`) instead of watcher order?
- Do effect/watch handlers observe the final state after pure and sampler stages?

## Source

- https://effector.dev/en/explanation/computation-priority/
