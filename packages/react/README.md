# @effector-kit/react

React bindings for `@effector-kit/models`.

The package currently exports:

- `useModel`
- `component`

## Installation

```bash
pnpm add @effector-kit/react @effector-kit/models effector-react effector react
```

## `useModel`

`useModel` has two main modes and one created-model mode.

## 1. `useModel(model)`

Creates a managed instance on mount and deletes it on unmount.

```tsx
import { useModel } from "@effector-kit/react";

function CounterScreen() {
  const counter = useModel(counterModel);

  return (
    <button onClick={() => counter.setCount(counter.count + 1)} type="button">
      {counter.count}
    </button>
  );
}
```

You can also pass initial contract data:

```tsx
const counter = useModel(counterModel, {
  data: {
    count: 10,
  },
});
```

## 2. `useModel(model, lens)`

Returns already existing instances selected by the lens.

```tsx
function PositiveCounters() {
  const counters = useModel(
    counterModel,
    counterModel.lens.where((entity) => entity.count > 0),
  );

  return (
    <ul>
      {counters.map((counter) => (
        <li key={counter.id}>{counter.count}</li>
      ))}
    </ul>
  );
}
```

## Advanced: `useModel(createdModel)`

This mode works with the value returned by `Component.create(...)`.

The usual app-level paths are still:

- `useModel(model)`
- `useModel(model, lens)`
- `Component.create(...)` + `model` prop when one parent owns one child instance
- `child(Component.model)` when a parent owns multiple child instances

```tsx
const createdModel = Counter.create({ count: 5 });

function Page() {
  const counter = useModel(createdModel);

  return <div>{counter.count}</div>;
}
```

## What `useModel` returns

The hook resolves model API into React-friendly values:

- stores become plain values
- events and effects become callable functions
- `ref(...)` becomes an array of resolved entities
- `child(...)` becomes an array of resolved child entities

That means this works directly:

```tsx
function Dashboard() {
  const dashboard = useModel(dashboardModel, {
    data: { title: "Main" },
  });

  return (
    <div>
      <h1>{dashboard.title}</h1>
      <div>{dashboard.selected.map((item) => item.count).join(",")}</div>
      <button onClick={() => dashboard.track("counter-1")} type="button">
        Track
      </button>
    </div>
  );
}
```

## Scope support

`useModel` reads the current scope from `effector-react` `Provider`.

```tsx
import { Provider } from "effector-react";
import { fork } from "effector";

const scope = fork();

root.render(
  <Provider value={scope}>
    <App />
  </Provider>,
);
```

## `component(...)`

`component(...)` creates a React component on top of an `@effector-kit/models` model.

```tsx
import { createEvent, sample } from "effector";
import { component } from "@effector-kit/react";
import { contract, define, type TNumber } from "@effector-kit/models";

const Counter = component({
  contract: contract({
    count: define.store(define.schema<TNumber>(), 0),
  })(),
  model: ({ count }, mounted, unmounted) => {
    const setCount = createEvent<number>();

    sample({
      clock: setCount,
      target: count,
    });

    mounted.watch(() => {
      console.log("mounted");
    });

    unmounted.watch(() => {
      console.log("unmounted");
    });

    return {
      count,
      setCount,
    };
  },
  view: ({ id, count, onSetCount }) => (
    <button onClick={() => onSetCount(count + 1)} type="button">
      {id}:{count}
    </button>
  ),
});
```

### How props are mapped

Inside `view(...)`:

- store fields become plain values
- event/effect fields become `onXxx` handlers
- nested models and refs are resolved recursively

For example, if model returns:

```ts
return {
  count,
  setCount,
};
```

then `view` receives:

```ts
{
  id: string;
  count: number;
  onSetCount: (payload: number) => void;
}
```

## `Component.create(...)`

Every created component has:

- `Component.model`
- `Component.create(data?, options?)`

`Component.create(...)` returns a created model descriptor.

That descriptor can be used in two places:

- outside, through the component `model` prop
- inside another `component(...).model` as one owned submodel

### Outside component model

Use this when some outer layer wants to own one specific component instance and pass it down explicitly.

```tsx
const controlled = Counter.create({ count: 5 });

function Page() {
  return <Counter model={controlled} />;
}
```

If `model` prop is passed, the component uses that existing created model.
If `model` prop is omitted, the component creates and manages its own instance.

### Inside component model

Use this when a parent has exactly one owned child model and you do not want to model it as a collection.

Typical example: one page and one dialog.

```tsx
import { createEvent, sample } from "effector";
import { component } from "@effector-kit/react";
import { contract, define, type TString } from "@effector-kit/models";

const Page = component({
  contract: contract({
    title: define.store(define.schema<TString>(), ""),
  })(),
  model: ({ title }) => {
    const dialog = Dialog.create({ opened: false });
    const openDialog = createEvent<void>();

    sample({
      clock: openDialog,
      target: dialog.open,
    });

    return {
      title,
      dialog,
      openDialog,
    };
  },
  view: ({ title, dialog, onOpenDialog }) => (
    <div>
      <h1>{title}</h1>
      <div>{String(dialog.opened)}</div>
      <button onClick={() => onOpenDialog()} type="button">
        open dialog
      </button>
      <Dialog model={dialog} />
    </div>
  ),
});
```

Inside `component(...).model`, the created model behaves like one owned submodel:

- in `model`, you work with model-shaped units like `dialog.open`
- in `view`, you get resolved values and handlers like `dialog.opened` and `dialog.onOpen`

## One child vs many children

There are two different composition scenarios.

### One owned child model

Use `Component.create(...)`.

This is the right fit for things like:

- page + dialog
- page + toolbar model
- widget + one settings panel

### Multiple child instances

Use `child(Component.model)`.

This is the right fit for things like:

- cards
- tabs
- rows
- list items

## Reusing component models

`Component.model` is a normal model, so it is the main composition surface for parent-child modeling.

```tsx
import { createEvent, sample } from "effector";
import { component } from "@effector-kit/react";
import { child, contract, define, type TString } from "@effector-kit/models";

const Dashboard = component({
  contract: contract({
    title: define.store(define.schema<TString>(), ""),
  })(),
  model: ({ title }) => {
    const cards = child(Counter.model);
    const createCard = createEvent<{ id: string; data: { count: number } }>();

    sample({
      clock: createCard,
      target: cards.create,
    });

    return {
      title,
      cards,
      createCard,
    };
  },
  view: ({ title, cards, onCreateCard }) => (
    <div>
      <h1>{title}</h1>
      <div>{cards.map((card) => card.count).join(",")}</div>
      <button
        onClick={() => onCreateCard({ id: "a", data: { count: 1 } })}
        type="button"
      >
        Add card
      </button>
    </div>
  ),
});
```

## Generics

The current API supports generic contracts and components through a factory function.

```tsx
import { sample } from "effector";
import { component } from "@effector-kit/react";
import { contract, define, type TRef } from "@effector-kit/models";

const makeValueContract = contract({
  value: define.store(define.schema<TRef<"Value">>(), "" as never),
  change: define.event(define.schema<TRef<"Value">>()),
});

function createValueComponent<Value extends string>() {
  return component({
    contract: makeValueContract<{ Value: Value }>(),
    model: ({ value, change }) => {
      sample({
        clock: change,
        target: value,
      });

      return {
        value,
        change,
      };
    },
    view: ({ value, onChange }) => (
      <button onClick={() => onChange("updated" as Value)} type="button">
        {value}
      </button>
    ),
  });
}
```

Direct JSX generics like `<SomeSelect<string> />` are not part of the current public API.
