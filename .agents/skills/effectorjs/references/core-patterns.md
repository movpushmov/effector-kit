# Core Patterns (Effector v23+)

## 1. Model Topology

1. Keep stores atomic: one responsibility per store.
2. Use events for domain facts and user intents.
3. Use effects for all side effects and async boundaries.
4. Keep module-level static unit initialization.
5. Use explicit startup events (`appStarted`) for runtime bootstrap.

## 2. Recommended Dataflow

Use `sample` as default orchestration primitive.

```ts
sample({
  clock: formSubmitted,
  source: { form: $form, user: $user },
  filter: ({ form }) => form.isValid,
  fn: ({ form, user }) => ({ ...form, userId: user.id }),
  target: submitFormFx,
});
```

Prefer separate `sample` links instead of deeply nested chains.

## 3. Sequencing and Priority

- Treat `sample`/`guard` links as the main sequencing layer.
- Keep `map` and `.on` pure; do not run side effects there.
- Do not encode critical sequencing through `.watch`.

## 4. Effect Composition with attach

Use `attach` when an effect needs store-derived context or param mapping.

```ts
const submitWithSessionFx = attach({
  source: $session,
  effect: submitFormFx,
  mapParams: (form: FormData, session) => ({ form, token: session.token }),
});
```

## 5. Split for Branching

Use `split` when one stream dispatches into named cases.

```ts
const routes = split({
  source: messageReceived,
  match: {
    success: (msg) => msg.type === 'success',
    error: (msg) => msg.type === 'error',
  },
  cases: {
    success: handleSuccess,
    error: handleError,
    __: handleUnknown,
  },
});
```

## 6. Naming and Structure

- Stores: prefix `$`.
- Effects: postfix `Fx`.
- Events: past tense for facts when practical (`userLoaded`).
- Export minimal public API from each model module.

## 7. Minimal Design Template

```ts
import { createEvent, createStore, createEffect, sample } from 'effector';

export const pageOpened = createEvent();
export const retryClicked = createEvent();

export const loadItemsFx = createEffect(async () => api.items.list());

export const $items = createStore<Item[]>([])
  .on(loadItemsFx.doneData, (_, items) => items)
  .reset(loadItemsFx.fail);

export const $isLoading = loadItemsFx.pending;

sample({
  clock: [pageOpened, retryClicked],
  target: loadItemsFx,
});
```

## 8. Review Heuristics

- Can each unit be described in one sentence?
- Is async behavior isolated in effects?
- Is orchestration declarative (`sample`, `attach`, `split`)?
- Are there hidden dependencies or implicit reads?
- Is sequencing independent from watcher timing?
