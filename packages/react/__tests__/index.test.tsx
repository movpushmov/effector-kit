/** @vitest-environment jsdom */

import React from "react";
import { useEffect } from "react";
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
  combine,
  createEffect,
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
  type TStatic,
  type TString,
  type TVoid,
} from "@effector-kit/models";
import { component, useModel } from "../lib";

afterEach(() => {
  cleanup();
});

function renderInScope(scope: Scope, element: React.ReactElement) {
  const view = render(<Provider value={scope}>{element}</Provider>);

  return {
    ...view,
    rerender(nextElement: React.ReactElement) {
      return view.rerender(<Provider value={scope}>{nextElement}</Provider>);
    },
  };
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
          <button onClick={() => entity.onSetCount(5)} type="button">
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

  test("useModel(model, single lens) returns one entity instead of an array", async () => {
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
      const first = useModel(
        counterModel,
        counterModel.lens.ids("a", "b").first(),
      );
      const last = useModel(
        counterModel,
        counterModel.lens.ids("a", "b").last(),
      );
      const single = useModel(
        counterModel,
        counterModel.lens.ids("b").single(),
      );
      const missing = useModel(counterModel, counterModel.lens.single());

      expectTypeOf(first).toMatchTypeOf<
        | {
            id: string;
            count: number;
            onSetCount: (payload: number) => void;
          }
        | undefined
      >();
      expectTypeOf(last).toMatchTypeOf<
        | {
            id: string;
            count: number;
            onSetCount: (payload: number) => void;
          }
        | undefined
      >();
      expectTypeOf(single).toMatchTypeOf<
        | {
            id: string;
            count: number;
            onSetCount: (payload: number) => void;
          }
        | undefined
      >();

      return (
        <div>
          <div data-testid="first-count">{first?.count ?? "missing"}</div>
          <div data-testid="last-count">{last?.count ?? "missing"}</div>
          <div data-testid="single-count">{single?.count ?? "missing"}</div>
          <div data-testid="missing-count">{missing?.count ?? "missing"}</div>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("first-count").textContent).toBe("1");
      expect(screen.getByTestId("last-count").textContent).toBe("3");
      expect(screen.getByTestId("single-count").textContent).toBe("3");
      expect(screen.getByTestId("missing-count").textContent).toBe("missing");
    });
  });

  test("useModel(model, {id, retain}) reuses an existing instance by id", async () => {
    const counterModel = createCounterModel();
    const scope = fork();

    function Harness({ initial }: { initial: number }) {
      const entity = useModel(counterModel, {
        id: "chat-1",
        data: { count: initial },
        retain: true,
      });

      return (
        <div>
          <div data-testid="retained-id">{entity.id}</div>
          <div data-testid="retained-count">{String(entity.count)}</div>
          <button onClick={() => entity.onSetCount(5)} type="button">
            set retained count
          </button>
        </div>
      );
    }

    const firstView = renderInScope(scope, <Harness initial={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("retained-id").textContent).toBe("chat-1");
      expect(screen.getByTestId("retained-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "set retained count" }));

    await waitFor(() => {
      expect(screen.getByTestId("retained-count").textContent).toBe("5");
    });

    firstView.unmount();

    await waitFor(() => {
      expect(scope.getState(counterModel.$instances)).toMatchObject({
        "chat-1": { count: 5 },
      });
    });

    renderInScope(scope, <Harness initial={99} />);

    await waitFor(() => {
      expect(screen.getByTestId("retained-id").textContent).toBe("chat-1");
      expect(screen.getByTestId("retained-count").textContent).toBe("5");
    });

    expect(Object.keys(scope.getState(counterModel.$instances))).toStrictEqual([
      "chat-1",
    ]);
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
          <button onClick={() => entity.onTrack("c1")} type="button">
            track counter
          </button>
          <button onClick={() => entity.onSetSelectedCount(9)} type="button">
            set selected count
          </button>
          <button
            onClick={() =>
              entity.onCreateItem({ id: "i1", data: { value: 2 } })
            }
            type="button"
          >
            create item
          </button>
          <button onClick={() => entity.items[0]?.onSetValue(7)} type="button">
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

  test("useModel normalizes root event names with on-prefix", async () => {
    const counterModel = createCounterModel();
    const scope = fork();
    let lastEntitySnapshot: unknown = null;

    function Harness() {
      const entity = useModel(counterModel, {
        data: { count: 1 },
      });

      lastEntitySnapshot = {
        hasOnSetCount: typeof entity.onSetCount === "function",
        hasSetCount: "setCount" in (entity as object),
      };

      return (
        <div>
          <div data-testid="count">{entity.count}</div>
          <button onClick={() => entity.onSetCount(5)} type="button">
            set count
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("1");
    });

    expect(lastEntitySnapshot).not.toBeNull();
    if (!lastEntitySnapshot) {
      throw new Error("counter snapshot is missing");
    }
    const counterSnapshot = lastEntitySnapshot as {
      hasOnSetCount: boolean;
      hasSetCount: boolean;
    };
    expect(counterSnapshot.hasOnSetCount).toBe(true);
    expect(counterSnapshot.hasSetCount).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "set count" }));

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("5");
    });
  });

  test("useModel normalizes root store and event names", async () => {
    const scope = fork();

    const screenModel = model({
      contract: contract({})(),
      fn: () => {
        const $chatName = createStore("General");
        const chatNameChanged = createEvent<string>();

        sample({
          clock: chatNameChanged,
          target: $chatName,
        });

        return {
          $chatName,
          chatNameChanged,
        };
      },
    });

    let lastEntitySnapshot: unknown = null;

    function Harness() {
      const entity = useModel(screenModel);

      lastEntitySnapshot = {
        hasChatName: "chatName" in (entity as object),
        hasRawChatName: "$chatName" in (entity as object),
        hasRawChatNameChanged: "chatNameChanged" in (entity as object),
        hasOnChatNameChanged: typeof entity.onChatNameChanged === "function",
      };

      expectTypeOf(entity.chatName).toEqualTypeOf<string>();
      expectTypeOf(entity.onChatNameChanged).toMatchTypeOf<
        (payload: string) => void
      >();

      return (
        <div>
          <div data-testid="root-chat-name">{entity.chatName}</div>
          <button
            onClick={() => entity.onChatNameChanged("Random")}
            type="button"
          >
            change root chat name
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("root-chat-name").textContent).toBe("General");
    });

    expect(lastEntitySnapshot).not.toBeNull();
    if (!lastEntitySnapshot) {
      throw new Error("root naming snapshot is missing");
    }
    const rootNamingSnapshot = lastEntitySnapshot as {
      hasChatName: boolean;
      hasRawChatName: boolean;
      hasRawChatNameChanged: boolean;
      hasOnChatNameChanged: boolean;
    };
    expect(rootNamingSnapshot.hasChatName).toBe(true);
    expect(rootNamingSnapshot.hasRawChatName).toBe(false);
    expect(rootNamingSnapshot.hasRawChatNameChanged).toBe(false);
    expect(rootNamingSnapshot.hasOnChatNameChanged).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "change root chat name" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("root-chat-name").textContent).toBe("Random");
    });
  });

  test("useModel resolves derived stores created with combine and map", async () => {
    const scope = fork();

    const profileModel = model({
      contract: contract({
        firstName: define.store(define.schema<TString>(), ""),
        lastName: define.store(define.schema<TString>(), ""),
      })(),
      fn: ({ firstName, lastName }) => {
        const firstNameChanged = createEvent<string>();
        const lastNameChanged = createEvent<string>();
        const $fullName = combine(firstName, lastName, (first, last) =>
          `${first} ${last}`.trim(),
        );
        const $fullNameUpper = $fullName.map((value) => value.toUpperCase());

        sample({
          clock: firstNameChanged,
          target: firstName,
        });

        sample({
          clock: lastNameChanged,
          target: lastName,
        });

        return {
          firstName,
          lastName,
          $fullName,
          $fullNameUpper,
          firstNameChanged,
          lastNameChanged,
        };
      },
    });

    function Harness() {
      const entity = useModel(profileModel, {
        data: {
          firstName: "Ada",
          lastName: "Lovelace",
        },
      });

      expectTypeOf(entity.fullName).toEqualTypeOf<string>();
      expectTypeOf(entity.fullNameUpper).toEqualTypeOf<string>();
      expectTypeOf(entity.onFirstNameChanged).toMatchTypeOf<
        (payload: string) => void
      >();

      return (
        <div>
          <div data-testid="full-name">{entity.fullName}</div>
          <div data-testid="full-name-upper">{entity.fullNameUpper}</div>
          <button
            onClick={() => entity.onFirstNameChanged("Grace")}
            type="button"
          >
            change first name
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("full-name").textContent).toBe("Ada Lovelace");
      expect(screen.getByTestId("full-name-upper").textContent).toBe(
        "ADA LOVELACE",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "change first name" }));

    await waitFor(() => {
      expect(screen.getByTestId("full-name").textContent).toBe(
        "Grace Lovelace",
      );
      expect(screen.getByTestId("full-name-upper").textContent).toBe(
        "GRACE LOVELACE",
      );
    });
  });

  test("useModel materializes root stores created inside model.fn", async () => {
    const chatModel = createChatModel();
    const scope = fork();
    let lastEntitySnapshot: unknown = null;

    function Harness() {
      const entity = useModel(chatModel, {
        data: { currentUserId: "u1" },
      });

      lastEntitySnapshot = {
        id: entity.id,
        chat: entity.chat,
        messageText: entity.messageText,
        messages: entity.messages,
        hasOnSetChat: typeof entity.onSetChat === "function",
        hasOnMessageTextChanged: typeof entity.onMessageTextChanged === "function",
        hasOnSendMessagePressed: typeof entity.onSendMessagePressed === "function",
      };

      return (
        <div>
          <div data-testid="current-user-id">{entity.currentUserId}</div>
          <div data-testid="chat-name">{entity.chat?.name ?? "empty"}</div>
          <div data-testid="message-text">{entity.messageText}</div>
          <div data-testid="messages">
            {entity.messages.join(",") || "empty"}
          </div>
          <button
            onClick={() => entity.onSetChat({ name: "General" })}
            type="button"
          >
            set chat
          </button>
          <button
            onClick={() => entity.onMessageTextChanged("hello")}
            type="button"
          >
            set message text
          </button>
          <button onClick={() => entity.onSendMessagePressed()} type="button">
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

    expect(lastEntitySnapshot).not.toBeNull();
    if (!lastEntitySnapshot) {
      throw new Error("chat snapshot is missing");
    }
    const chatSnapshot = lastEntitySnapshot as {
      id: string;
      chat: { name: string } | null;
      messageText: string;
      messages: string[];
      hasOnSetChat: boolean;
      hasOnMessageTextChanged: boolean;
      hasOnSendMessagePressed: boolean;
    };
    expect(chatSnapshot.chat).toBeNull();
    expect(chatSnapshot.messageText).toBe("");
    expect(chatSnapshot.messages).toStrictEqual([]);
    expect(chatSnapshot.hasOnSetChat).toBe(true);
    expect(chatSnapshot.hasOnMessageTextChanged).toBe(true);
    expect(chatSnapshot.hasOnSendMessagePressed).toBe(true);

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

    if (!lastEntitySnapshot) {
      throw new Error("chat snapshot is missing after updates");
    }
    const updatedChatSnapshot = lastEntitySnapshot as {
      id: string;
      chat: { name: string } | null;
      messageText: string;
      messages: string[];
      hasOnSetChat: boolean;
      hasOnMessageTextChanged: boolean;
      hasOnSendMessagePressed: boolean;
    };
    expect(updatedChatSnapshot.chat).toEqual({ name: "General" });
    expect(updatedChatSnapshot.messageText).toBe("hello");
    expect(updatedChatSnapshot.messages).toStrictEqual(["hello"]);
    const instanceId = updatedChatSnapshot.id;
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

  test("useModel normalizes nested plain object naming", async () => {
    const scope = fork();
    const avatarPresses: string[] = [];

    const screenModel = model({
      contract: contract({
        title: define.store(define.schema<TString>(), ""),
      })(),
      fn: ({ title }) => {
        const $chatName = createStore("General");
        const chatNameChanged = createEvent<string>();
        const headerAvatarPressed = createEvent<void>();

        sample({
          clock: chatNameChanged,
          target: $chatName,
        });

        headerAvatarPressed.watch(() => {
          avatarPresses.push("pressed");
        });

        return {
          title,
          header: {
            $chatName,
            chatNameChanged,
            headerAvatarPressed,
          },
        };
      },
    });

    let lastEntitySnapshot: unknown = null;

    function Harness() {
      const entity = useModel(screenModel, {
        data: { title: "Messages" },
      });

      lastEntitySnapshot = {
        header: {
          chatName: entity.header.chatName,
          hasRawChatName: "$chatName" in (entity.header as object),
          hasRawChatNameChanged: "chatNameChanged" in (entity.header as object),
          hasOnChatNameChanged: typeof entity.header.onChatNameChanged === "function",
          hasOnHeaderAvatarPressed:
            typeof entity.header.onHeaderAvatarPressed === "function",
        },
      };

      expectTypeOf(entity.header.chatName).toEqualTypeOf<string>();
      expectTypeOf(entity.header.onChatNameChanged).toMatchTypeOf<
        (payload: string) => void
      >();
      expectTypeOf(entity.header.onHeaderAvatarPressed).toMatchTypeOf<
        () => void
      >();

      return (
        <div>
          <div data-testid="screen-title">{entity.title}</div>
          <div data-testid="header-chat-name">{entity.header.chatName}</div>
          <button
            onClick={() => entity.header.onChatNameChanged("Random")}
            type="button"
          >
            change nested chat name
          </button>
          <button
            onClick={() => entity.header.onHeaderAvatarPressed()}
            type="button"
          >
            press nested avatar
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("screen-title").textContent).toBe("Messages");
      expect(screen.getByTestId("header-chat-name").textContent).toBe(
        "General",
      );
    });

    expect(lastEntitySnapshot).not.toBeNull();
    if (!lastEntitySnapshot) {
      throw new Error("nested naming snapshot is missing");
    }
    const nestedNamingSnapshot = lastEntitySnapshot as {
      header: {
        chatName: string;
        hasRawChatName: boolean;
        hasRawChatNameChanged: boolean;
        hasOnChatNameChanged: boolean;
        hasOnHeaderAvatarPressed: boolean;
      };
    };
    expect(nestedNamingSnapshot.header).toMatchObject({
      chatName: "General",
    });
    expect(nestedNamingSnapshot.header.hasRawChatName).toBe(false);
    expect(nestedNamingSnapshot.header.hasRawChatNameChanged).toBe(false);
    expect(nestedNamingSnapshot.header.hasOnChatNameChanged).toBe(true);
    expect(nestedNamingSnapshot.header.hasOnHeaderAvatarPressed).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "change nested chat name" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("header-chat-name").textContent).toBe("Random");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "press nested avatar" }),
    );

    expect(avatarPresses).toStrictEqual(["pressed"]);
  });

  test("useModel rerenders for derived stores inside nested factory objects", async () => {
    const scope = fork();

    function createHeaderModel() {
      const $chat = createStore<{ name: string } | null>(null);
      const $typingUsers = createStore<string[]>([]);
      const chatChanged = createEvent<{ name: string } | null>();
      const typingUsersChanged = createEvent<string[]>();

      sample({
        clock: chatChanged,
        target: $chat,
      });

      sample({
        clock: typingUsersChanged,
        target: $typingUsers,
      });

      const $chatName = $chat.map((chat) => chat?.name ?? "");
      const $chatSubtitle = combine(
        $chat,
        $typingUsers,
        (chat, typingUsers) => {
          if (!chat) {
            return "";
          }

          return typingUsers.length > 0 ? "typing..." : chat.name;
        },
      );

      return {
        $chat,
        $typingUsers,
        $chatName,
        $chatSubtitle,
        chatChanged,
        typingUsersChanged,
      };
    }

    const screenModel = model({
      contract: contract({})(),
      fn: () => {
        const header = createHeaderModel();

        return {
          header,
        };
      },
    });

    function Harness() {
      const entity = useModel(screenModel);

      return (
        <div>
          <div data-testid="chat-name">{entity.header.chatName || "empty"}</div>
          <div data-testid="chat-subtitle">
            {entity.header.chatSubtitle || "empty"}
          </div>
          <button
            onClick={() => entity.header.onChatChanged({ name: "General" })}
            type="button"
          >
            set chat
          </button>
          <button
            onClick={() => entity.header.onTypingUsersChanged(["u1"])}
            type="button"
          >
            set typing
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("empty");
      expect(screen.getByTestId("chat-subtitle").textContent).toBe("empty");
    });

    fireEvent.click(screen.getByRole("button", { name: "set chat" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("General");
      expect(screen.getByTestId("chat-subtitle").textContent).toBe("General");
    });

    fireEvent.click(screen.getByRole("button", { name: "set typing" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-subtitle").textContent).toBe("typing...");
    });
  });

  test("useModel rerenders nested derived stores after mounted async flow for retained id instances", async () => {
    const scope = fork();

    function createHeaderModel() {
      const $chat = createStore<{ name: string } | null>(null);
      const chatChanged = createEvent<{ name: string } | null>();

      sample({
        clock: chatChanged,
        target: $chat,
      });

      const $chatName = $chat.map((chat) => chat?.name ?? "");

      return {
        $chat,
        $chatName,
        chatChanged,
      };
    }

    const getChatFx = createEffect(async (id: string) => ({ name: `Chat ${id}` }));

    const screenModel = model({
      contract: contract({
        mounted: define.event(define.schema<TStatic<{ id: string }>>()),
      })(),
      fn: ({ mounted }) => {
        const header = createHeaderModel();

        sample({
          clock: mounted,
          fn: ({ id }) => id,
          target: getChatFx,
        });

        sample({
          clock: getChatFx.doneData,
          target: header.chatChanged,
        });

        return {
          header,
          mounted,
        };
      },
    });

    function Harness({ id }: { id: string }) {
      const entity = useModel(screenModel, {
        id,
        retain: true,
      });

      useEffect(() => {
        entity.onMounted({ id });
      }, [entity.onMounted, id]);

      return <div data-testid="chat-name">{entity.header.chatName || "empty"}</div>;
    }

    const view = renderInScope(scope, <Harness id="a" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("Chat a");
    });

    view.rerender(<Harness id="b" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("Chat b");
    });

    view.rerender(<Harness id="a" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("Chat a");
    });
  });

  test("useModel reads nested derived stores combined with external stores", async () => {
    const $currentUser = createStore<{ id: string } | null>(null);
    const scope = fork({
      values: [[$currentUser, { id: "me" }]],
    });

    function createHeaderModel() {
      const $chat = createStore<{
        type: "PERSONAL" | "GROUP";
        name: string;
        members: Array<{ id: string; name: string }>;
      } | null>(null);
      const chatChanged = createEvent<{
        type: "PERSONAL" | "GROUP";
        name: string;
        members: Array<{ id: string; name: string }>;
      } | null>();

      sample({
        clock: chatChanged,
        target: $chat,
      });

      const $chatName = combine($chat, $currentUser, (chat, user) => {
        if (!chat || !user) {
          return "";
        }

        if (chat.type === "GROUP") {
          return chat.name;
        }

        const otherMember = chat.members.find((member) => member.id !== user.id);
        return otherMember?.name ?? "";
      });

      return {
        $chat,
        $chatName,
        chatChanged,
      };
    }

    const screenModel = model({
      contract: contract({})(),
      fn: () => {
        const header = createHeaderModel();

        return {
          header,
        };
      },
    });

    function Harness() {
      const entity = useModel(screenModel);

      return (
        <div>
          <div data-testid="chat-name">{entity.header.chatName || "empty"}</div>
          <button
            onClick={() =>
              entity.header.onChatChanged({
                type: "PERSONAL",
                name: "",
                members: [
                  { id: "me", name: "Current User" },
                  { id: "other", name: "Evgeny" },
                ],
              })}
            type="button"
          >
            set personal chat
          </button>
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("empty");
    });

    fireEvent.click(screen.getByRole("button", { name: "set personal chat" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-name").textContent).toBe("Evgeny");
    });
  });

  test("useModel isolates nested plain-object state between different ids", async () => {
    const scope = fork();

    const screenModel = model({
      contract: contract({})(),
      fn: () => {
        const $messages = createStore<string[]>([]);
        const messagesChanged = createEvent<string[]>();

        sample({
          clock: messagesChanged,
          target: $messages,
        });

        return {
          messagesList: {
            $messages,
            messagesChanged,
          },
        };
      },
    });

    function Harness({ modelId }: { modelId: string }) {
      const entity = useModel(screenModel, {
        id: modelId,
        retain: true,
      });

      return (
        <div>
          <div data-testid="entity-id">{entity.id}</div>
          <div data-testid="messages">
            {entity.messagesList.messages.join(",") || "empty"}
          </div>
          <button
            onClick={() => entity.messagesList.onMessagesChanged(["hello"])}
            type="button"
          >
            set messages
          </button>
        </div>
      );
    }

    const view = renderInScope(scope, <Harness modelId="chat-a" />);

    await waitFor(() => {
      expect(screen.getByTestId("entity-id").textContent).toBe("chat-a");
      expect(screen.getByTestId("messages").textContent).toBe("empty");
    });

    fireEvent.click(screen.getByRole("button", { name: "set messages" }));

    await waitFor(() => {
      expect(screen.getByTestId("messages").textContent).toBe("hello");
    });

    view.rerender(<Harness modelId="chat-b" />);

    expect(screen.getByTestId("entity-id").textContent).toBe("chat-b");
    expect(screen.getByTestId("messages").textContent).toBe("empty");

    view.rerender(<Harness modelId="chat-a" />);

    expect(screen.getByTestId("entity-id").textContent).toBe("chat-a");
    expect(screen.getByTestId("messages").textContent).toBe("hello");
  });

  test("useModel preserves instance context for async nested plain-object updates", async () => {
    const scope = fork();

    const screenModel = model({
      contract: contract({
        mounted: define.event(define.schema<TVoid>()),
      })(),
      fn: ({ mounted }) => {
        const loadMessagesFx = createEffect(async () => ["hello", "world"]);
        const $messages = createStore<string[]>([]);
        const messagesChanged = createEvent<string[]>();

        sample({
          clock: mounted,
          target: loadMessagesFx,
        });

        sample({
          clock: loadMessagesFx.doneData,
          target: messagesChanged,
        });

        sample({
          clock: messagesChanged,
          target: $messages,
        });

        return {
          mounted,
          messagesList: {
            $messages,
            messagesChanged,
          },
        };
      },
    });

    function Harness() {
      const entity = useModel(screenModel, {
        id: "chat-a",
        retain: true,
      });

      useEffect(() => {
        entity.onMounted();
      }, [entity]);

      return (
        <div data-testid="async-messages">
          {entity.messagesList.messages.join(",") || "empty"}
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("async-messages").textContent).toBe(
        "hello,world",
      );
    });
  });

  test("useModel preserves instance context for async updates from shared effects", async () => {
    const scope = fork();
    const sharedGetChatFx = createEffect(async ({ id }: { id: string }) => ({
      ok: true as const,
      data: { id },
    }));
    const sharedGetMessagesFx = createEffect(
      async ({ chatId }: { chatId: string }) => ({
        ok: true as const,
        data: [`message:${chatId}`],
      }),
    );

    const screenModel = model({
      contract: contract({
        mounted: define.event(define.schema<TStatic<{ id: string }>>()),
      })(),
      fn: ({ mounted }) => {
        const $chat = createStore<{ id: string } | null>(null);
        const $messages = createStore<string[]>([]);
        const chatChanged = createEvent<{ id: string } | null>();
        const messagesChanged = createEvent<string[]>();

        sample({
          clock: chatChanged,
          target: $chat,
        });

        sample({
          clock: messagesChanged,
          target: $messages,
        });

        sample({
          clock: mounted,
          fn: ({ id }: { id: string }) => ({ id }),
          target: sharedGetChatFx,
        });

        sample({
          clock: sharedGetChatFx.doneData,
          filter: (result) => result.ok,
          fn: (result) => result.data,
          target: chatChanged,
        });

        sample({
          clock: sharedGetChatFx.doneData,
          filter: (result) => result.ok,
          fn: (result) => ({ chatId: result.data.id }),
          target: sharedGetMessagesFx,
        });

        sample({
          clock: sharedGetMessagesFx.doneData,
          source: {
            chat: $chat,
          },
          filter: (source, result) => result.ok && source.chat !== null,
          fn: (_source, result) => result.data,
          target: messagesChanged,
        });

        return {
          mounted,
          messagesList: {
            $chat,
            $messages,
            chatChanged,
            messagesChanged,
          },
        };
      },
    });

    function Harness() {
      const entity = useModel(screenModel, {
        id: "chat-a",
        retain: true,
      });

      useEffect(() => {
        entity.onMounted({ id: "chat-a" });
      }, [entity]);

      return (
        <div data-testid="shared-async-messages">
          {entity.messagesList.messages.join(",") || "empty"}
        </div>
      );
    }

    renderInScope(scope, <Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("shared-async-messages").textContent).toBe(
        "message:chat-a",
      );
    });
  });

  test("useModel switches top-level state synchronously when id changes", async () => {
    const scope = fork();
    const counterModel = createCounterModel();

    function Harness({ modelId }: { modelId: string }) {
      const entity = useModel(counterModel, {
        id: modelId,
        retain: true,
      });

      return (
        <div>
          <div data-testid="entity-id">{entity.id}</div>
          <div data-testid="entity-count">{String(entity.count)}</div>
          <button onClick={() => entity.onSetCount(5)} type="button">
            change count
          </button>
        </div>
      );
    }

    const view = renderInScope(scope, <Harness modelId="chat-a" />);

    await waitFor(() => {
      expect(screen.getByTestId("entity-id").textContent).toBe("chat-a");
      expect(screen.getByTestId("entity-count").textContent).toBe("0");
    });

    fireEvent.click(screen.getByRole("button", { name: "change count" }));

    await waitFor(() => {
      expect(screen.getByTestId("entity-count").textContent).toBe("5");
    });

    view.rerender(<Harness modelId="chat-b" />);

    expect(screen.getByTestId("entity-id").textContent).toBe("chat-b");
    expect(screen.getByTestId("entity-count").textContent).toBe("0");
    expect(scope.getState(counterModel.$instances)).toMatchObject({
      "chat-a": {
        count: 5,
      },
      "chat-b": {
        count: 0,
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
            $opened: opened,
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

  test("component view preserves root id but renames nested id events to onId", async () => {
    const scope = fork();
    const nestedIds: string[] = [];

    const Panel = component({
      contract: contract({
        title: define.store(define.schema<TString>(), ""),
      })(),
      model: ({ title }) => {
        const nestedId = createEvent<string>();

        nestedId.watch((value) => {
          nestedIds.push(value);
        });

        return {
          title,
          panel: {
            id: nestedId,
          },
        };
      },
      view: ({ id, title, panel }) => {
        expectTypeOf(id).toEqualTypeOf<string>();
        expectTypeOf(panel.onId).toMatchTypeOf<(payload: string) => void>();

        return (
          <div>
            <div data-testid="root-id">{id}</div>
            <div data-testid="root-title">{title}</div>
            <button onClick={() => panel.onId("nested-1")} type="button">
              trigger nested id
            </button>
          </div>
        );
      },
    });

    renderInScope(scope, <Panel title="Panel" />);

    await waitFor(() => {
      expect(screen.getByTestId("root-id").textContent).toBeTruthy();
      expect(screen.getByTestId("root-title").textContent).toBe("Panel");
    });

    fireEvent.click(screen.getByRole("button", { name: "trigger nested id" }));

    await waitFor(() => {
      expect(nestedIds).toStrictEqual(["nested-1"]);
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
              todo.onSetTitle(event.target.value);
            }}
          />
          <input
            aria-label="todo-done-input"
            checked={todo.done}
            onChange={() => {
              todo.onChangeDone();
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
              todo.onSetTitle(event.target.value);
            }}
          />
          <input
            aria-label={`todo-done-input-${id}`}
            checked={todo.done}
            onChange={() => {
              todo.onChangeDone();
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

    expectTypeOf<Parameters<typeof ValueComponent>[0]["value"]>().toEqualTypeOf<
      "hello" | "updated" | undefined
    >();
    expectTypeOf<typeof controlled>().toMatchTypeOf<
      NonNullable<Parameters<typeof ValueComponent>[0]["model"]>
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
