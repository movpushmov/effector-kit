/**
 * Lens tests.
 *
 * KEY PATTERN for mutation tests:
 *   1. Create instances globally (m.create) so getRuntimeInfo can find them.
 *   2. Fork with explicit initial values: fork({ values: [[m.$instances, m.$instances.getState()]] })
 *      This shallow-copies the global instance map into the scope, so the
 *      same instance objects are shared. In-place mutations from the lens
 *      are visible through both global getState() and scope.getState().
 *   3. Wire trigger → lens target via sample, then allSettled(trigger, { scope }).
 *   4. Assert via scope.getState(m.$instances).
 */
import { describe, test, expect } from "vitest";
import {
  sample,
  createEvent,
  fork,
  allSettled,
  type StoreWritable,
} from "effector";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeCounter() {
  return model({
    contract: contract({ count: define.store(define.static<number>(), 0) })(),
    fn: ({ count }) => ({ count }),
  });
}

function makeTagged() {
  return model({
    contract: contract({
      tag: define.store(define.static<"a" | "b">(), "a"),
      value: define.store(define.static<number>(), 0),
    })(),
    fn: ({ tag, value }) => ({ tag, value }),
  });
}

/** Fork with the current global $instances state pre-loaded into scope. */
function forkWithInstances<M extends { $instances: any }>(m: M) {
  return fork({ values: [[m.$instances, m.$instances.getState()]] });
}

// ---------------------------------------------------------------------------
// lens.getSource()
// ---------------------------------------------------------------------------

describe("lens.getSource()", () => {
  test("returns empty object when no instances exist", () => {
    const m = makeCounter();
    expect(m.lens.getSource()).toEqual({});
  });

  test("returns all instances after global creation", () => {
    const m = makeCounter();
    m.create({ id: "1", data: { count: 1 } });
    m.create({ id: "2", data: { count: 2 } });
    expect(Object.keys(m.lens.getSource())).toHaveLength(2);
  });

  test("reflects instance data", () => {
    const m = makeCounter();
    m.create({ id: "x", data: { count: 77 } });
    expect(m.lens.getSource()["x"]).toMatchObject({ count: 77 });
  });
});

// ---------------------------------------------------------------------------
// lens store target() — mutations via fork/allSettled
// ---------------------------------------------------------------------------

describe("lens store target() via scope", () => {
  test("updates ALL instances when no filter", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });
    m.create({ id: "c", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 42 });

    const instances = scope.getState(m.$instances);
    expect(instances["a"]?.count).toBe(42);
    expect(instances["b"]?.count).toBe(42);
    expect(instances["c"]?.count).toBe(42);
  });

  test("update does NOT affect instances of a DIFFERENT model", async () => {
    const m1 = makeCounter();
    const m2 = makeCounter();
    const trigger1 = createEvent<number>();
    sample({ clock: trigger1, target: m1.lens.count.target() });

    m1.create({ id: "1", data: { count: 0 } });
    m2.create({ id: "1", data: { count: 0 } });

    const scope = fork({
      values: [
        [m1.$instances as StoreWritable<any>, m1.$instances.getState()],
        [m2.$instances as StoreWritable<any>, m2.$instances.getState()],
      ],
    });
    await allSettled(trigger1, { scope, params: 99 });

    expect(scope.getState(m1.$instances)["1"]?.count).toBe(99);
    expect(scope.getState(m2.$instances)["1"]?.count).toBe(0);
  });

  test("target called multiple times accumulates correctly", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "a", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 10 });
    expect(scope.getState(m.$instances)["a"]?.count).toBe(10);

    await allSettled(trigger, { scope, params: 20 });
    expect(scope.getState(m.$instances)["a"]?.count).toBe(20);
  });

  test("target on non-existent instances is a no-op", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    const scope = fork({ values: [[m.$instances as StoreWritable<any>, {}]] });
    await allSettled(trigger, { scope, params: 999 });

    expect(scope.getState(m.$instances)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// lens.where() — filtering
// ---------------------------------------------------------------------------

describe("lens.where() filtering via scope", () => {
  test("target only updates instances matching the predicate", async () => {
    const m = makeTagged();
    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens.where(({ tag }) => tag === "a").value.target(),
    });

    m.create({ id: "1", data: { tag: "a", value: 0 } });
    m.create({ id: "2", data: { tag: "b", value: 0 } });
    m.create({ id: "3", data: { tag: "a", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 100 });

    const instances = scope.getState(m.$instances);
    expect(instances["1"]?.value).toBe(100);
    expect(instances["2"]?.value).toBe(0);
    expect(instances["3"]?.value).toBe(100);
  });

  test("predicate matching no instances is a no-op", async () => {
    const m = makeTagged();
    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens.where(({ tag }) => tag === "b").value.target(),
    });

    m.create({ id: "1", data: { tag: "a", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 555 });

    expect(scope.getState(m.$instances)["1"]?.value).toBe(0);
  });

  test("predicate matching all instances updates all", async () => {
    const m = makeTagged();
    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens.where(() => true).value.target(),
    });

    m.create({ id: "1", data: { tag: "a", value: 0 } });
    m.create({ id: "2", data: { tag: "b", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 77 });

    const instances = scope.getState(m.$instances);
    expect(instances["1"]?.value).toBe(77);
    expect(instances["2"]?.value).toBe(77);
  });
});

// ---------------------------------------------------------------------------
// lens.delete()
// ---------------------------------------------------------------------------

describe("lens.delete() via scope", () => {
  test("removes instances matching where()", async () => {
    const m = makeTagged();
    const trigger = createEvent<void>();
    sample({ clock: trigger, target: m.lens.where(({ tag }) => tag === "a").delete() });

    m.create({ id: "1", data: { tag: "a", value: 0 } });
    m.create({ id: "2", data: { tag: "b", value: 0 } });
    m.create({ id: "3", data: { tag: "a", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope });

    const instances = scope.getState(m.$instances);
    expect(instances["1"]).toBeUndefined();
    expect(instances["3"]).toBeUndefined();
    expect(instances["2"]?.tag).toBe("b");
  });

  test("without where removes all instances", async () => {
    const m = makeCounter();
    const trigger = createEvent<void>();
    sample({ clock: trigger, target: m.lens.delete() });

    m.create({ id: "x", data: { count: 1 } });
    m.create({ id: "y", data: { count: 2 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope });

    expect(scope.getState(m.$instances)).toEqual({});
  });

  test("first().delete() removes a single instance", async () => {
    const m = makeCounter();
    const trigger = createEvent<void>();
    sample({ clock: trigger, target: m.lens.first().delete() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope });

    const instances = scope.getState(m.$instances);
    expect(Object.keys(instances)).toHaveLength(1);
    expect(instances["b"]).toBeDefined();
  });

  test("matching no instances is a no-op", async () => {
    const m = makeTagged();
    const trigger = createEvent<void>();
    sample({
      clock: trigger,
      target: m.lens.where(({ tag }) => tag === "b").delete(),
    });

    m.create({ id: "1", data: { tag: "a", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope });

    expect(scope.getState(m.$instances)["1"]?.tag).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// lens.first() / lens.last()
// ---------------------------------------------------------------------------

describe("lens.first() via scope", () => {
  test("targets only the first instance", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.first().count.target() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });
    m.create({ id: "c", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 111 });

    const instances = scope.getState(m.$instances);
    const updatedIds = Object.entries(instances)
      .filter(([, v]) => v.count === 111)
      .map(([k]) => k);

    expect(updatedIds).toHaveLength(1);
    expect(updatedIds[0]).toBe(Object.keys(instances)[0]);
  });

  test("first() on empty instances is a no-op", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.first().count.target() });

    const scope = fork({ values: [[m.$instances as StoreWritable<any>, {}]] });
    await allSettled(trigger, { scope, params: 99 });

    expect(scope.getState(m.$instances)).toEqual({});
  });

  test("first() on single instance updates that instance", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.first().count.target() });

    m.create({ id: "only", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 7 });

    expect(scope.getState(m.$instances)["only"]?.count).toBe(7);
  });
});

describe("lens.last() via scope", () => {
  test("targets only the last instance", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.last().count.target() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });
    m.create({ id: "c", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 222 });

    const instances = scope.getState(m.$instances);
    const updatedIds = Object.entries(instances)
      .filter(([, v]) => v.count === 222)
      .map(([k]) => k);

    expect(updatedIds).toHaveLength(1);
    expect(updatedIds[0]).toBe(Object.keys(instances).at(-1));
  });

  test("last() on single instance equals first()", async () => {
    const m1 = makeCounter();
    const m2 = makeCounter();
    const t1 = createEvent<number>();
    const t2 = createEvent<number>();
    sample({ clock: t1, target: m1.lens.first().count.target() });
    sample({ clock: t2, target: m2.lens.last().count.target() });

    m1.create({ id: "solo", data: { count: 0 } });
    m2.create({ id: "solo", data: { count: 0 } });

    const scope1 = forkWithInstances(m1);
    const scope2 = forkWithInstances(m2);
    await allSettled(t1, { scope: scope1, params: 50 });
    await allSettled(t2, { scope: scope2, params: 50 });

    expect(scope1.getState(m1.$instances)["solo"]?.count).toBe(50);
    expect(scope2.getState(m2.$instances)["solo"]?.count).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// lens — event targeting via scope
// ---------------------------------------------------------------------------

describe("lens event target() via scope", () => {
  test("fires an event inside instance context so sample in fn runs", async () => {
    const m = model({
      contract: contract({
        total: define.store(define.static<number>(), 0),
        add: define.event(define.static<number>()),
      })(),
      fn: ({ total, add }) => {
        sample({
          clock: add,
          source: total,
          fn: (t, n) => t + n,
          target: total,
        });
        return { total, add };
      },
    });

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.add.target() });

    m.create({ id: "e1", data: { total: 10 } });
    m.create({ id: "e2", data: { total: 20 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 5 });

    expect(scope.getState(m.$instances)["e1"]?.total).toBe(15);
    expect(scope.getState(m.$instances)["e2"]?.total).toBe(25);
  });

  test("fires event only in filtered instances", async () => {
    const m = model({
      contract: contract({
        active: define.store(define.static<boolean>(), false),
        score: define.store(define.static<number>(), 0),
        grant: define.event(define.static<number>()),
      })(),
      fn: ({ active, score, grant }) => {
        sample({
          clock: grant,
          source: score,
          fn: (s, n) => s + n,
          target: score,
        });
        return { active, score, grant };
      },
    });

    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens.where(({ active }) => active).grant.target(),
    });

    m.create({ id: "active", data: { active: true, score: 0 } });
    m.create({ id: "inactive", data: { active: false, score: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 10 });

    expect(scope.getState(m.$instances)["active"]?.score).toBe(10);
    expect(scope.getState(m.$instances)["inactive"]?.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lens — parallel (many instances)
// ---------------------------------------------------------------------------

describe("lens parallel operations on many instances via scope", () => {
  test("target updates 100 instances simultaneously", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    const COUNT = 100;
    for (let i = 0; i < COUNT; i++) {
      m.create({ id: String(i), data: { count: i } });
    }

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 0 });

    const instances = scope.getState(m.$instances);
    for (let i = 0; i < COUNT; i++) {
      expect(instances[String(i)]?.count).toBe(0);
    }
  });

  test("where filter with 100 instances updates only matching half", async () => {
    const m = model({
      contract: contract({
        even: define.store(define.static<boolean>(), false),
        value: define.store(define.static<number>(), 0),
      })(),
      fn: ({ even, value }) => ({ even, value }),
    });

    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens.where(({ even }) => even).value.target(),
    });

    const COUNT = 100;
    for (let i = 0; i < COUNT; i++) {
      m.create({ id: String(i), data: { even: i % 2 === 0, value: 0 } });
    }

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 1 });

    const instances = scope.getState(m.$instances);
    for (let i = 0; i < COUNT; i++) {
      if (i % 2 === 0) {
        expect(instances[String(i)]?.value).toBe(1);
      } else {
        expect(instances[String(i)]?.value).toBe(0);
      }
    }
  });

  test("sequential targets on different models are independent", async () => {
    const m1 = makeTagged();
    const m2 = makeTagged();
    const triggerA = createEvent<number>();
    const triggerB = createEvent<number>();
    sample({
      clock: triggerA,
      target: m1.lens.where(({ tag }) => tag === "a").value.target(),
    });
    sample({
      clock: triggerB,
      target: m2.lens.where(({ tag }) => tag === "b").value.target(),
    });

    m1.create({ id: "1", data: { tag: "a", value: 0 } });
    m1.create({ id: "2", data: { tag: "b", value: 0 } });
    m2.create({ id: "1", data: { tag: "a", value: 0 } });
    m2.create({ id: "2", data: { tag: "b", value: 0 } });

    const scope = fork({
      values: [
        [m1.$instances as StoreWritable<any>, m1.$instances.getState()],
        [m2.$instances as StoreWritable<any>, m2.$instances.getState()],
      ],
    });
    await allSettled(triggerA, { scope, params: 10 });
    await allSettled(triggerB, { scope, params: 20 });

    expect(scope.getState(m1.$instances)["1"]?.value).toBe(10);
    expect(scope.getState(m1.$instances)["2"]?.value).toBe(0);
    expect(scope.getState(m2.$instances)["1"]?.value).toBe(0);
    expect(scope.getState(m2.$instances)["2"]?.value).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// lens — chaining (where + first / last)
// ---------------------------------------------------------------------------

describe("lens chaining via scope", () => {
  test("where + first: only first matching instance is updated", async () => {
    const m = makeTagged();
    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens
        .where(({ tag }) => tag === "a")
        .first()
        .value.target(),
    });

    m.create({ id: "1", data: { tag: "a", value: 0 } });
    m.create({ id: "2", data: { tag: "a", value: 0 } });
    m.create({ id: "3", data: { tag: "b", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 999 });

    const instances = scope.getState(m.$instances);
    const updated = Object.entries(instances).filter(
      ([, v]) => v.value === 999,
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.[0]).toBe("1");
    expect(instances["2"]?.value).toBe(0);
    expect(instances["3"]?.value).toBe(0);
  });

  test("where + last: only last matching instance is updated", async () => {
    const m = makeTagged();
    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens
        .where(({ tag }) => tag === "a")
        .last()
        .value.target(),
    });

    m.create({ id: "1", data: { tag: "a", value: 0 } });
    m.create({ id: "2", data: { tag: "a", value: 0 } });
    m.create({ id: "3", data: { tag: "b", value: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 888 });

    const instances = scope.getState(m.$instances);
    const updated = Object.entries(instances).filter(
      ([, v]) => v.value === 888,
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]?.[0]).toBe("2");
    expect(instances["1"]?.value).toBe(0);
    expect(instances["3"]?.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lens — clock()
// ---------------------------------------------------------------------------

describe("lens clock()", () => {
  test("clock() creates an observable event on a store", () => {
    const m = makeCounter();
    const clockEvent = m.lens.count.clock();
    expect(clockEvent).toBeDefined();
    expect(typeof (clockEvent as any).watch).toBe("function");
  });

  test("clock() creates an observable on an event", () => {
    const m = model({
      contract: contract({ clicked: define.event(define.static<void>()) })(),
      fn: ({ clicked }) => ({ clicked }),
    });
    expect(m.lens.clicked.clock()).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// lens — props()
// ---------------------------------------------------------------------------

describe("lens.props()", () => {
  test("props() returns the same lens (identity)", () => {
    const m = makeCounter();
    const typed = m.lens.props<{ id: string }>();
    expect(typed).toBeDefined();
    expect(typeof typed.getSource).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// lens — wired via external sample
// ---------------------------------------------------------------------------

describe("lens wired via sample", () => {
  test("external event triggers store update on all instances", async () => {
    const m = makeCounter();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "1", data: { count: 0 } });
    m.create({ id: "2", data: { count: 0 } });

    const scope = forkWithInstances(m);
    await allSettled(trigger, { scope, params: 50 });

    expect(scope.getState(m.$instances)["1"]?.count).toBe(50);
    expect(scope.getState(m.$instances)["2"]?.count).toBe(50);
  });

  test("fn-mapped event updates only the target field", async () => {
    const m = model({
      contract: contract({
        name: define.store(define.static<string>(), ""),
        age: define.store(define.static<number>(), 0),
      })(),
      fn: ({ name, age }) => ({ name, age }),
    });

    const renameEvent = createEvent<{ newName: string }>();
    sample({
      clock: renameEvent,
      fn: ({ newName }) => newName,
      target: m.lens.name.target(),
    });

    m.create({ id: "u1", data: { name: "Alice", age: 30 } });
    m.create({ id: "u2", data: { name: "Bob", age: 25 } });

    const scope = forkWithInstances(m);
    await allSettled(renameEvent, { scope, params: { newName: "Charlie" } });

    const instances = scope.getState(m.$instances);
    expect(instances["u1"]?.name).toBe("Charlie");
    expect(instances["u2"]?.name).toBe("Charlie");
    expect(instances["u1"]?.age).toBe(30);
    expect(instances["u2"]?.age).toBe(25);
  });
});
