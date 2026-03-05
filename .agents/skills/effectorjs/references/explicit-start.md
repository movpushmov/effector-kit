# Explicit App Start (Effector)

## 1. Principle

- Do not run business startup logic at module import time.
- Define an explicit start event (usually `appStarted`) and wire initialization through declarative links.
- Keep unit creation static, but trigger runtime processes only from explicit entrypoints.

## 2. Why It Matters Beyond SSR

- SPA: deterministic app bootstrap and no hidden side effects from imports.
- Tests: controlled startup via `allSettled(appStarted, { scope })`.
- SSR: same startup contract works per request scope.
- Tooling: safer code splitting and lazy loading because imports stay pure.

## 3. Canonical Model

```ts
import { createEvent, createEffect, sample } from 'effector';

export const appStarted = createEvent();
export const pageOpened = createEvent<{ id: string }>();

export const loadSessionFx = createEffect(async () => api.session.load());
export const loadPageFx = createEffect(async ({ id }: { id: string }) => api.page.get(id));

sample({
  clock: appStarted,
  target: loadSessionFx,
});

sample({
  clock: pageOpened,
  target: loadPageFx,
});
```

## 4. Entrypoint Patterns

SPA entry:

```ts
const scope = fork();
await allSettled(appStarted, { scope });
```

Test entry:

```ts
const scope = fork();
await allSettled(appStarted, { scope });
```

SSR entry:

```ts
const scope = fork();
await allSettled(appStarted, { scope });
```

## 5. Review Checklist

- Startup happens via explicit event(s), not import-time calls.
- No hidden imperative `event()`/`effect()` calls in module top-level runtime paths.
- Entry layers (SPA/test/SSR) use the same startup contract.
- `allSettled` is used when deterministic startup completion is required.
