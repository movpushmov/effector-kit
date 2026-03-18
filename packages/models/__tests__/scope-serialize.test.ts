/**
 * Scope / serialize / hydrate tests for new features.
 *
 * These tests verify that when the developer uses the library API correctly
 * (all mutations via allSettled with a scope), serialize(scope) captures
 * exactly the data needed for client-side hydration — no more, no less.
 *
 * Covered:
 *   - Union: instances of multiple variants are all captured per-model
 *   - ref: $ids store is serializable and round-trips through hydration
 *   - model.static(): static stores participate in scope correctly
 */
import { describe, test, expect } from "vitest";
import {
  fork,
  allSettled,
  serialize,
  createEvent,
  sample,
  type StoreWritable,
} from "effector";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";
import { ref } from "../lib/ref/ref";
import { union } from "../lib/union";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeCounterModel() {
  return model({
    contract: contract({ count: define.store(define.static<number>(), 0) })(),
    fn: ({ count }) => ({ count }),
  });
}

function makeTaggedModel() {
  return model({
    contract: contract({
      tag: define.store(define.static<string>(), ""),
      value: define.store(define.static<number>(), 0),
    })(),
    fn: ({ tag, value }) => ({ tag, value }),
  });
}

// ---------------------------------------------------------------------------
// Union — scope & serialize
// ---------------------------------------------------------------------------

describe("union: scope & serialize", () => {
  test("instances of both variants created in scope are accessible via scope.getState", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    union({ counter: counterModel, tagged: taggedModel });

    const scope = fork();

    await allSettled(counterModel.create, {
      scope,
      params: { id: "c1", data: { count: 10 } },
    });
    await allSettled(taggedModel.create, {
      scope,
      params: { id: "t1", data: { tag: "hello", value: 99 } },
    });

    expect(scope.getState(counterModel.$instances)).toMatchObject({
      c1: { count: 10 },
    });
    expect(scope.getState(taggedModel.$instances)).toMatchObject({
      t1: { tag: "hello", value: 99 },
    });

    // Global stores are untouched
    expect(counterModel.$instances.getState()).toEqual({});
    expect(taggedModel.$instances.getState()).toEqual({});
  });

  test("each model's $instances SID appears in serialize output", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    union({ counter: counterModel, tagged: taggedModel });

    const scope = fork();
    await allSettled(counterModel.create, {
      scope,
      params: { id: "c1", data: { count: 5 } },
    });
    await allSettled(taggedModel.create, {
      scope,
      params: { id: "t1", data: { tag: "x", value: 1 } },
    });

    const snap = serialize(scope);
    const counterSid = (counterModel.$instances as any).sid as string;
    const taggedSid = (taggedModel.$instances as any).sid as string;

    expect(snap[counterSid]).toMatchObject({ c1: { count: 5 } });
    expect(snap[taggedSid]).toMatchObject({ t1: { tag: "x", value: 1 } });
  });

  test("union instances survive a full server→client serialize/hydrate round-trip", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    union({ counter: counterModel, tagged: taggedModel });

    // --- server ---
    const serverScope = fork();
    await allSettled(counterModel.create, {
      scope: serverScope,
      params: { id: "c1", data: { count: 42 } },
    });
    await allSettled(taggedModel.create, {
      scope: serverScope,
      params: { id: "t1", data: { tag: "hello", value: 7 } },
    });
    const snap = serialize(serverScope);

    // --- client ---
    const clientScope = fork({ values: snap });

    expect(clientScope.getState(counterModel.$instances)).toMatchObject({
      c1: { count: 42 },
    });
    expect(clientScope.getState(taggedModel.$instances)).toMatchObject({
      t1: { tag: "hello", value: 7 },
    });
  });

  test("two independent scopes for the same union models do not interfere", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    union({ counter: counterModel, tagged: taggedModel });

    const scope1 = fork();
    const scope2 = fork();

    await allSettled(counterModel.create, {
      scope: scope1,
      params: { id: "c1", data: { count: 1 } },
    });
    await allSettled(counterModel.create, {
      scope: scope2,
      params: { id: "c1", data: { count: 999 } },
    });

    const snap1 = serialize(scope1);
    const snap2 = serialize(scope2);
    const sid = (counterModel.$instances as any).sid as string;

    expect(snap1[sid]).toMatchObject({ c1: { count: 1 } });
    expect(snap2[sid]).toMatchObject({ c1: { count: 999 } });
  });
});

// ---------------------------------------------------------------------------
// ref — scope & serialize
// ---------------------------------------------------------------------------

describe("ref (model): scope & serialize", () => {
  test("$ids is updated in scope via allSettled(r.add)", async () => {
    const m = makeCounterModel();
    const r = ref(m);

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "1", data: { count: 5 } },
    });
    await allSettled(r.add, { scope, params: "1" });

    expect(scope.getState(r.$ids as StoreWritable<string[]>)).toEqual(["1"]);
    // Global is untouched
    expect((r.$ids as StoreWritable<string[]>).getState()).toEqual([]);
  });

  test("$ids appears in serialize output and contains correct ids", async () => {
    const m = makeCounterModel();
    const r = ref(m);

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "a", data: { count: 1 } },
    });
    await allSettled(m.create, {
      scope,
      params: { id: "b", data: { count: 2 } },
    });
    await allSettled(r.add, { scope, params: "a" });
    await allSettled(r.add, { scope, params: "b" });

    const snap = serialize(scope);
    const idsSid = (r.$ids as any).sid as string;
    const instancesSid = (m.$instances as any).sid as string;

    expect(snap[idsSid]).toEqual(["a", "b"]);
    expect(snap[instancesSid]).toMatchObject({
      a: { count: 1 },
      b: { count: 2 },
    });
  });

  test("remove in scope is reflected in serialize", async () => {
    const m = makeCounterModel();
    const r = ref(m);

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "1", data: { count: 10 } },
    });
    await allSettled(m.create, {
      scope,
      params: { id: "2", data: { count: 20 } },
    });
    await allSettled(r.add, { scope, params: "1" });
    await allSettled(r.add, { scope, params: "2" });
    await allSettled(r.remove, { scope, params: "1" });

    const snap = serialize(scope);
    const idsSid = (r.$ids as any).sid as string;
    expect(snap[idsSid]).toEqual(["2"]);
  });

  test("$ids and $instances round-trip through server→client hydration", async () => {
    const m = makeCounterModel();
    const r = ref(m);

    // --- server ---
    const serverScope = fork();
    await allSettled(m.create, {
      scope: serverScope,
      params: { id: "s1", data: { count: 7 } },
    });
    await allSettled(m.create, {
      scope: serverScope,
      params: { id: "s2", data: { count: 13 } },
    });
    await allSettled(r.add, { scope: serverScope, params: "s1" });
    const snap = serialize(serverScope);

    // --- client ---
    const clientScope = fork({ values: snap });

    expect(clientScope.getState(r.$ids as StoreWritable<string[]>)).toEqual([
      "s1",
    ]);
    expect(clientScope.getState(m.$instances)).toMatchObject({
      s1: { count: 7 },
      s2: { count: 13 },
    });
  });

  test("serialize captures no extra stores beyond $instances and $ids", async () => {
    const m = makeCounterModel();
    const r = ref(m);

    const scope = fork();
    await allSettled(m.create, {
      scope,
      params: { id: "1", data: { count: 5 } },
    });
    await allSettled(r.add, { scope, params: "1" });

    const snap = serialize(scope);
    const instancesSid = (m.$instances as any).sid as string;
    const idsSid = (r.$ids as any).sid as string;

    // Only the stores we need should be present
    const presentSids = Object.keys(snap);
    expect(presentSids).toContain(instancesSid);
    expect(presentSids).toContain(idsSid);
    // Virtual API stores (serialize:"ignore") must NOT be present
    const countStoreSid = (m["~api"].count as any).sid as string | null;
    if (countStoreSid !== null) {
      expect(presentSids).not.toContain(countStoreSid);
    }
  });
});

// ---------------------------------------------------------------------------
// ref (union) — scope & serialize
// ---------------------------------------------------------------------------

describe("ref (union): scope & serialize", () => {
  test("$ids stores {key,id} pairs in scope after allSettled(r.add.key)", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    const u = union({ counter: counterModel, tagged: taggedModel });
    const r = ref(u);

    const scope = fork();
    await allSettled(counterModel.create, {
      scope,
      params: { id: "c1", data: { count: 1 } },
    });
    await allSettled(taggedModel.create, {
      scope,
      params: { id: "t1", data: { tag: "x", value: 2 } },
    });
    await allSettled(r.add.counter, { scope, params: "c1" });
    await allSettled(r.add.tagged, { scope, params: "t1" });

    const ids = scope.getState(
      r.$ids as StoreWritable<Array<{ key: string; id: string }>>,
    );
    expect(ids).toEqual([
      { key: "counter", id: "c1" },
      { key: "tagged", id: "t1" },
    ]);
  });

  test("union ref $ids and both model $instances appear in serialize", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    const u = union({ counter: counterModel, tagged: taggedModel });
    const r = ref(u);

    const scope = fork();
    await allSettled(counterModel.create, {
      scope,
      params: { id: "c1", data: { count: 10 } },
    });
    await allSettled(taggedModel.create, {
      scope,
      params: { id: "t1", data: { tag: "hello", value: 5 } },
    });
    await allSettled(r.add.counter, { scope, params: "c1" });
    await allSettled(r.add.tagged, { scope, params: "t1" });

    const snap = serialize(scope);
    const idsSid = (r.$ids as any).sid as string;
    const counterSid = (counterModel.$instances as any).sid as string;
    const taggedSid = (taggedModel.$instances as any).sid as string;

    expect(snap[idsSid]).toEqual([
      { key: "counter", id: "c1" },
      { key: "tagged", id: "t1" },
    ]);
    expect(snap[counterSid]).toMatchObject({ c1: { count: 10 } });
    expect(snap[taggedSid]).toMatchObject({ t1: { tag: "hello", value: 5 } });
  });

  test("union ref round-trip through server→client hydration", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    const u = union({ counter: counterModel, tagged: taggedModel });
    const r = ref(u);

    // --- server ---
    const serverScope = fork();
    await allSettled(counterModel.create, {
      scope: serverScope,
      params: { id: "c1", data: { count: 42 } },
    });
    await allSettled(taggedModel.create, {
      scope: serverScope,
      params: { id: "t1", data: { tag: "world", value: 3 } },
    });
    await allSettled(r.add.counter, { scope: serverScope, params: "c1" });
    const snap = serialize(serverScope);

    // --- client ---
    const clientScope = fork({ values: snap });

    const ids = clientScope.getState(
      r.$ids as StoreWritable<Array<{ key: string; id: string }>>,
    );
    expect(ids).toEqual([{ key: "counter", id: "c1" }]);
    expect(clientScope.getState(counterModel.$instances)).toMatchObject({
      c1: { count: 42 },
    });
    // t1 was created but not added to the ref
    expect(clientScope.getState(taggedModel.$instances)).toMatchObject({
      t1: { tag: "world", value: 3 },
    });
  });

  test("remove in scope is reflected in serialize for union ref", async () => {
    const counterModel = makeCounterModel();
    const taggedModel = makeTaggedModel();
    const u = union({ counter: counterModel, tagged: taggedModel });
    const r = ref(u);

    const scope = fork();
    await allSettled(counterModel.create, {
      scope,
      params: { id: "c1", data: { count: 1 } },
    });
    await allSettled(counterModel.create, {
      scope,
      params: { id: "c2", data: { count: 2 } },
    });
    await allSettled(r.add.counter, { scope, params: "c1" });
    await allSettled(r.add.counter, { scope, params: "c2" });
    await allSettled(r.remove.counter, { scope, params: "c1" });

    const snap = serialize(scope);
    const idsSid = (r.$ids as any).sid as string;
    expect(snap[idsSid]).toEqual([{ key: "counter", id: "c2" }]);
  });
});

// ---------------------------------------------------------------------------
// model.static() — scope & serialize
// ---------------------------------------------------------------------------

describe("model.static(): scope & serialize", () => {
  test("static store values are accessible in scope via scope.getState", async () => {
    const m = makeCounterModel();
    const staticApi = m.static({ count: 100 });

    const scope = fork({
      values: [[staticApi.count as StoreWritable<number>, 100]],
    });

    expect(scope.getState(staticApi.count as StoreWritable<number>)).toBe(100);
  });

  test("static stores can be mutated via allSettled in scope", async () => {
    const m = makeCounterModel();
    const staticApi = m.static({ count: 0 });
    const setCount = createEvent<number>();

    sample({
      clock: setCount,
      target: staticApi.count as StoreWritable<number>,
    });

    const scope = fork();
    await allSettled(setCount, { scope, params: 42 });

    expect(scope.getState(staticApi.count as StoreWritable<number>)).toBe(42);
    // Global not mutated
    expect((staticApi.count as StoreWritable<number>).getState()).toBe(0);
  });

  test("two static instances in independent scopes do not interfere", async () => {
    const m = makeCounterModel();
    const staticA = m.static({ count: 1 });
    const staticB = m.static({ count: 2 });
    const setA = createEvent<number>();
    const setB = createEvent<number>();

    sample({ clock: setA, target: staticA.count as StoreWritable<number> });
    sample({ clock: setB, target: staticB.count as StoreWritable<number> });

    const scope1 = fork();
    const scope2 = fork();

    await allSettled(setA, { scope: scope1, params: 100 });
    await allSettled(setB, { scope: scope2, params: 200 });

    expect(scope1.getState(staticA.count as StoreWritable<number>)).toBe(100);
    expect(scope2.getState(staticB.count as StoreWritable<number>)).toBe(200);
    // Cross-scope isolation
    expect(scope1.getState(staticB.count as StoreWritable<number>)).toBe(2);
    expect(scope2.getState(staticA.count as StoreWritable<number>)).toBe(1);
  });

  test("static stores with SIDs appear in serialize output", async () => {
    const m = makeCounterModel();
    const staticApi = m.static({ count: 0 });
    const setCount = createEvent<number>();
    sample({
      clock: setCount,
      target: staticApi.count as StoreWritable<number>,
    });

    const scope = fork();
    await allSettled(setCount, { scope, params: 77 });

    const snap = serialize(scope);
    const sid = (staticApi.count as any).sid as string | null;

    if (sid !== null) {
      // With babel/SWC plugin: SID is assigned → appears in snap
      expect(snap[sid]).toBe(77);
    } else {
      // Without plugin: null SID → not serialized; verify global not mutated
      expect((staticApi.count as StoreWritable<number>).getState()).toBe(0);
    }
  });
});
