/** @vitest-environment jsdom */

import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, test } from "vitest";
import { allSettled, createEvent, fork, sample, type Scope } from "effector";
import { Provider } from "effector-react";
import { child, contract, define, model, ref } from "@effector-kit/models";
import { type TNumber, type TRef, type TString } from "@effector-kit/models";
import { component, useModel } from "../lib";

afterEach(() => {
  cleanup();
});

function renderInScope(scope: Scope, element: React.ReactElement) {
  return render(<Provider value={scope}>{element}</Provider>);
}

function createCounterModel() {
  return model({
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
}

function createItemModel() {
  return model({
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
}

function createDashboardModel() {
  const counterModel = createCounterModel();
  const itemModel = createItemModel();

  const dashboardModel = model({
    contract: contract({
      title: define.store(define.schema<TString>(), ""),
    })(),
    fn: ({ title }) => {
      const selected = ref(counterModel);
      const items = child(itemModel);
      const track = createEvent<string>();
      const setSelectedCount = createEvent<number>();
      const createItem = createEvent<{ id: string; data: { value: number } }>();

      sample({
        clock: track,
        target: selected.add,
      });

      sample({
        clock: setSelectedCount,
        target: selected.lens.count.target(),
      });

      sample({
        clock: createItem,
        target: items.create,
      });

      return {
        title,
        selected,
        items,
        track,
        setSelectedCount,
        createItem,
      };
    },
  });

  return {
    counterModel,
    dashboardModel,
  };
}

describe("@effector-kit/react", () => {
  test("useModel(model) creates an instance on mount and removes it on unmount", async () => {
    const counterModel = createCounterModel();
    const scope = fork();

    function Harness() {
      const entity = useModel(counterModel);

      return (
        <div>
          <div data-testid="id">{entity.id}</div>
          <div data-testid="count">{String(entity.count)}</div>
          <button onClick={() => entity.setCount(5)} type="button">
            set count
          </button>
        </div>
      );
    }

    const view = renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("0");
    });

    const id = screen.getByTestId("id").textContent!;

    expect(scope.getState(counterModel.$instances)).toMatchObject({
      [id]: { count: 0 },
    });

    fireEvent.click(screen.getByRole("button", { name: "set count" }));

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("5");
    });

    expect(scope.getState(counterModel.$instances)).toMatchObject({
      [id]: { count: 5 },
    });

    view.unmount();

    await waitFor(() => {
      expect(scope.getState(counterModel.$instances)).toStrictEqual({});
    });
  });

  test("useModel(model, lens) returns existing instances and reacts to selection changes", async () => {
    const counterModel = createCounterModel();
    const scope = fork();

    await allSettled(counterModel.create, {
      scope,
      params: [
        { id: "a", data: { count: 1 } },
        { id: "b", data: { count: 3 } },
      ],
    });

    function Harness() {
      const entities = useModel(
        counterModel,
        counterModel.lens.where((entity) => entity.count > 1),
      );

      return (
        <ul data-testid="entities">
          {entities.map((entity) => (
            <li key={entity.id}>
              {entity.id}:{entity.count}
            </li>
          ))}
        </ul>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("entities").textContent).toContain("b:3");
    });

    expect(screen.getByTestId("entities").textContent).not.toContain("a:1");

    await allSettled(
      counterModel.lens.where((entity) => entity.id === "a").setCount.target(),
      {
        scope,
        params: 4,
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId("entities").textContent).toContain("a:4");
      expect(screen.getByTestId("entities").textContent).toContain("b:3");
    });
  });

  test("useModel automatically resolves refs and child models", async () => {
    const { counterModel, dashboardModel } = createDashboardModel();
    const scope = fork();

    await allSettled(counterModel.create, {
      scope,
      params: { id: "c1", data: { count: 1 } },
    });

    function Harness() {
      const entity = useModel(dashboardModel, {
        data: { title: "Dashboard" },
      });

      return (
        <div>
          <div data-testid="title">{entity.title}</div>
          <div data-testid="selected-counts">
            {entity.selected.map((item) => item.count).join(",") || "empty"}
          </div>
          <div data-testid="item-values">
            {entity.items.map((item) => item.value).join(",") || "empty"}
          </div>
          <button onClick={() => entity.track("c1")} type="button">
            track counter
          </button>
          <button onClick={() => entity.setSelectedCount(9)} type="button">
            set selected count
          </button>
          <button
            onClick={() => entity.createItem({ id: "i1", data: { value: 2 } })}
            type="button"
          >
            create item
          </button>
          <button onClick={() => entity.items[0]?.setValue(7)} type="button">
            set first item value
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("title").textContent).toBe("Dashboard");
    });

    expect(screen.getByTestId("selected-counts").textContent).toBe("empty");
    expect(screen.getByTestId("item-values").textContent).toBe("empty");

    fireEvent.click(screen.getByRole("button", { name: "track counter" }));
    fireEvent.click(screen.getByRole("button", { name: "create item" }));
    fireEvent.click(screen.getByRole("button", { name: "set selected count" }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-counts").textContent).toBe("9");
      expect(screen.getByTestId("item-values").textContent).toBe("2");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "set first item value" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("item-values").textContent).toBe("7");
    });
  });

  test("component maps stores to values and events to on-prefixed handlers", async () => {
    const lifecycle: string[] = [];
    const scope = fork();

    const Counter = component({
      contract: contract({
        count: define.store(define.schema<TNumber>(), 0),
      })(),
      model: ({ count }, mounted, unmounted) => {
        const setCount = createEvent<number>();

        mounted.watch(() => lifecycle.push("mounted"));
        unmounted.watch(() => lifecycle.push("unmounted"));

        sample({
          clock: setCount,
          target: count,
        });

        return {
          count,
          setCount,
        };
      },
      view: ({ id, count, onSetCount }) => (
        <div>
          <div data-testid="id">{id}</div>
          <div data-testid="count">{String(count)}</div>
          <button onClick={() => onSetCount(11)} type="button">
            set component count
          </button>
        </div>
      ),
    });

    const view = renderInScope(scope, <Counter count={3} />);

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("3");
    });

    expect(lifecycle).toStrictEqual(["mounted"]);
    expect(Object.keys(scope.getState(Counter.model.$instances))).toHaveLength(
      1,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "set component count" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("11");
    });

    view.unmount();

    await waitFor(() => {
      expect(scope.getState(Counter.model.$instances)).toStrictEqual({});
    });

    expect(lifecycle).toStrictEqual(["mounted", "unmounted"]);
  });

  test("component.create provides a controlled model handle for the model prop", async () => {
    const scope = fork();
    const Counter = component({
      contract: contract({
        count: define.store(define.schema<TNumber>(), 0),
      })(),
      model: ({ count }) => {
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
      view: ({ id, count, onSetCount }) => (
        <div>
          <div data-testid="id">{id}</div>
          <div data-testid="count">{String(count)}</div>
          <button onClick={() => onSetCount(8)} type="button">
            set controlled count
          </button>
        </div>
      ),
    });

    const controlled = Counter.create({ count: 5 }, { scope });
    const view = renderInScope(scope, <Counter model={controlled} />);

    await waitFor(() => {
      expect(screen.getByTestId("id").textContent).toBe(controlled.id);
      expect(screen.getByTestId("count").textContent).toBe("5");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "set controlled count" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("8");
    });

    expect(scope.getState(Counter.model.$instances)).toMatchObject({
      [controlled.id]: { count: 8 },
    });

    view.unmount();

    await waitFor(() => {
      expect(scope.getState(Counter.model.$instances)).toStrictEqual({});
    });
  });

  test("component supports generic contracts through a generic factory", async () => {
    const scope = fork();
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

    const ValueComponent = createValueComponent<"hello" | "updated">();
    const controlled = ValueComponent.create({ value: "hello" }, { scope });

    expectTypeOf<Parameters<typeof ValueComponent>[0]>().toMatchTypeOf<{
      value?: "hello" | "updated";
      model?: typeof controlled;
    }>();

    expectTypeOf(controlled.data.value).toEqualTypeOf<
      "hello" | "updated" | undefined
    >();

    renderInScope(scope, <ValueComponent model={controlled} />);

    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toBe("hello");
    });

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("button").textContent).toBe("updated");
    });
  });

  test("component model can be reused inside another component model", async () => {
    const scope = fork();

    const CounterCard = component({
      contract: contract({
        count: define.store(define.schema<TNumber>(), 0),
      })(),
      model: ({ count }) => {
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
      view: ({ count, onSetCount }) => (
        <div>
          <div data-testid="card-count">{count}</div>
          <button onClick={() => onSetCount(count + 1)} type="button">
            bump card
          </button>
        </div>
      ),
    });

    const Dashboard = component({
      contract: contract({
        title: define.store(define.schema<TString>(), ""),
      })(),
      model: ({ title }) => {
        const cards = child(CounterCard.model);
        const createCard = createEvent<{ id: string; data: { count: number } }>();
        const setCardsCount = createEvent<number>();

        sample({
          clock: createCard,
          target: cards.create,
        });

        sample({
          clock: setCardsCount,
          target: cards.lens.count.target(),
        });

        return {
          title,
          cards,
          createCard,
          setCardsCount,
        };
      },
      view: ({ title, cards, onCreateCard, onSetCardsCount }) => (
        <div>
          <div data-testid="dashboard-title">{title}</div>
          <div data-testid="dashboard-counts">
            {cards.map((card) => card.count).join(",") || "empty"}
          </div>
          <button
            onClick={() => onCreateCard({ id: "a", data: { count: 1 } })}
            type="button"
          >
            add first card
          </button>
          <button
            onClick={() => onCreateCard({ id: "b", data: { count: 2 } })}
            type="button"
          >
            add second card
          </button>
          <button onClick={() => onSetCardsCount(9)} type="button">
            set nested counts
          </button>
        </div>
      ),
    });

    renderInScope(scope, <Dashboard title="Board" />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-title").textContent).toBe("Board");
    });

    expect(screen.getByTestId("dashboard-counts").textContent).toBe("empty");

    fireEvent.click(screen.getByRole("button", { name: "add first card" }));
    fireEvent.click(screen.getByRole("button", { name: "add second card" }));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-counts").textContent).toBe("1,2");
    });

    fireEvent.click(screen.getByRole("button", { name: "set nested counts" }));

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-counts").textContent).toBe("9,9");
    });
  });
});
