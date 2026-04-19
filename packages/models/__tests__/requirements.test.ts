import { describe, test, expect } from "vitest";
import { child, contract, define, model, ref, union } from "../lib";
import { lens } from "../lib/lens";
import { type TBoolean, type TNumber, type TString } from "../lib/type-schema";
import { allSettled, createEvent, fork, sample, type EventCallable } from "effector";

async function createInstances(
  scope: ReturnType<typeof fork>,
  create: EventCallable<any>,
  params: any[],
) {
  await allSettled(create, { scope, params });
}

const todoList = model({
  contract: contract({
    title: define.store(define.schema<TString>(), ""),
    done: define.store(define.schema<TBoolean>(), false),
    changeDone: define.event(define.schema<TBoolean>()),
  })(),
  fn: ({ title, done, changeDone }) => {
    sample({
      clock: changeDone,
      target: done,
    });

    return {
      title,
      done,
      changeDone,
    };
  },
});

const counterModel = model({
  contract: contract({
    count: define.store(define.schema<TNumber>(), 0),
  })(),
  fn: ({ count }) => {
    const setCount = createEvent<number>();
    const increment = createEvent<void>();

    sample({
      clock: setCount,
      target: count,
    });

    sample({
      clock: increment,
      source: count,
      fn: (value) => value + 1,
      target: count,
    });

    return {
      count,
      setCount,
      increment,
    };
  },
});

const flaggedModel = model({
  contract: contract({
    score: define.store(define.schema<TNumber>(), 0),
  })(),
  fn: ({ score }) => {
    const setScore = createEvent<number>();

    sample({
      clock: setScore,
      target: score,
    });

    return {
      score,
      setScore,
    };
  },
});

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

function createDashboardModel() {
  return model({
    contract: contract({
      name: define.store(define.schema<TString>(), ""),
    })(),
    fn: ({ name }) => {
      const selected = ref(counterModel);
      const track = createEvent<string>();
      const untrack = createEvent<string>();
      const setSelectedCount = createEvent<number>();
      const deleteSelected = createEvent<void>();

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

      sample({
        clock: deleteSelected,
        target: selected.lens.delete(),
      });

      return {
        name,
        track,
        untrack,
        setSelectedCount,
        deleteSelected,
        selectedCountChanged: selected.lens.count.clock(),
        selected,
      };
    },
  });
}

function createDashboardUnionModel() {
  return model({
    contract: contract({
      name: define.store(define.schema<TString>(), ""),
    })(),
    fn: ({ name }) => {
      const selected = ref(
        union({ counter: counterModel, flagged: flaggedModel }),
      );

      const trackCounter = createEvent<string>();
      const untrackCounter = createEvent<string>();
      const trackFlagged = createEvent<string>();
      const untrackFlagged = createEvent<string>();
      const setSelectedValue = createEvent<number>();
      const setCounterOnly = createEvent<number>();
      const deleteSelected = createEvent<void>();
      const setFirstSelectedValue = createEvent<number>();
      const setLastSelectedValue = createEvent<number>();
      const setWithIsolatedMatch = createEvent<number>();
      const setMatchedByContext = createEvent<number>();
      const setByUniqueId = createEvent<number>();

      sample({
        clock: trackCounter,
        target: selected.add.counter,
      });

      sample({
        clock: untrackCounter,
        target: selected.remove.counter,
      });

      sample({
        clock: trackFlagged,
        target: selected.add.flagged,
      });

      sample({
        clock: untrackFlagged,
        target: selected.remove.flagged,
      });

      sample({
        clock: setSelectedValue,
        target: selected.lens.match({
          counter: (sub) => sub.count.target(),
          flagged: (sub) => sub.score.target(),
        }),
      });

      sample({
        clock: setCounterOnly,
        target: selected.lens.only("counter").counter.count.target(),
      });

      sample({
        clock: deleteSelected,
        target: selected.lens.match({
          counter: (sub) => sub.delete(),
          flagged: (sub) => sub.delete(),
        }),
      });

      sample({
        clock: setFirstSelectedValue,
        target: selected.lens.first().match({
          counter: (sub) => sub.count.target(),
          flagged: (sub) => sub.score.target(),
        }),
      });

      sample({
        clock: setLastSelectedValue,
        target: selected.lens.last().match({
          counter: (sub) => sub.count.target(),
          flagged: (sub) => sub.score.target(),
        }),
      });

      sample({
        clock: setWithIsolatedMatch,
        target: selected.lens.match({
          counter: (sub) =>
            sub.where((entity) => entity.count < 0).count.target(),
          flagged: (sub) =>
            sub.where((entity) => entity.score >= 0).score.target(),
        }),
      });

      sample({
        clock: setMatchedByContext,
        target: selected.lens
          .where(
            (entity, _, ctx) =>
              ctx?.match({
                counter: (counter) => counter.count > 0,
                flagged: (flagged) => flagged.score > 0,
              }) ?? false,
          )
          .match({
            counter: (sub) => sub.count.target(),
            flagged: (sub) => sub.score.target(),
          }),
      });

      sample({
        clock: setByUniqueId,
        target: selected.lens
          .only("counter")
          .where(
            (entity, _, ctx) =>
              ctx?.uniqueId("counter", entity.id) ===
              `${counterModel["~id"]}:a`,
          )
          .counter.count.target(),
      });

      return {
        name,
        trackCounter,
        untrackCounter,
        trackFlagged,
        untrackFlagged,
        setSelectedValue,
        setCounterOnly,
        deleteSelected,
        setFirstSelectedValue,
        setLastSelectedValue,
        setWithIsolatedMatch,
        setMatchedByContext,
        setByUniqueId,
      };
    },
  });
}

function createListModel() {
  return model({
    contract: contract({
      title: define.store(define.schema<TString>(), ""),
    })(),
    fn: ({ title }) => {
      const items = child(itemModel);
      const createItem = createEvent<{ id: string; data: { value: number } }>();
      const removeItem = createEvent<string>();
      const setItemsValue = createEvent<number>();

      sample({
        clock: createItem,
        target: items.create,
      });

      sample({
        clock: removeItem,
        target: items.delete,
      });

      sample({
        clock: setItemsValue,
        target: items.lens.value.target(),
      });

      return {
        title,
        createItem,
        removeItem,
        setItemsValue,
        itemsValueChanged: items.lens.value.clock(),
        items,
      };
    },
  });
}

function getChildInstancesByParent(
  scope: ReturnType<typeof fork>,
  parentModel: { $instances: { getState(): Record<string, any> } },
  childModel: { ["~id"]: string },
  parentId: string,
) {
  return (
    scope.getState(parentModel.$instances as any)[parentId]?.["~children"]?.[
      childModel["~id"]
    ] ?? {}
  );
}

describe("models api", () => {
  describe("instances", () => {
    test("create instance", async () => {
      const scope = fork();

      await allSettled(todoList.create, {
        scope,
        params: { id: "a", data: { title: "Todo #1", done: false } },
      });

      await allSettled(todoList.create, {
        scope,
        params: { id: "b", data: { title: "Todo #2", done: true } },
      });

      await allSettled(todoList.create, {
        scope,
        params: { id: "c", data: { title: "Todo #3", done: false } },
      });

      expect(scope.getState(todoList.$instances)).toStrictEqual({
        a: { title: "Todo #1", done: false },
        b: { title: "Todo #2", done: true },
        c: { title: "Todo #3", done: false },
      });
    });

    test("remove instance", async () => {
      const scope = fork();

      await createInstances(scope, todoList.create, [
        { id: "a", data: { title: "Todo #1", done: false } },
        { id: "b", data: { title: "Todo #2", done: true } },
        { id: "c", data: { title: "Todo #3", done: false } },
      ]);

      await allSettled(todoList.lens.where((e) => e.id === "a").delete(), {
        scope,
      });

      expect(scope.getState(todoList.$instances)).toStrictEqual({
        b: { title: "Todo #2", done: true },
        c: { title: "Todo #3", done: false },
      });
    });

    test("mass removing instances", async () => {
      const scope = fork();

      await createInstances(scope, todoList.create, [
        { id: "a", data: { title: "Todo #1", done: false } },
        { id: "b", data: { title: "Todo #2", done: true } },
        { id: "c", data: { title: "Todo #3", done: false } },
      ]);

      await allSettled(
        todoList.lens
          .where((e) => e.id === "a" || e.id === "b")
          .delete(),
        {
          scope,
        },
      );

      expect(scope.getState(todoList.$instances)).toStrictEqual({
        c: { title: "Todo #3", done: false },
      });
    });

    test("create several instances with one batch create call", async () => {
      const scope = fork();

      await createInstances(scope, todoList.create, [
        { id: "a", data: { title: "Todo #1", done: false } },
        { id: "b", data: { title: "Todo #2", done: true } },
        { id: "c", data: { title: "Todo #3", done: false } },
      ]);

      expect(scope.getState(todoList.$instances)).toStrictEqual({
        a: { title: "Todo #1", done: false },
        b: { title: "Todo #2", done: true },
        c: { title: "Todo #3", done: false },
      });
    });

    test("delete several instances with one delete call", async () => {
      const scope = fork();

      await createInstances(scope, todoList.create, [
        { id: "a", data: { title: "Todo #1", done: false } },
        { id: "b", data: { title: "Todo #2", done: true } },
        { id: "c", data: { title: "Todo #3", done: false } },
      ]);

      await allSettled(todoList.delete, {
        scope,
        params: ["a", "c"],
      });

      expect(scope.getState(todoList.$instances)).toStrictEqual({
        b: { title: "Todo #2", done: true },
      });
    });
  });

  describe("ref", () => {
    test("add instance", async () => {
      const scope = fork();

      await createInstances(scope, counterModel.create, [
        { id: "a", data: { count: 1 } },
        { id: "b", data: { count: 2 } },
      ]);

      const dashboardModel = createDashboardModel();

      await createInstances(scope, dashboardModel.create, [
        { id: "d1", data: { name: "Dashboard #1" } },
      ]);

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .setSelectedCount.target(),
        {
          scope,
          params: 10,
        },
      );

      expect(scope.getState(counterModel.$instances)).toStrictEqual({
        a: { count: 10 },
        b: { count: 2 },
      });
    });

    test("remove instance", async () => {
      const scope = fork();

      await createInstances(scope, counterModel.create, [
        { id: "a", data: { count: 1 } },
      ]);

      const dashboardModel = createDashboardModel();

      await createInstances(scope, dashboardModel.create, [
        { id: "d1", data: { name: "Dashboard #1" } },
      ]);

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .untrack.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .setSelectedCount.target(),
        {
          scope,
          params: 10,
        },
      );

      expect(scope.getState(counterModel.$instances)).toStrictEqual({
        a: { count: 1 },
      });
    });

    test("updates only instances tracked by the current parent", async () => {
      const scope = fork();

      await createInstances(scope, counterModel.create, [
        { id: "a", data: { count: 1 } },
        { id: "b", data: { count: 2 } },
        { id: "c", data: { count: 3 } },
      ]);

      const dashboardModel = createDashboardModel();

      await createInstances(scope, dashboardModel.create, [
        { id: "d1", data: { name: "Dashboard #1" } },
      ]);

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "c",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .setSelectedCount.target(),
        {
          scope,
          params: 100,
        },
      );

      expect(scope.getState(counterModel.$instances)).toStrictEqual({
        a: { count: 100 },
        b: { count: 2 },
        c: { count: 100 },
      });
    });

    test("stops updating an instance after it is removed from tracked ids", async () => {
      const scope = fork();

      await createInstances(scope, counterModel.create, [
        { id: "a", data: { count: 1 } },
        { id: "b", data: { count: 2 } },
      ]);

      const dashboardModel = createDashboardModel();

      await createInstances(scope, dashboardModel.create, [
        { id: "d1", data: { name: "Dashboard #1" } },
      ]);

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "b",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .untrack.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .setSelectedCount.target(),
        {
          scope,
          params: 50,
        },
      );

      expect(scope.getState(counterModel.$instances)).toStrictEqual({
        a: { count: 1 },
        b: { count: 50 },
      });
    });

    test("tracks ids independently for different parent instances", async () => {
      const scope = fork();

      await createInstances(scope, counterModel.create, [
        { id: "a", data: { count: 1 } },
        { id: "b", data: { count: 2 } },
      ]);

      const dashboardModel = createDashboardModel();

      await createInstances(scope, dashboardModel.create, [
        { id: "d1", data: { name: "Dashboard #1" } },
        { id: "d2", data: { name: "Dashboard #2" } },
      ]);

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d2").track.target(),
        {
          scope,
          params: "b",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d2")
          .setSelectedCount.target(),
        {
          scope,
          params: 20,
        },
      );

      expect(scope.getState(counterModel.$instances)).toMatchObject({
        a: { count: 1 },
        b: { count: 20 },
      });
    });

    test("does not duplicate tracked ref ids when tracking the same id repeatedly", async () => {
      const scope = fork();

      await createInstances(scope, counterModel.create, [
        { id: "a", data: { count: 1 } },
        { id: "b", data: { count: 2 } },
      ]);

      const dashboardModel = createDashboardModel();

      await createInstances(scope, dashboardModel.create, [
        { id: "d1", data: { name: "Dashboard #1" } },
      ]);

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
        {
          scope,
          params: "a",
        },
      );

      await allSettled(
        dashboardModel.lens
          .where((entity) => entity.id === "d1")
          .setSelectedCount.target(),
        {
          scope,
          params: 10,
        },
      );

      expect(scope.getState(counterModel.$instances)).toStrictEqual({
        a: { count: 10 },
        b: { count: 2 },
      });

      const counterModelRefId = dashboardModel["~api"].selected["~id"];

      expect(scope.getState(dashboardModel.$instances)).toMatchObject({
        d1: { name: "Dashboard #1", "~refs": { [counterModelRefId]: ["a"] } },
      });
    });

    describe("union ref", () => {
      test("tracks ids per model key", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 2 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setSelectedValue.target(),
          {
            scope,
            params: 8,
          },
        );

        expect(scope.getState(counterModel.$instances)).toStrictEqual({
          a: { count: 8 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 8 },
        });
      });

      test("updates only tracked variants when match dispatches by union", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
          { id: "f2", data: { score: 4 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setSelectedValue.target(),
          {
            scope,
            params: 11,
          },
        );

        expect(scope.getState(counterModel.$instances)).toStrictEqual({
          a: { count: 11 },
          b: { count: 2 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 11 },
          f2: { score: 4 },
        });
      });

      test("stops affecting a variant after it is removed from tracked ids", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 2 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .untrackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setSelectedValue.target(),
          {
            scope,
            params: 15,
          },
        );

        expect(scope.getState(counterModel.$instances)).toStrictEqual({
          a: { count: 15 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 2 },
        });
      });
    });
  });

  describe("child", () => {
    test("create instance", async () => {
      const scope = fork();
      const listModel = createListModel();
      const childItemsModel = (listModel as any)["~api"].items;

      await createInstances(scope, listModel.create, [
        { id: "l1", data: { title: "List #1" } },
      ]);

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .createItem.target(),
        {
          scope,
          params: { id: "i1", data: { value: 1 } },
        },
      );

      expect(scope.getState(childItemsModel.$instances)).toMatchObject({
        i1: { value: 1 },
      });
    });

    test("remove instance", async () => {
      const scope = fork();
      const listModel = createListModel();
      const childItemsModel = (listModel as any)["~api"].items;

      await createInstances(scope, listModel.create, [
        { id: "l1", data: { title: "List #1" } },
      ]);

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .createItem.target(),
        {
          scope,
          params: { id: "i1", data: { value: 1 } },
        },
      );

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .removeItem.target(),
        {
          scope,
          params: "i1",
        },
      );

      expect(scope.getState(childItemsModel.$instances)).toStrictEqual({});
    });

    test("keeps child instances hidden outside of a parent context", async () => {
      const scope = fork();
      const listModel = createListModel();
      const childItemsModel = (listModel as any)["~api"].items;

      await createInstances(scope, listModel.create, [
        { id: "l1", data: { title: "List #1" } },
      ]);

      await allSettled(childItemsModel.create, {
        scope,
        params: { id: "detached", data: { value: 1 } },
      });

      expect(scope.getState(childItemsModel.$instances)).toStrictEqual({});
      expect(
        getChildInstancesByParent(scope, listModel, childItemsModel, "l1"),
      ).toStrictEqual({});
    });

    test("stores child instances separately for each parent instance", async () => {
      const scope = fork();
      const listModel = createListModel();
      const childItemsModel = (listModel as any)["~api"].items;

      await createInstances(scope, listModel.create, [
        { id: "l1", data: { title: "List #1" } },
        { id: "l2", data: { title: "List #2" } },
      ]);

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .createItem.target(),
        {
          scope,
          params: { id: "shared", data: { value: 1 } },
        },
      );

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l2")
          .createItem.target(),
        {
          scope,
          params: { id: "shared", data: { value: 2 } },
        },
      );

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .items.value.target(),
        {
          scope,
          params: 10,
        },
      );

      expect(
        getChildInstancesByParent(scope, listModel, childItemsModel, "l1"),
      ).toMatchObject({
        shared: { value: 10 },
      });

      expect(
        getChildInstancesByParent(scope, listModel, childItemsModel, "l2"),
      ).toMatchObject({
        shared: { value: 2 },
      });
    });

    test("updates child units only inside the current parent context", async () => {
      const scope = fork();
      const listModel = createListModel();
      const childItemsModel = (listModel as any)["~api"].items;

      await createInstances(scope, listModel.create, [
        { id: "l1", data: { title: "List #1" } },
        { id: "l2", data: { title: "List #2" } },
      ]);

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .createItem.target(),
        {
          scope,
          params: { id: "i1", data: { value: 1 } },
        },
      );

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l2")
          .createItem.target(),
        {
          scope,
          params: { id: "i2", data: { value: 2 } },
        },
      );

      await allSettled(
        listModel.lens
          .where((entity) => entity.id === "l1")
          .items.value.target(),
        {
          scope,
          params: 7,
        },
      );

      expect(
        getChildInstancesByParent(scope, listModel, childItemsModel, "l1"),
      ).toMatchObject({
        i1: { value: 7 },
      });

      expect(
        getChildInstancesByParent(scope, listModel, childItemsModel, "l2"),
      ).toMatchObject({
        i2: { value: 2 },
      });
    });
  });

  describe("lens", () => {
    describe("model lens", () => {
      test("call instance unit", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await allSettled(
          counterModel.lens.where((entity) => entity.id === "a").setCount.target(),
          {
            scope,
            params: 7,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 7 },
          b: { count: 2 },
        });
      });

      test("call ref instance unit", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        const dashboardModel = createDashboardModel();

        await createInstances(scope, dashboardModel.create, [
          { id: "d1", data: { name: "Dashboard #1" } },
        ]);

        await allSettled(
          dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
          {
            scope,
            params: "b",
          },
        );

        await allSettled(
          dashboardModel.lens
            .where((entity) => entity.id === "d1")
            .setSelectedCount.target(),
          {
            scope,
            params: 14,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 1 },
          b: { count: 14 },
        });
      });

      test("call child instance unit", async () => {
        const scope = fork();
        const listModel = createListModel();
        const childItemsModel = (listModel as any)["~api"].items;

        await createInstances(scope, listModel.create, [
          { id: "l1", data: { title: "List #1" } },
        ]);

        await allSettled(
          listModel.lens
            .where((entity) => entity.id === "l1")
            .createItem.target(),
          {
            scope,
            params: { id: "i1", data: { value: 1 } },
          },
        );

        await allSettled(
          listModel.lens
            .where((entity) => entity.id === "l1")
            .setItemsValue.target(),
          {
            scope,
            params: 4,
          },
        );

        expect(scope.getState(childItemsModel.$instances)).toMatchObject({
          i1: { value: 4 },
        });
      });

      test("watch instance unit", async () => {
        const scope = fork();
        const seen: number[] = [];

        counterModel.lens
          .where((entity) => entity.id === "a")
          .count.clock()
          .watch((value) => seen.push(value));

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await allSettled(counterModel.lens.setCount.target(), {
          scope,
          params: 9,
        });

        expect(seen).toStrictEqual([9]);
      });

      test("watch ref instance unit", async () => {
        const scope = fork();
        const seen: number[] = [];
        const dashboardModel = createDashboardModel();
        const dashboardApi = (dashboardModel as any)["~api"];

        dashboardApi.selectedCountChanged.watch((value: number) =>
          seen.push(value),
        );

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, dashboardModel.create, [
          { id: "d1", data: { name: "Dashboard #1" } },
        ]);

        await allSettled(
          dashboardModel.lens.where((entity) => entity.id === "d1").track.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardModel.lens
            .where((entity) => entity.id === "d1")
            .setSelectedCount.target(),
          {
            scope,
            params: 16,
          },
        );

        expect(seen).toStrictEqual([16]);
      });

      test("watch child instance unit", async () => {
        const scope = fork();
        const seen: number[] = [];
        const listModel = createListModel();

        listModel.lens
          .where((entity) => entity.id === "l1")
          .items.value.clock()
          .watch((value) => seen.push(value));

        await createInstances(scope, listModel.create, [
          { id: "l1", data: { title: "List #1" } },
          { id: "l2", data: { title: "List #2" } },
        ]);

        await allSettled(
          listModel.lens
            .where((entity) => entity.id === "l1")
            .createItem.target(),
          {
            scope,
            params: { id: "i1", data: { value: 1 } },
          },
        );

        await allSettled(
          listModel.lens
            .where((entity) => entity.id === "l2")
            .createItem.target(),
          {
            scope,
            params: { id: "i2", data: { value: 2 } },
          },
        );

        await allSettled(
          listModel.lens
            .where((entity) => entity.id === "l2")
            .items.value.target(),
          {
            scope,
            params: 4,
          },
        );

        await allSettled(
          listModel.lens
            .where((entity) => entity.id === "l1")
            .items.value.target(),
          {
            scope,
            params: 9,
          },
        );

        expect(seen).toStrictEqual([9]);
      });

      test("mass calling", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
          { id: "c", data: { count: 3 } },
        ]);

        await allSettled(counterModel.lens.setCount.target(), {
          scope,
          params: 22,
        });

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 22 },
          b: { count: 22 },
          c: { count: 22 },
        });
      });

      test("mass watching", async () => {
        const scope = fork();
        const seen: number[] = [];

        counterModel.lens.count.clock().watch((value) => seen.push(value));

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
          { id: "c", data: { count: 3 } },
        ]);

        await allSettled(counterModel.lens.setCount.target(), {
          scope,
          params: 30,
        });

        expect(seen).toStrictEqual([30, 30, 30]);
      });

      test("limits action to the first matched instance", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
          { id: "c", data: { count: 3 } },
        ]);

        await allSettled(counterModel.lens.first().setCount.target(), {
          scope,
          params: 40,
        });

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 40 },
          b: { count: 2 },
          c: { count: 3 },
        });
      });

      test("limits action to the last matched instance", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
          { id: "c", data: { count: 3 } },
        ]);

        await allSettled(counterModel.lens.last().setCount.target(), {
          scope,
          params: 50,
        });

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 1 },
          b: { count: 2 },
          c: { count: 50 },
        });
      });

      test("filters model instances by ids without scanning the whole collection", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
          { id: "c", data: { count: 3 } },
        ]);

        await allSettled(counterModel.lens.ids("a", "c").setCount.target(), {
          scope,
          params: 60,
        });

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 60 },
          b: { count: 2 },
          c: { count: 60 },
        });
      });
    });

    describe("union lens", () => {
      test("splits actions by union variants with match", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setSelectedValue.target(),
          {
            scope,
            params: 60,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 60 },
          b: { count: 2 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 60 },
        });
      });

      test("limits available variants with only", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setCounterOnly.target(),
          {
            scope,
            params: 70,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 70 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 3 },
        });
      });

      test("deletes matched instances across several variants", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
          { id: "f2", data: { score: 4 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .deleteSelected.target(),
          {
            scope,
            params: undefined,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          b: { count: 2 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f2: { score: 4 },
        });
      });

      test("limits action to the first matched union entity", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "b",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setFirstSelectedValue.target(),
          {
            scope,
            params: 80,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 80 },
          b: { count: 2 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 3 },
        });
      });

      test("limits action to the last matched union entity", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
          { id: "f2", data: { score: 4 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f2",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setLastSelectedValue.target(),
          {
            scope,
            params: 90,
          },
        );

        expect(scope.getState(counterModel.$instances)).toStrictEqual({
          a: { count: 1 },
        });

        expect(scope.getState(flaggedModel.$instances)).toMatchObject({
          f1: { score: 3 },
          f2: { score: 90 },
        });
      });

      test("keeps sub-lens predicates isolated between match handlers", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 0 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setWithIsolatedMatch.target(),
          {
            scope,
            params: 95,
          },
        );

        expect(scope.getState(counterModel.$instances)).toStrictEqual({
          a: { count: 1 },
        });

        expect(scope.getState(flaggedModel.$instances)).toMatchObject({
          f1: { score: 95 },
        });
      });

      test("filters union instances by unique ids", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
          { id: "b", data: { count: 2 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 3 } },
        ]);

        const selection = union({
          counter: counterModel,
          flagged: flaggedModel,
        });
        const selectionLens = lens(selection);

        await allSettled(
          selectionLens
            .ids(
              selectionLens.uniqueId("counter", "a"),
              selectionLens.uniqueId("flagged", "f1"),
            )
            .match({
              counter: (counter) => counter.count.target(),
              flagged: (flagged) => flagged.score.target(),
            }),
          {
            scope,
            params: 70,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 70 },
          b: { count: 2 },
        });

        expect(scope.getState(flaggedModel.$instances)).toMatchObject({
          f1: { score: 70 },
        });
      });
    });

    describe("union where context", () => {
      test("supports ctx.match inside where", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 0 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setMatchedByContext.target(),
          {
            scope,
            params: 101,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 101 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 0 },
        });
      });

      test("supports ctx.uniqueId inside where", async () => {
        const scope = fork();

        await createInstances(scope, counterModel.create, [
          { id: "a", data: { count: 1 } },
        ]);

        await createInstances(scope, flaggedModel.create, [
          { id: "f1", data: { score: 2 } },
        ]);

        const dashboardUnionModel = createDashboardUnionModel();

        await createInstances(scope, dashboardUnionModel.create, [
          { id: "d1", data: { name: "Union dashboard" } },
        ]);

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackCounter.target(),
          {
            scope,
            params: "a",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .trackFlagged.target(),
          {
            scope,
            params: "f1",
          },
        );

        await allSettled(
          dashboardUnionModel.lens
            .where((entity) => entity.id === "d1")
            .setByUniqueId.target(),
          {
            scope,
            params: 111,
          },
        );

        expect(scope.getState(counterModel.$instances)).toMatchObject({
          a: { count: 111 },
        });

        expect(scope.getState(flaggedModel.$instances)).toStrictEqual({
          f1: { score: 2 },
        });
      });
    });
  });
});
