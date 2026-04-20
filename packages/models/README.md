# @effector-kit/models

Dynamic models on top of Effector.

The package gives you:

- `contract(...)` to describe instance shape
- `model(...)` to create a reusable model
- `model.create` / `model.delete` to manage instances
- `model.static(data)` to build plain API units without instance lifecycle
- `model.lens` to target existing instances declaratively
- `ref(...)` to track external instances from a parent model
- `child(...)` to create child collections scoped to a parent instance
- `union(...)` to work with several models as one collection

## Installation

```bash
pnpm add @effector-kit/models effector effector-action
```

## Basic example

```ts
import { createEvent, sample } from "effector";
import {
  contract,
  define,
  model,
  type TNumber,
  type TString,
} from "@effector-kit/models";

const todoModel = model({
  contract: contract({
    title: define.store(define.schema<TString>(), ""),
    done: define.store(define.schema<TNumber>(), 0),
  })(),
  fn: ({ title, done }) => {
    const rename = createEvent<string>();
    const setDone = createEvent<number>();

    sample({
      clock: rename,
      target: title,
    });

    sample({
      clock: setDone,
      target: done,
    });

    return {
      title,
      done,
      rename,
      setDone,
    };
  },
});

todoModel.create({
  id: "a",
  data: {
    title: "Write docs",
    done: 0,
  },
});
```

## Type schema

Contracts use `define.schema<T>()`.

```ts
import {
  define,
  type TBoolean,
  type TNumber,
  type TRef,
  type TString,
} from "@effector-kit/models";

define.store(define.schema<TString>(), "");
define.store(define.schema<TNumber>(), 0);
define.store(define.schema<TBoolean>(), false);
define.event(define.schema<TRef<"Payload">>());
```

Common exported schema helpers:

- `TString`
- `TNumber`
- `TBoolean`
- `TVoid`
- `TRef<"...">` for contract generics
- `TArray`, `TObject`, `TRecord`, `TUnion`, `TIntersect`, `TEnum`

## `contract(shape)`

`contract(...)` returns a factory.

```ts
const makeCounterContract = contract({
  count: define.store(define.schema<TNumber>(), 0),
});

const counterContract = makeCounterContract();
```

Generic contracts are supported through `TRef<"...">`.

```ts
const makeValueContract = contract({
  value: define.store(define.schema<TRef<"Value">>(), "" as never),
  change: define.event(define.schema<TRef<"Value">>()),
});

const stringValueContract = makeValueContract<{ Value: string }>();
```

## `model({ contract, fn })`

`model(...)` creates a reusable model definition.

`fn` receives Effector units created from the contract and returns the public API of the model.

```ts
const counterModel = model({
  contract: contract({
    count: define.store(define.schema<TNumber>(), 0),
  })(),
  fn: ({ count }) => {
    const setCount = createEvent<number>();

    sample({
      clock: setCount,
      target: count,
    });

    return {
      count,
      setCount,
    };
  },
});
```

The returned model has:

- `$instances`
- `create`
- `delete`
- `lens`
- `static(data)`

### Creating and deleting instances

```ts
counterModel.create({ id: "a", data: { count: 1 } });
counterModel.create([
  { id: "b", data: { count: 2 } },
  { id: "c", data: { count: 3 } },
]);

counterModel.delete("a");
counterModel.delete(["b", "c"]);
```

### `model.static(data)`

Creates plain Effector units shaped like the model API, but not attached to instance lifecycle.

```ts
const api = counterModel.static({ count: 10 });

api.count.getState(); // 10
api.setCount(20);
```

## Lens API

Every model has `model.lens`.

Use it to target existing instances without reading `$instances` imperatively.

Lens access is recursive.
If your model API contains nested plain objects with stores, events, or nested models,
the same shape is available through `model.lens`.

### `lens.field.target()`

Dispatches to all matched instances.

```ts
const setAll = createEvent<number>();

sample({
  clock: setAll,
  target: counterModel.lens.count.target(),
});
```

### `lens.field.clock()`

Watches updates from matched instances.

```ts
counterModel.lens.count.clock().watch((value) => {
  console.log(value);
});
```

This also works for nested plain objects returned from `model(...)`.

```ts
import { createEvent, createStore, sample } from "effector";
import { contract, define, model, type TString } from "@effector-kit/models";

const settingsModel = model({
  contract: contract({
    title: define.store(define.schema<TString>(), ""),
  })(),
  fn: ({ title }) => {
    const opened = createStore(false);
    const toggle = createEvent<void>();

    sample({
      clock: toggle,
      fn: (value) => !value,
      source: opened,
      target: opened,
    });

    return {
      title,
      panel: {
        opened,
        toggle,
      },
    };
  },
});

settingsModel.lens.panel.opened.clock().watch((value) => {
  console.log(value);
});

sample({
  clock: createEvent<void>(),
  target: settingsModel.lens.panel.toggle.target(),
});
```

### `lens.where(...)`

Filters instances.

```ts
counterModel.lens.where((entity) => entity.count > 0).count.target();
```

For a regular model lens, `where(...)` receives the current entity data plus `id`.

```ts
counterModel.lens.where((entity) => entity.id === "a").count.target();
```

For a union lens, `where(...)` receives union entity data plus `id`.

In practice, variant branching should usually go through `ctx.match(...)`, while the entity itself contains the fields of the current variant.

Union `where(...)` also exposes `ctx` helpers:

- `ctx.match(...)` for variant-specific branching
- `ctx.uniqueId(variantKey, id)` for namespaced identity checks

```ts
selection.lens.where((entity, _, ctx) =>
  ctx.match({
    counter: (counter) => counter.count > 0,
    flagged: (flagged) => flagged.score > 0,
  }),
);
```

```ts
selection.lens.where((entity, _, ctx) => {
  return entity.id === ctx.uniqueId("counter", "a");
});
```

### `lens.ids(...)`

Filters instances by explicit ids.

For regular model lenses, pass instance ids directly:

```ts
counterModel.lens.ids("a").count.target();
counterModel.lens.ids("a", "c").count.target();
```

For union lenses, pass namespaced ids created with `uniqueId(...)`:

```ts
selection.lens
  .ids(
    selection.lens.uniqueId("counter", "a"),
    selection.lens.uniqueId("flagged", "f1"),
  )
  .match({
    counter: (counter) => counter.count.target(),
    flagged: (flagged) => flagged.score.target(),
  });
```

### `lens.first()` / `lens.last()` / `lens.single()`

Restricts the selection to one matched instance.

```ts
counterModel.lens.first().count.target();
counterModel.lens.last().count.target();
counterModel.lens.ids("a").single().count.target();
```

`single()` is useful when your code expects one concrete instance from an
already narrowed selection.
React bindings use this marker so `useModel(model, lens.single())` returns
`entity | undefined` instead of an array.

### `lens.delete()`

Deletes all currently matched instances.

```ts
counterModel.lens.where((entity) => entity.count === 0).delete();
```

### `lens.only(...)`

`only(...)` exists on union lenses.

It narrows the active set of variants before you access variant-specific API.

```ts
selection.lens.only("counter").counter.count.target();
```

This is useful when you want to keep working with one branch of a union without writing a full `match(...)`.

### `lens.match(...)`

`match(...)` exists on union lenses.

It lets you route one action to different sub-lenses for different variants.

```ts
selection.lens.match({
  counter: (counter) => counter.count.target(),
  flagged: (flagged) => flagged.score.target(),
});
```

You can use additional filters inside each branch, and those predicates stay isolated per branch.

```ts
selection.lens.match({
  counter: (counter) =>
    counter.where((entity) => entity.count > 0).count.target(),
  flagged: (flagged) =>
    flagged.where((entity) => entity.score > 0).score.target(),
});
```

## `ref(model)` and `ref(union(...))`

`ref(...)` creates a tracked selection inside a parent model.

```ts
const dashboardModel = model({
  contract: contract({
    name: define.store(define.schema<TString>(), ""),
  })(),
  fn: ({ name }) => {
    const selected = ref(counterModel);

    const track = createEvent<string>();
    const untrack = createEvent<string>();
    const setSelectedCount = createEvent<number>();

    sample({
      clock: track,
      target: selected.add,
    });

    sample({
      clock: untrack,
      target: selected.remove,
    });

    sample({
      clock: setSelectedCount,
      target: selected.lens.count.target(),
    });

    return {
      name,
      selected,
      track,
      untrack,
      setSelectedCount,
    };
  },
});
```

For a regular model ref:

- `selected.add(id)`
- `selected.remove(id)`
- `selected.$ids`
- `selected.lens`

For a union ref:

- `selected.add.counter(id)`
- `selected.remove.counter(id)`
- `selected.add.flagged(id)`
- `selected.remove.flagged(id)`
- `selected.$ids`
- `selected.lens`

## `child(model)`

`child(...)` creates a child model whose instances live inside the current parent instance.

```ts
const itemModel = model({
  contract: contract({
    value: define.store(define.schema<TNumber>(), 0),
  })(),
  fn: ({ value }) => {
    const setValue = createEvent<number>();

    sample({
      clock: setValue,
      target: value,
    });

    return {
      value,
      setValue,
    };
  },
});

const listModel = model({
  contract: contract({
    title: define.store(define.schema<TString>(), ""),
  })(),
  fn: ({ title }) => {
    const items = child(itemModel);
    const createItem = createEvent<{ id: string; data: { value: number } }>();

    sample({
      clock: createItem,
      target: items.create,
    });

    return {
      title,
      items,
      createItem,
    };
  },
});
```

Important behavior:

- child instances exist only inside parent context
- different parent instances get isolated child collections
- `items.lens...` works the same way as normal model lenses

## `union(models)`

`union(...)` groups several models under named keys.

```ts
const selection = ref(
  union({
    counter: counterModel,
    flagged: flaggedModel,
  }),
);
```

Union lenses support:

- `only(...)`
- `ids(...)`
- `where(...)`
- `first()`
- `last()`
- `single()`
- `delete()`
- `match(...)`

`match(...)` is available both on direct union lenses and on `ref(union(...)).lens`.

Example:

```ts
selection.lens.match({
  counter: (counter) => counter.count.target(),
  flagged: (flagged) => flagged.score.target(),
});
```

## Runtime helpers

### `is`

Runtime kind guards:

- `is.contract(value)`
- `is.model(value)`
- `is.union(value)`
- `is.ref(value)`

### `withInstanceContext`

Low-level helper exported from the package runtime. Most users do not need it directly.

## Scope-safe testing

The package is designed to work with Effector scopes.

Typical flow in tests:

```ts
import { allSettled, fork } from "effector";

const scope = fork();

await allSettled(counterModel.create, {
  scope,
  params: { id: "a", data: { count: 1 } },
});

await allSettled(counterModel.lens.count.target(), {
  scope,
  params: 10,
});

expect(scope.getState(counterModel.$instances)).toMatchObject({
  a: { count: 10 },
});
```
