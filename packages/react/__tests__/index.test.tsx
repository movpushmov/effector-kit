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
import {
  allSettled,
  createEvent,
  createStore,
  fork,
  sample,
  type Event,
  type Scope,
} from "effector";
import { Provider, useUnit } from "effector-react";
import { child, contract, define, model, ref } from "@effector-kit/models";
import {
  type TBoolean,
  type TNumber,
  type TRef,
  type TString,
} from "@effector-kit/models";
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

function createChatModel() {
  return model({
    contract: contract({
      currentUserId: define.store(define.schema<TString>(), ""),
    })(),
    fn: ({ currentUserId }) => {
      const setChat = createEvent<{ name: string } | null>();
      const messageTextChanged = createEvent<string>();
      const sendMessagePressed = createEvent<void>();

      const chat = createStore<{ name: string } | null>(null);
      const messageText = createStore("");
      const messages = createStore<string[]>([]);

      sample({
        clock: setChat,
        target: chat,
      });

      sample({
        clock: messageTextChanged,
        target: messageText,
      });

      sample({
        clock: sendMessagePressed,
        source: messageText,
        filter: (text) => text.length > 0,
        fn: (text) => [text],
        target: messages,
      });

      return {
        currentUserId,
        chat,
        messageText,
        messages,
        setChat,
        messageTextChanged,
        sendMessagePressed,
      };
    },
  });
}

function createTodoModel() {
  return model({
    contract: contract({
      title: define.store(define.schema<TString>(), ""),
      done: define.store(define.schema<TBoolean>(), false),
    })(),
    fn: ({ title, done }) => {
      const setTitle = createEvent<string>();
      const changeDone = createEvent<void>();

      sample({
        clock: setTitle,
        target: title,
      });

      sample({
        clock: changeDone,
        source: done,
        fn: (done) => !done,
        target: done,
      });

      return {
        title,
        done,
        setTitle,
        changeDone,
      };
    },
  });
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

  test("useModel keeps event names without on-prefix", async () => {
    const counterModel = createCounterModel();
    const scope = fork();
    let lastEntity: ReturnType<typeof useModel<typeof counterModel>> | null =
      null;

    function Harness() {
      const entity = useModel(counterModel, {
        data: { count: 1 },
      });

      lastEntity = entity;

      return (
        <div>
          <div data-testid="count">{entity.count}</div>
          <button onClick={() => entity.setCount(5)} type="button">
            set count
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("1");
    });

    expect(lastEntity).not.toBeNull();
    expect(typeof lastEntity?.setCount).toBe("function");
    expect("onSetCount" in (lastEntity as object)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "set count" }));

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("5");
    });
  });

  test("useModel materializes root stores created inside model.fn", async () => {
    const chatModel = createChatModel();
    const scope = fork();
    let lastEntity: ReturnType<typeof useModel<typeof chatModel>> | null = null;

    function Harness() {
      const entity = useModel(chatModel, {
        data: { currentUserId: "u1" },
      });

      lastEntity = entity;

      return (
        <div>
          <div data-testid="current-user-id">{entity.currentUserId}</div>
          <div data-testid="chat-name">{entity.chat?.name ?? "empty"}</div>
          <div data-testid="message-text">{entity.messageText}</div>
          <div data-testid="messages">
            {entity.messages.join(",") || "empty"}
          </div>
          <button
            onClick={() => entity.setChat({ name: "General" })}
            type="button"
          >
            set chat
          </button>
          <button
            onClick={() => entity.messageTextChanged("hello")}
            type="button"
          >
            set message text
          </button>
          <button onClick={() => entity.sendMessagePressed()} type="button">
            send message
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("current-user-id").textContent).toBe("u1");
      expect(screen.getByTestId("chat-name").textContent).toBe("empty");
      expect(screen.getByTestId("message-text").textContent).toBe("");
      expect(screen.getByTestId("messages").textContent).toBe("empty");
    });

    expect(lastEntity).not.toBeNull();
    expect(lastEntity?.chat).toBeNull();
    expect(lastEntity?.messageText).toBe("");
    expect(lastEntity?.messages).toStrictEqual([]);
    expect(typeof lastEntity?.setChat).toBe("function");
    expect(typeof lastEntity?.messageTextChanged).toBe("function");
    expect(typeof lastEntity?.sendMessagePressed).toBe("function");

    fireEvent.click(screen.getByRole("button", { name: "set chat" }));
    fireEvent.click(screen.getByRole("button", { name: "set message text" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("General");
      expect(screen.getByTestId("message-text").textContent).toBe("hello");
    });

    fireEvent.click(screen.getByRole("button", { name: "send message" }));

    await waitFor(() => {
      expect(screen.getByTestId("messages").textContent).toBe("hello");
    });

    expect(lastEntity?.chat).toEqual({ name: "General" });
    expect(lastEntity?.messageText).toBe("hello");
    expect(lastEntity?.messages).toStrictEqual(["hello"]);
    const instanceId = lastEntity?.id;
    expect(instanceId).toBeTruthy();
    expect(scope.getState(chatModel.$instances)).toMatchObject({
      [instanceId!]: {
        currentUserId: "u1",
        chat: { name: "General" },
        messageText: "hello",
        messages: ["hello"],
      },
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

  test("component view supports nested plain objects with units", async () => {
    const scope = fork();

    const Panel = component({
      contract: contract({
        title: define.store(define.schema<TString>(), ""),
        opened: define.store(define.schema<TBoolean>(), false),
      })(),
      model: ({ title, opened }) => {
        const toggle = createEvent<void>();

        sample({
          clock: toggle,
          source: opened,
          fn: (isOpened) => !isOpened,
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
      view: ({ title, panel }) => {
        expectTypeOf(title).toEqualTypeOf<string>();
        expectTypeOf(panel.opened).toEqualTypeOf<boolean>();
        expectTypeOf(panel.onToggle).toMatchTypeOf<() => void>();

        return (
          <div>
            <div data-testid="nested-title">{title}</div>
            <div data-testid="nested-opened">{String(panel.opened)}</div>
            <button onClick={() => panel.onToggle()} type="button">
              toggle nested panel
            </button>
          </div>
        );
      },
    });

    renderInScope(scope, <Panel title="Settings" />);

    await waitFor(() => {
      expect(screen.getByTestId("nested-title").textContent).toBe("Settings");
      expect(screen.getByTestId("nested-opened").textContent).toBe("false");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "toggle nested panel" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("nested-opened").textContent).toBe("true");
    });
  });

  test("mounted receives a typed object payload from component props", async () => {
    const mountedPayloads: Array<{ userId: string; roomId: string }> = [];
    const scope = fork();

    const Todo = component({
      contract: contract({
        title: define.store(define.schema<TString>(), ""),
        done: define.store(define.schema<TBoolean>(), false),
      })(),
      model: (
        { title, done },
        mounted: Event<{ userId: string; roomId: string }>,
      ) => {
        expectTypeOf(title.getState()).toEqualTypeOf<string>();
        expectTypeOf(done.getState()).toEqualTypeOf<boolean>();
        expectTypeOf(mounted).toMatchTypeOf<
          Event<{ userId: string; roomId: string }>
        >();

        mounted.watch((payload) => {
          mountedPayloads.push(payload);
        });

        return {
          title,
          done,
        };
      },
      view: ({ title, done }) => (
        <div>
          <div data-testid="mounted-title">{title}</div>
          <div data-testid="mounted-done">{String(done)}</div>
        </div>
      ),
    });

    expectTypeOf<Parameters<typeof Todo>[0]>().toMatchTypeOf<{
      title?: string;
      done?: boolean;
      userId: string;
      roomId: string;
    }>();

    renderInScope(
      scope,
      <Todo title="Ship fix" done userId="u1" roomId="room-1" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mounted-title").textContent).toBe("Ship fix");
      expect(screen.getByTestId("mounted-done").textContent).toBe("true");
    });

    expect(mountedPayloads).toStrictEqual([
      {
        userId: "u1",
        roomId: "room-1",
      },
    ]);
  });

  test("component.create provides a controlled model handle for the model prop", async () => {
    const scope = fork();
    const lifecycle: string[] = [];
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
          <button onClick={() => onSetCount(8)} type="button">
            set controlled count
          </button>
        </div>
      ),
    });

    const controlled = Counter.create({ count: 5 }, { scope });
    const view = renderInScope(scope, <Counter model={controlled} />);

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("5");
    });

    expect(lifecycle).toStrictEqual(["mounted"]);

    fireEvent.click(
      screen.getByRole("button", { name: "set controlled count" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("8");
    });

    expect(
      Object.values(scope.getState(Counter.model.$instances)),
    ).toMatchObject([{ count: 8 }]);

    view.unmount();

    await waitFor(() => {
      expect(scope.getState(Counter.model.$instances)).toStrictEqual({});
    });

    expect(lifecycle).toStrictEqual(["mounted", "unmounted"]);
  });

  test("component.create can be used inside another component model for one owned child instance", async () => {
    const scope = fork();

    const Dialog = component({
      contract: contract({
        opened: define.store(define.schema<TNumber>(), 0),
      })(),
      model: ({ opened }) => {
        const open = createEvent<void>();

        sample({
          clock: open,
          fn: () => 1,
          target: opened,
        });

        return {
          opened,
          open,
        };
      },
      view: ({ opened, onOpen }) => (
        <div>
          <div data-testid="dialog-component-opened">{String(opened)}</div>
          <button onClick={() => onOpen()} type="button">
            open dialog component
          </button>
        </div>
      ),
    });

    const Page = component({
      contract: contract({
        title: define.store(define.schema<TString>(), ""),
      })(),
      model: ({ title }) => {
        const dialog = Dialog.create({ opened: 0 });
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
          <div data-testid="page-title">{title}</div>
          <div data-testid="page-dialog-opened">{String(dialog.opened)}</div>
          <button onClick={() => onOpenDialog()} type="button">
            open dialog from page
          </button>
        </div>
      ),
    });

    renderInScope(scope, <Page title="Settings" />);

    await waitFor(() => {
      expect(screen.getByTestId("page-title").textContent).toBe("Settings");
      expect(screen.getByTestId("page-dialog-opened").textContent).toBe("0");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "open dialog from page" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("page-dialog-opened").textContent).toBe("1");
    });
  });

  test("controlled component model fires mounted and unmounted through the model prop lifecycle", async () => {
    const scope = fork();
    const lifecycle: string[] = [];

    const Dialog = component({
      contract: contract({
        opened: define.store(define.schema<TBoolean>(), false),
      })(),
      model: ({ opened }, mounted, unmounted) => {
        const changeOpened = createEvent<boolean>();

        mounted.watch(() => lifecycle.push("mounted"));
        unmounted.watch(() => lifecycle.push("unmounted"));

        sample({
          clock: changeOpened,
          target: opened,
        });

        return {
          opened,
          changeOpened,
        };
      },
      view: ({ opened, onChangeOpened }) => (
        <div>
          <div data-testid="controlled-dialog-opened">{String(opened)}</div>
          <button onClick={() => onChangeOpened(true)} type="button">
            open controlled dialog
          </button>
        </div>
      ),
    });

    const created = Dialog.create({ opened: false }, { scope });
    const view = renderInScope(scope, <Dialog model={created} />);

    await waitFor(() => {
      expect(screen.getByTestId("controlled-dialog-opened").textContent).toBe(
        "false",
      );
    });

    expect(lifecycle).toStrictEqual(["mounted"]);

    fireEvent.click(
      screen.getByRole("button", { name: "open controlled dialog" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("controlled-dialog-opened").textContent).toBe(
        "true",
      );
    });

    view.unmount();

    await waitFor(() => {
      expect(lifecycle).toStrictEqual(["mounted", "unmounted"]);
    });
  });

  test("todo item updates title and done through useModel with lens.ids(id)", async () => {
    const scope = fork();
    const todoModel = createTodoModel();
    const $todosKeys = todoModel.$instances.map((todos) => Object.keys(todos));

    function TodoItem({ id }: { id: string }) {
      const todos = useModel(todoModel, todoModel.lens.ids(id));
      const todo = todos[0];

      if (!todo) {
        return <div data-testid="todo-item-missing">missing</div>;
      }

      return (
        <div>
          <input
            aria-label="todo-title-input"
            value={todo.title}
            onChange={(event) => {
              todo.setTitle(event.target.value);
            }}
          />
          <input
            aria-label="todo-done-input"
            checked={todo.done}
            onChange={() => {
              todo.changeDone();
            }}
            type="checkbox"
          />
          <div data-testid="todo-title-view">{todo.title}</div>
          <div data-testid="todo-done-view">{String(todo.done)}</div>
        </div>
      );
    }

    function TodoHost() {
      const [createTodo, todosKeys] = useUnit([todoModel.create, $todosKeys]);

      if (todosKeys.length === 0) {
        return (
          <button
            onClick={() => {
              createTodo({
                id: "todo-1",
                data: {
                  title: "Write tests",
                  done: false,
                },
              });
            }}
            type="button"
          >
            Create first todo
          </button>
        );
      }

      return <TodoItem id={todosKeys[0]!} />;
    }

    renderInScope(scope, <TodoHost />);

    fireEvent.click(screen.getByRole("button", { name: "Create first todo" }));

    await waitFor(() => {
      expect(screen.queryByTestId("todo-item-missing")).toBeNull();
      expect(screen.getByTestId("todo-title-view").textContent).toBe(
        "Write tests",
      );
      expect(screen.getByTestId("todo-done-view").textContent).toBe("false");
      expect(
        (screen.getByLabelText("todo-title-input") as HTMLInputElement).value,
      ).toBe("Write tests");
      expect(
        (screen.getByLabelText("todo-done-input") as HTMLInputElement).checked,
      ).toBe(false);
    });

    fireEvent.change(screen.getByLabelText("todo-title-input"), {
      target: { value: "Review PR" },
    });
    fireEvent.click(screen.getByLabelText("todo-done-input"));

    await waitFor(() => {
      expect(screen.getByTestId("todo-title-view").textContent).toBe(
        "Review PR",
      );
      expect(screen.getByTestId("todo-done-view").textContent).toBe("true");
      expect(
        (screen.getByLabelText("todo-title-input") as HTMLInputElement).value,
      ).toBe("Review PR");
      expect(
        (screen.getByLabelText("todo-done-input") as HTMLInputElement).checked,
      ).toBe(true);
      expect(scope.getState(todoModel.$instances)).toMatchObject({
        "todo-1": {
          title: "Review PR",
          done: true,
        },
      });
    });
  });

  test("todo list creates independent todos and TodoItem updates them by id", async () => {
    const scope = fork();
    const todoModel = createTodoModel();
    const $todosKeys = todoModel.$instances.map((todos) => Object.keys(todos));
    let nextId = 1;

    function TodoItem({ id }: { id: string }) {
      const todos = useModel(todoModel, todoModel.lens.ids(id));
      const [deleteTodo] = useUnit([todoModel.delete]);
      const todo = todos[0];

      if (!todo) {
        return null;
      }

      return (
        <li data-testid={`todo-item-${id}`}>
          <input
            aria-label={`todo-title-input-${id}`}
            value={todo.title}
            onChange={(event) => {
              todo.setTitle(event.target.value);
            }}
          />
          <input
            aria-label={`todo-done-input-${id}`}
            checked={todo.done}
            onChange={() => {
              todo.changeDone();
            }}
            type="checkbox"
          />
          <span data-testid={`todo-title-view-${id}`}>{todo.title}</span>
          <span data-testid={`todo-done-view-${id}`}>{String(todo.done)}</span>
          <button
            onClick={() => {
              deleteTodo(id);
            }}
            type="button"
          >
            Delete todo {id}
          </button>
        </li>
      );
    }

    function TodoList() {
      const [createTodo, todosKeys] = useUnit([todoModel.create, $todosKeys]);

      return (
        <>
          <button
            onClick={() => {
              const id = `todo-${nextId++}`;
              createTodo({
                id,
                data: { title: "", done: false },
              });
            }}
            type="button"
          >
            Create todo
          </button>
          <ul>
            {todosKeys.map((key) => (
              <TodoItem id={key} key={key} />
            ))}
          </ul>
        </>
      );
    }

    renderInScope(scope, <TodoList />);

    fireEvent.click(screen.getByRole("button", { name: "Create todo" }));

    await waitFor(() => {
      expect(screen.getByTestId("todo-item-todo-1")).toBeTruthy();
      expect(
        (screen.getByLabelText("todo-title-input-todo-1") as HTMLInputElement)
          .value,
      ).toBe("");
      expect(screen.getByTestId("todo-title-view-todo-1").textContent).toBe("");
      expect(screen.getByTestId("todo-done-view-todo-1").textContent).toBe(
        "false",
      );
    });

    fireEvent.change(screen.getByLabelText("todo-title-input-todo-1"), {
      target: { value: "Learn Effector" },
    });
    fireEvent.click(screen.getByLabelText("todo-done-input-todo-1"));

    await waitFor(() => {
      expect(screen.getByTestId("todo-title-view-todo-1").textContent).toBe(
        "Learn Effector",
      );
      expect(screen.getByTestId("todo-done-view-todo-1").textContent).toBe(
        "true",
      );
      expect(scope.getState(todoModel.$instances)).toMatchObject({
        "todo-1": {
          title: "Learn Effector",
          done: true,
        },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete todo todo-1" }));

    await waitFor(() => {
      expect(scope.getState(todoModel.$instances)).toStrictEqual({});
      expect(screen.queryByTestId("todo-item-todo-1")).toBeNull();
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
        const createCard = createEvent<{
          id: string;
          data: { count: number };
        }>();
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
