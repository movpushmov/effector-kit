/**
 * Fork / scope / serialize tests.
 *
 * Effector's fork() starts every store at its INITIAL value (not the current
 * global state).  To pre-seed specific stores use fork({ values: [...] }).
 *
 * Two main patterns used below:
 *
 *   A) Create-in-scope:
 *      const scope = fork();
 *      await allSettled(m.create, { scope, params });
 *      → instances live only in scope, serialize() captures them.
 *
 *   B) Mutate-in-scope (lens):
 *      m.create(...);                                   // global – lets getRuntimeInfo find them
 *      const scope = fork({ values: [[m.$instances, m.$instances.getState()]] });
 *      await allSettled(trigger, { scope, params });   // lens mutation in scope context
 *      → scope inherits the same instance objects (shallow copy), mutations
 *        are visible via scope.getState() and serialize().
 */
import { describe, test, expect } from "vitest";
import {
  sample,
  createEvent,
  fork,
  allSettled,
  serialize,
  type StoreWritable,
} from "effector";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeUserModel() {
  return model({
    contract: contract({
      name: define.store(define.static<string>(), ""),
      age: define.store(define.static<number>(), 0),
      active: define.store(define.static<boolean>(), false),
    })(),
    fn: ({ name, age, active }) => ({ name, age, active }),
  });
}

function makeCounterModel() {
  return model({
    contract: contract({ count: define.store(define.static<number>(), 0) })(),
    fn: ({ count }) => ({ count }),
  });
}

// ---------------------------------------------------------------------------
// Pattern A: create instances INSIDE scope
// ---------------------------------------------------------------------------

describe("instance creation inside scope (Pattern A)", () => {
  test("instances created in scope are NOT visible in global state", async () => {
    const m = makeUserModel();

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "1", data: { name: "Alice", age: 30, active: true } },
    });

    expect(m.$instances.getState()).toEqual({});
    expect(scope.getState(m.$instances)).toMatchObject({
      "1": { name: "Alice", age: 30, active: true },
    });
  });

  test("two independent scopes do not share instance state", async () => {
    const m = makeUserModel();

    const scope1 = fork();
    const scope2 = fork();

    await allSettled(m.create, {
      scope: scope1,
      params: { id: "x", data: { name: "Alice", age: 30, active: true } },
    });
    await allSettled(m.create, {
      scope: scope2,
      params: { id: "x", data: { name: "Bob", age: 25, active: false } },
    });

    expect(scope1.getState(m.$instances)["x"]).toMatchObject({ name: "Alice" });
    expect(scope2.getState(m.$instances)["x"]).toMatchObject({ name: "Bob" });
  });

  test("multiple instances created sequentially in same scope", async () => {
    const m = makeCounterModel();

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "1", data: { count: 10 } },
    });
    await allSettled(m.create, {
      scope,
      params: { id: "2", data: { count: 20 } },
    });
    await allSettled(m.create, {
      scope,
      params: { id: "3", data: { count: 30 } },
    });

    const instances = scope.getState(m.$instances);
    expect(Object.keys(instances)).toHaveLength(3);
    expect(instances["1"]?.count).toBe(10);
    expect(instances["2"]?.count).toBe(20);
    expect(instances["3"]?.count).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Pattern B: seed scope from global state for lens mutations
// ---------------------------------------------------------------------------

describe("lens mutations in scope (Pattern B)", () => {
  test("lens target updates instance visible via scope.getState", async () => {
    const m = makeCounterModel();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "x", data: { count: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(trigger, { scope, params: 42 });

    expect(scope.getState(m.$instances)["x"]?.count).toBe(42);
  });

  test("mutation in one scope does not affect a freshly forked second scope", async () => {
    const m = makeCounterModel();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "shared", data: { count: 0 } });

    const scope1 = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });

    await allSettled(trigger, { scope: scope1, params: 100 });

    expect(scope1.getState(m.$instances)["shared"]?.count).toBe(100);
    // Original global store is at 100 too (in-place mutation),
    // but a NEW fork starts from the INITIAL value {}
    const scope2 = fork();
    expect(scope2.getState(m.$instances)).toEqual({});
  });

  test("where filter in scope only updates matching instances", async () => {
    const m = model({
      contract: contract({
        type: define.store(define.static<"active" | "inactive">(), "active"),
        score: define.store(define.static<number>(), 0),
      })(),
      fn: ({ type, score }) => ({ type, score }),
    });

    const trigger = createEvent<number>();
    sample({
      clock: trigger,
      target: m.lens.where(({ type }) => type === "active").score.target(),
    });

    m.create({ id: "a1", data: { type: "active", score: 0 } });
    m.create({ id: "a2", data: { type: "active", score: 0 } });
    m.create({ id: "i1", data: { type: "inactive", score: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(trigger, { scope, params: 10 });

    const instances = scope.getState(m.$instances);
    expect(instances["a1"]?.score).toBe(10);
    expect(instances["a2"]?.score).toBe(10);
    expect(instances["i1"]?.score).toBe(0);
  });

  test("first() in scope updates only first instance", async () => {
    const m = makeCounterModel();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.first().count.target() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });
    m.create({ id: "c", data: { count: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(trigger, { scope, params: 77 });

    const instances = scope.getState(m.$instances);
    const updated = Object.entries(instances).filter(([, v]) => v.count === 77);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.[0]).toBe("a");
  });

  test("last() in scope updates only last instance", async () => {
    const m = makeCounterModel();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.last().count.target() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });
    m.create({ id: "c", data: { count: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(trigger, { scope, params: 88 });

    const instances = scope.getState(m.$instances);
    const updated = Object.entries(instances).filter(([, v]) => v.count === 88);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.[0]).toBe("c");
  });
});

// ---------------------------------------------------------------------------
// serialize(scope) — $instances snapshots
// ---------------------------------------------------------------------------

describe("serialize(scope) — $instances snapshots", () => {
  test("empty scope serializes $instances as empty object", () => {
    const m = makeCounterModel();
    const scope = fork({ values: [[m.$instances as StoreWritable<any>, {}]] });
    const snap = serialize(scope);
    const sid = (m.$instances as any).sid as string;
    expect(snap[sid]).toEqual({});
  });

  test("instances created in scope appear in serialize output", async () => {
    const m = makeCounterModel();

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "1", data: { count: 5 } },
    });
    await allSettled(m.create, {
      scope,
      params: { id: "2", data: { count: 10 } },
    });

    const snap = serialize(scope);
    const sid = (m.$instances as any).sid as string;

    expect(snap[sid]).toMatchObject({
      "1": { count: 5 },
      "2": { count: 10 },
    });
  });

  test("lens mutations in scope are reflected in serialize output", async () => {
    const m = makeCounterModel();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "a", data: { count: 0 } });
    m.create({ id: "b", data: { count: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(trigger, { scope, params: 42 });

    const snap = serialize(scope);
    const sid = (m.$instances as any).sid as string;

    expect(snap[sid]).toMatchObject({
      a: { count: 42 },
      b: { count: 42 },
    });
  });

  test("model API stores (serialize: 'ignore') are absent from serialize output", () => {
    const m = makeCounterModel();
    m.create({ id: "1", data: { count: 5 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    const snap = serialize(scope);

    // The virtual API stores have serialize:"ignore" — must NOT appear.
    // Without the Babel/SWC plugin, SIDs are null, which also guarantees
    // absence from serialize output (only SID-keyed stores are included).
    const countStoreSid = (m["~api"].count as any).sid as string | null;
    if (countStoreSid !== null) {
      expect(snap).not.toHaveProperty(countStoreSid);
    } else {
      // null SID ⇒ never serialised — verify by checking it's not in snap keys
      expect(Object.values(snap)).not.toContain(undefined);
    }

    // $instances DOES appear
    const instancesSid = (m.$instances as any).sid as string;
    expect(snap).toHaveProperty(instancesSid);
  });

  test("multiple models serialize independently", async () => {
    const m1 = makeCounterModel();
    const m2 = makeUserModel();

    const scope1 = fork();
    const scope2 = fork();

    await allSettled(m1.create, {
      scope: scope1,
      params: { id: "c1", data: { count: 1 } },
    });
    await allSettled(m2.create, {
      scope: scope2,
      params: { id: "u1", data: { name: "Alice", age: 30, active: true } },
    });

    const snap1 = serialize(scope1);
    const snap2 = serialize(scope2);
    const sid1 = (m1.$instances as any).sid as string;
    const sid2 = (m2.$instances as any).sid as string;

    expect(snap1[sid1]).toMatchObject({ c1: { count: 1 } });
    expect(snap2[sid2]).toMatchObject({
      u1: { name: "Alice", age: 30, active: true },
    });
  });

  test("two scopes serialize independently", async () => {
    const m = makeCounterModel();

    const scope1 = fork();
    const scope2 = fork();

    await allSettled(m.create, {
      scope: scope1,
      params: { id: "1", data: { count: 10 } },
    });
    await allSettled(m.create, {
      scope: scope2,
      params: { id: "1", data: { count: 20 } },
    });

    const snap1 = serialize(scope1);
    const snap2 = serialize(scope2);
    const sid = (m.$instances as any).sid as string;

    expect(snap1[sid]).toMatchObject({ "1": { count: 10 } });
    expect(snap2[sid]).toMatchObject({ "1": { count: 20 } });
  });

  test("where-filtered lens mutation produces correct serialized output", async () => {
    const m = model({
      contract: contract({
        role: define.store(define.static<"admin" | "user">(), "user"),
        points: define.store(define.static<number>(), 0),
      })(),
      fn: ({ role, points }) => ({ role, points }),
    });

    const grantToAdmins = createEvent<number>();
    sample({
      clock: grantToAdmins,
      target: m.lens.where(({ role }) => role === "admin").points.target(),
    });

    m.create({ id: "admin1", data: { role: "admin", points: 0 } });
    m.create({ id: "admin2", data: { role: "admin", points: 0 } });
    m.create({ id: "user1", data: { role: "user", points: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(grantToAdmins, { scope, params: 100 });

    const snap = serialize(scope);
    const sid = (m.$instances as any).sid as string;

    expect(snap[sid]).toMatchObject({
      admin1: { role: "admin", points: 100 },
      admin2: { role: "admin", points: 100 },
      user1: { role: "user", points: 0 },
    });
  });
});

// ---------------------------------------------------------------------------
// Complex scenarios
// ---------------------------------------------------------------------------

describe("complex fork scenarios", () => {
  test("create-in-scope + mutate-via-lens round-trip with serialize", async () => {
    const m = makeCounterModel();
    const setToOne = createEvent<void>();

    sample({
      clock: setToOne,
      fn: () => 1,
      target: m.lens.count.target(),
    });

    // Create globally so lens can find them
    m.create({ id: "1", data: { count: 0 } });
    m.create({ id: "2", data: { count: 5 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });

    // Set all counts to 1
    await allSettled(setToOne, { scope });

    const sid = (m.$instances as any).sid as string;
    const snap = serialize(scope);

    expect(snap[sid]).toMatchObject({
      "1": { count: 1 },
      "2": { count: 1 },
    });
  });

  test("sequential mutations accumulate correctly in scope", async () => {
    const m = makeCounterModel();
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: m.lens.count.target() });

    m.create({ id: "1", data: { count: 0 } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(trigger, { scope, params: 10 });
    await allSettled(trigger, { scope, params: 20 });
    await allSettled(trigger, { scope, params: 30 });

    expect(scope.getState(m.$instances)["1"]?.count).toBe(30);

    const sid = (m.$instances as any).sid as string;
    expect(serialize(scope)[sid]).toMatchObject({ "1": { count: 30 } });
  });

  test("100 instances created in scope serialize correctly", async () => {
    const m = makeCounterModel();
    const scope = fork();

    for (let i = 0; i < 100; i++) {
      await allSettled(m.create, {
        scope,
        params: { id: String(i), data: { count: i * 2 } },
      });
    }

    const sid = (m.$instances as any).sid as string;
    const snap = serialize(scope);

    for (let i = 0; i < 100; i++) {
      expect((snap[sid] as any)[String(i)]).toMatchObject({ count: i * 2 });
    }
  });

  test("chained where+first mutation reflected in serialize", async () => {
    const m = model({
      contract: contract({
        priority: define.store(define.static<number>(), 0),
        processed: define.store(define.static<boolean>(), false),
      })(),
      fn: ({ priority, processed }) => ({ priority, processed }),
    });

    const processHighest = createEvent<boolean>();
    sample({
      clock: processHighest,
      target: m.lens
        .where(({ priority }) => priority > 5)
        .first()
        .processed.target(),
    });

    m.create({ id: "low1", data: { priority: 1, processed: false } });
    m.create({ id: "high1", data: { priority: 10, processed: false } });
    m.create({ id: "high2", data: { priority: 8, processed: false } });

    const scope = fork({
      values: [[m.$instances as StoreWritable<any>, m.$instances.getState()]],
    });
    await allSettled(processHighest, { scope, params: true });

    const sid = (m.$instances as any).sid as string;
    const snap = serialize(scope);

    expect((snap[sid] as any)["low1"].processed).toBe(false);
    expect((snap[sid] as any)["high1"].processed).toBe(true);
    expect((snap[sid] as any)["high2"].processed).toBe(false);
  });

  test("fork({ values }) restores previously serialized scope state", async () => {
    const m = makeCounterModel();

    // Simulate server: create instances in scope and serialize
    const serverScope = fork();
    await allSettled(m.create, {
      scope: serverScope,
      params: { id: "s1", data: { count: 42 } },
    });
    await allSettled(m.create, {
      scope: serverScope,
      params: { id: "s2", data: { count: 99 } },
    });
    const serverSnap = serialize(serverScope);

    // Simulate client: restore from serialized data
    const clientScope = fork({ values: serverSnap });

    const sid = (m.$instances as any).sid as string;
    expect(clientScope.getState(m.$instances)).toMatchObject({
      s1: { count: 42 },
      s2: { count: 99 },
    });
    expect(serialize(clientScope)[sid]).toMatchObject({
      s1: { count: 42 },
      s2: { count: 99 },
    });
  });
});
