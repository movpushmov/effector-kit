# @effector-kit/models

Dynamic models implementation in vanilla effector without core modifications. Define a model once, create many independent instances, and target them with a declarative lens API.

## Concepts

- **Contract** — describes the shape of an instance (which stores and events it has).
- **Model** — creates and manages instances, exposes a `lens` for targeting them.
- **Union** — a named map of models treated as a single discriminated collection.
- **Lens** — scoped view into a set of instances; accessed via `model.lens`, `ref.lens`, or `child.lens`. Filters and dispatches updates.
- **Ref** — context-bound pointer to a tracked subset of instances from a model or union.
- **Child** — an isolated copy of a model whose instances live inside a parent instance's context.

---

## API

### `define`

Helpers for declaring contract fields. `define.store` and `define.event` require a **type descriptor** as their first argument — either `define.static<T>()` for a concrete type or `define.generic<"Name">()` for a generic type parameter.

#### `define.static<T>()`

Declares a concrete type. Use as the first argument to `define.store` or `define.event`.

#### `define.generic<"Name">()`

Declares a named generic type parameter. The name becomes a key in the generics map, resolved when the contract factory is called.

#### `define.store(type, defaultValue)`

Declares a writable store field.

```ts
define.store(define.static<number>(), 0);
define.store(define.static<string>(), "");
define.store(define.static<boolean>(), false);
define.store(define.generic<"T">(), null); // type resolved at factory call
```

#### `define.event(type)`

Declares an event field.

```ts
define.event(define.static<void>());
define.event(define.static<string>());
define.event(define.generic<"Payload">());
```

#### `define.child(model)`

Contract field descriptor for embedding a child model (instances scoped to parent).

#### `define.ref(model)`

Contract field descriptor for referencing instances of another model.

---

### `contract(shape)`

Defines the data shape for a model. Returns a **factory function**. Call the factory to produce a contract — optionally passing generic types.

```ts
import { contract, define } from "@effector-kit/models";

const makeUserContract = contract({
  name: define.store(define.static<string>(), ""),
  age: define.store(define.static<number>(), 0),
  save: define.event(define.static<void>()),
});

// Concrete contract — call the factory
const userContract = makeUserContract();
```

**Generic contracts** — define reusable shapes where the type is supplied at call time:

```ts
const makeItemContract = contract({
  value: define.store(define.generic<"T">(), null),
  label: define.store(define.static<string>(), ""),
});

// Instantiate with a concrete generic
const numberItemContract = makeItemContract<{ T: number }>();
const stringItemContract = makeItemContract<{ T: string }>();
```

---

### `model({ contract, fn })`

Creates a model. The `fn` receives live Effector units built from the contract and returns the public API. Logic wired inside `fn` — via `sample`, etc. — runs independently per instance.

```ts
import { model, contract, define } from "@effector-kit/models";
import { sample } from "effector";

const makeCounterContract = contract({
  count: define.store(define.static<number>(), 0),
  increment: define.event(define.static<void>()),
  reset: define.event(define.static<void>()),
});

const counterModel = model({
  contract: makeCounterContract(),
  fn: ({ count, increment, reset }) => {
    sample({
      clock: increment,
      source: count,
      fn: (n) => n + 1,
      target: count,
    });
    sample({ clock: reset, fn: () => 0, target: count });
    return { count, increment, reset };
  },
});
```

**Returns** a `Model` with:

| Property     | Type                                        | Description               |
| ------------ | ------------------------------------------- | ------------------------- |
| `$instances` | `Store<Record<string, Data>>`               | All live instances        |
| `create`     | `EventCallable<{ id: string; data: Data }>` | Creates a new instance    |
| `delete`     | `EventCallable<string>`                     | Removes instance by id    |
| `lens`       | `Lens`                                      | Targeting API (see below) |

**Creating instances:**

```ts
counterModel.create({ id: "a", data: { count: 0 } });
counterModel.create({ id: "b", data: { count: 10 } });

counterModel.$instances.getState();
// { a: { count: 0 }, b: { count: 10 } }
```

**Removing instance:**

`delete` accepts an instance id and drops that key from `$instances`.

```ts
counterModel.delete("a");
```

**`model.static(data)`**

Builds a static (non-instance) API object from the model contract. Useful when you need a “plain” set of units shaped like the model API without creating/targeting instances.

```ts
// Using the same `counterModel` contract shape:
const counterModel = model({
  contract: contract({
    count: define.store(define.static<number>(), 0),
    increment: define.event(define.static<void>()),
    reset: define.event(define.static<void>()),
  })(),
  fn: ({ count, increment, reset }) => ({ count, increment, reset }),
});

const staticCounter = counterModel.static({ count: 5 });

staticCounter.count.getState(); // 5

// The returned object is fully typed from the model contract:
// - stores keep their value types
// - events keep their payload types
staticCounter.increment(); // EventCallable<void>
staticCounter.reset(); // EventCallable<void>
```

---

### `union(models)`

Creates a discriminated-union descriptor that groups multiple models under named keys. Always passed **inline** as the argument to `ref` — never stored in its own variable.

```ts
const r = ref(union({ counter: counterModel, flagged: flaggedModel }));
```

`is.union(x)` returns `true` for union values; `is.model(x)` returns `false`.

---

### Lens

Every model exposes a `.lens` that lets you target stores and events across instances without reading state imperatively.

#### `lens.<field>.target()`

Returns an `EventCallable` that, when triggered, dispatches the value into the matching field of all (or filtered) instances.

```ts
import { createEvent, sample } from "effector";

const setCount = createEvent<number>();

// update ALL instances
sample({ clock: setCount, target: counterModel.lens.count.target() });

// transform before dispatching
sample({
  clock: setCount,
  fn: (n) => n * 2,
  target: counterModel.lens.count.target(),
});
```

#### `lens.<field>.clock()`

Returns an `Event` that fires whenever the field updates inside any matched instance.

```ts
const anyCountChanged = counterModel.lens.count.clock();
anyCountChanged.watch((value) => console.log("count changed to", value));
```

#### `lens.where(predicate)`

Filters instances before applying an action. Chainable.

```ts
const trigger = createEvent<number>();
sample({
  clock: trigger,
  target: counterModel.lens.where(({ count }) => count > 5).count.target(),
});
```

#### `lens.first()` / `lens.last()`

Restricts the target to the first or last instance (after any `where` filters).

```ts
sample({ clock: trigger, target: counterModel.lens.first().count.target() });
sample({ clock: trigger, target: counterModel.lens.last().count.target() });
```

#### Chaining

```ts
counterModel.lens
  .where(({ count }) => count > 0)
  .first()
  .count.target();
```

#### `lens.delete()`

Returns an `EventCallable<void>`. When called, it removes every instance in the current lens selection by id:

```ts
const purgeZero = createEvent<void>();
sample({
  clock: purgeZero,
  target: counterModel.lens.where(({ count }) => count === 0).delete(),
});
```

---

### `ref(model)` and `ref(union)`

Tracks a subset of instance IDs. Every `ref` exposes a `.lens` — identical in API to `model.lens` for single-model refs, or a `UnionLens` for union refs — but its data source is restricted to the tracked IDs.

#### `ref(model)` — single model

```ts
const listModel = model({
  contract: listContract(),
  fn: (api) => {
    const selected = ref(counterModel);
    return {
      ...api,
      add: selected.add,
      remove: selected.remove,
      lens: selected.lens,
    };
  },
});
```

| Property | Type                      | Description                                                    |
| -------- | ------------------------- | -------------------------------------------------------------- |
| `add`    | `EventCallable<string>`   | Start tracking an instance ID                                  |
| `remove` | `EventCallable<string>`   | Stop tracking an instance ID                                   |
| `$ids`   | `StoreWritable<string[]>` | Currently tracked IDs                                          |
| `lens`   | `Lens<Model>`             | Lens over tracked instances; supports `where`, `first`, `last` |

#### `ref(union)` — union

```ts
const dashboardModel = model({
  contract: dashboardContract(),
  fn: (api) => {
    const selected = ref(
      union({ counter: counterModel, flagged: flaggedModel }),
    );
    return {
      ...api,
      add: selected.add,
      remove: selected.remove,
      lens: selected.lens,
    };
  },
});
```

| Property | Type                                                | Description                                                        |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `add`    | `{ [K in keys]: EventCallable<string> }`            | Start tracking an instance by variant                              |
| `remove` | `{ [K in keys]: EventCallable<string> }`            | Stop tracking an instance by variant                               |
| `$ids`   | `StoreWritable<Array<{ key: string; id: string }>>` | Tracked `{ key, id }` pairs                                        |
| `lens`   | `UnionLens`                                         | Lens over tracked instances; supports all union lens methods below |

#### Union lens — `ref(union).lens`

- **`.lens.only(...keys)`**: restrict variants (mutable chain)
- **`.lens.where(...)`**: filter instances (mutable chain). Use `ctx.match({ ... })` for variant-specific predicates.
- **`.lens.match({ ... })`**: build per-variant sub-lenses and merge their targets into one `EventCallable` (usable as a `sample` target).
- **`.lens.delete()`**: returns `EventCallable` that removes every instance in the current selection when called (usable as a `sample` target).

Examples for `.only(...)`:

```ts
// Only ONE key → `e` is that single entity type.
selected.lens.only("counter").where((e) => e.count > 0);
//            ^ e: { id: string; count: number; ... }

// Two (or more) keys → `e` is a discriminated union of those entity types.
selected.lens.only("counter", "flagged").where((e, _, ctx) => {
  // ctx.match only needs handlers for the active keys
  return (
    ctx!.match({
      counter: (x) => x.count > 0,
      flagged: (x) => x.score > 0,
    }) ?? false
  );
});

// 2–3 keys works the same way.
selected.lens.only("counter", "flagged", "other").where((e, _, ctx) => {
  return (
    ctx!.match({
      counter: () => true,
      flagged: () => true,
      other: () => true,
    }) ?? false
  );
});
```

Example `where((e, _, ctx) => ...)`:

```ts
selected.lens.where((e, _, ctx) => {
  // Variant-specific predicate without reading internal tags:
  const ok = ctx!.match({
    counter: (x) => x.count > 0,
    flagged: (x) => x.score > 0,
  });

  // If you need the internal namespaced key for a known union key + id:
  // (use union keys explicitly: "counter" | "flagged" | ...)
  const key = ctx!.uniqueId("counter", e.id);
  void key;

  return ok ?? false;
});
```

---

### `child(model)`

Creates an isolated copy of a model whose `$instances` store is scoped to a parent instance's context. Instances created on the child are invisible outside the parent's context.

```ts
import { model, contract, define, child } from "@effector-kit/models";

const makeItemContract = contract({
  value: define.store(define.static<number>(), 0),
});

const itemModel = model({
  contract: makeItemContract(),
  fn: ({ value }) => ({ value }),
});

const makeListContract = contract({
  name: define.store(define.static<string>(), ""),
});

const listModel = model({
  contract: makeListContract(),
  fn: ({ name }) => {
    const items = child(itemModel); // each listModel instance gets its own items
    return { name };
  },
});
```

The returned child is a full `Model` with its own `$instances`, `create`, and `lens`, isolated per parent instance.

> **`child()` vs `define.child()`** — `define.child(model)` is a contract field descriptor (used inside `contract({})`) while `child(model)` creates a live scoped model inside `fn`.

---

## Types

```ts
import type {
  Model, // the full model object
  ModelApi, // { [key]: Store | Event | Effect | ModelApi }
  ContractData, // inferred instance data shape from a contract
  ContractApi, // inferred unit shape from a contract
  Union, // return type of union()
  UnionMap, // { [key: string]: Model<any, any> }
  Ref, // return type of ref()
  Lens, // type of model.lens / ref.lens / child.lens
} from "@effector-kit/models";
```

---

## Union example

```ts
import { model, contract, define, union, ref } from "@effector-kit/models";
import { createEvent, sample } from "effector";

const counterModel = model({
  contract: contract({ count: define.store(define.static<number>(), 0) })(),
  fn: ({ count }) => ({ count }),
});

const flaggedModel = model({
  contract: contract({ score: define.store(define.static<number>(), 0) })(),
  fn: ({ score }) => ({ score }),
});

const dashboardModel = model({
  contract: contract({})(),
  fn: () => {
    const selected = ref(
      union({ counter: counterModel, flagged: flaggedModel }),
    );

    const bumpAll = createEvent<number>();
    const merged = selected.lens.match({
      counter: (sub) => sub.where((e) => e.count > 4).count.target(),
      flagged: (sub) => sub.where((e) => e.score < 3).score.target(),
    });
    sample({ clock: bumpAll, target: merged });

    return {
      add: selected.add,
      remove: selected.remove,
      bumpAll,
    };
  },
});

counterModel.create({ id: "c1", data: { count: 3 } });
counterModel.create({ id: "c2", data: { count: 8 } });
flaggedModel.create({ id: "f1", data: { score: 1 } });
flaggedModel.create({ id: "f2", data: { score: 10 } });

dashboardModel.create({ id: "dash1", data: {} });
```

---

## Full example

```ts
import { model, contract, define } from "@effector-kit/models";
import { createEvent, sample } from "effector";

const makeTodoContract = contract({
  text: define.store(define.static<string>(), ""),
  done: define.store(define.static<boolean>(), false),
  toggle: define.event(define.static<void>()),
});

const todoModel = model({
  contract: makeTodoContract(),
  fn: ({ done, toggle }) => {
    sample({ clock: toggle, source: done, fn: (d) => !d, target: done });
    return { done, toggle };
  },
});

// Create instances
todoModel.create({ id: "1", data: { text: "Buy milk", done: false } });
todoModel.create({ id: "2", data: { text: "Ship it", done: false } });

// Toggle all todos
const toggleAll = createEvent<void>();
sample({ clock: toggleAll, target: todoModel.lens.toggle.target() });

// Toggle only incomplete todos
const completeRemaining = createEvent<void>();
sample({
  clock: completeRemaining,
  target: todoModel.lens.where(({ done }) => !done).toggle.target(),
});
```
