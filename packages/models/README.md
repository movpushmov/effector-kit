# @effector-kit/models

Dynamic models implementation in vanilla effector without core modifications. Define a model once, create many independent instances, and target them with a declarative lens API.

## Concepts

- **Contract** — describes the shape of an instance (which stores and events it has).
- **Model** — creates and manages instances, exposes a `lens` for targeting them.
- **Lens** — scoped view into a model's instances; filters and dispatches updates.
- **Ref** — context-bound pointer to a subset of instances from another model.
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
| `lens`       | `Lens`                                      | Targeting API (see below) |

**Creating instances:**

```ts
counterModel.create({ id: "a", data: { count: 0 } });
counterModel.create({ id: "b", data: { count: 10 } });

counterModel.$instances.getState();
// { a: { count: 0 }, b: { count: 10 } }
```

**Scope-safe (fork):**

```ts
const scope = fork();
await allSettled(counterModel.create, {
  scope,
  params: { id: "scoped", data: { count: 5 } },
});
scope.getState(counterModel.$instances); // { scoped: { count: 5 } }
```

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

---

### `ref(model)`

Creates a context-scoped reference that tracks a subset of a model's instance IDs. Used inside another model's `fn` to point to related instances. The ref's `lens.getSource()` returns only the tracked instances.

```ts
import { model, contract, define, ref } from "@effector-kit/models";

const makeItemContract = contract({
  label: define.store(define.static<string>(), ""),
});

const itemModel = model({
  contract: makeItemContract(),
  fn: ({ label }) => ({ label }),
});

const makeListContract = contract({
  title: define.store(define.static<string>(), ""),
});

const listModel = model({
  contract: makeListContract(),
  fn: ({ title }) => {
    const selectedItems = ref(itemModel); // scoped to this parent instance
    return { title };
  },
});
```

`ref` returns a `Ref` with a `lens` identical to the model lens, but `getSource()` is filtered to only the tracked IDs.

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
  Ref, // return type of ref()
  Lens, // return type of model.lens
} from "@effector-kit/models";
```

---

## Full example

```ts
import { model, contract, define } from "@effector-kit/models";
import { createEvent, sample, fork, allSettled } from "effector";

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

// Scope-safe usage
const scope = fork();
await allSettled(completeRemaining, { scope });
```
