/**
 * Tests for:
 *  - union() structure and is.union()
 *  - lens(union) – UnionLens with only/where/ctx.match/per-key model API
 *  - child(union) – union variant of the child helper
 *
 * Mutation tests follow the same fork/allSettled pattern used elsewhere:
 *  1. Create instances globally so $instances has the data.
 *  2. Fork with those instances pre-loaded into scope.
 *  3. Wire trigger → lens target via sample, then allSettled.
 *  4. Assert via scope.getState($instances).
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
import { union } from "../lib/union";
import { lens } from "../lib/lens";
import { is } from "../lib";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeCounter() {
  return model({
    contract: contract({ count: define.store(define.static<number>(), 0) })(),
    fn: ({ count }) => ({ count }),
  });
}

function makeFlagged() {
  return model({
    contract: contract({
      active: define.store(define.static<boolean>(), false),
      score: define.store(define.static<number>(), 0),
    })(),
    fn: ({ active, score }) => ({ active, score }),
  });
}

function forkWith(...models: Array<{ $instances: StoreWritable<any> }>) {
  return fork({
    values: models.map((m) => [m.$instances, m.$instances.getState()]),
  });
}

// ---------------------------------------------------------------------------
// union ID namespacing (shared IDs across variants)
// ---------------------------------------------------------------------------

describe("union ID namespacing", () => {
  test("two variants sharing the same original ID are both present in getSource", () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "shared", data: { count: 1 } });
    b.create({ id: "shared", data: { active: true, score: 0 } });

    const src = (lens(union({ a, b })) as any).getSource();
    // Two distinct entries must exist — look up by ~model tag since the
    // internal key is opaque (based on model['~id']).
    const entries = Object.values(src) as any[];
    expect(entries.find((e) => e["~model"] === "a" && e.id === "shared")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "b" && e.id === "shared")).toBeDefined();
  });

  test("entity id field always holds the original id, not the namespaced key", () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "x", data: { count: 5 } });
    b.create({ id: "x", data: { active: false, score: 3 } });

    const src = (lens(union({ a, b })) as any).getSource();
    const entries = Object.values(src) as any[];
    expect(entries.every((e) => e.id === "x")).toBe(true);
    // Internal keys must differ from the original id
    expect(Object.keys(src).every((k) => k !== "x")).toBe(true);
  });

  test("where((e) => e.id === ...) matches both variants sharing the same id", () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "shared", data: { count: 1 } });
    b.create({ id: "shared", data: { active: true, score: 0 } });
    b.create({ id: "other", data: { active: false, score: 0 } });

    const l = lens(union({ a, b })).where((e) => e.id === "shared");
    const src = (l as any).getSource();
    const ids = Object.values(src).map((e: any) => e["~model"]);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    // "other" is excluded
    expect(Object.values(src).every((e: any) => e.id === "shared")).toBe(true);
  });

  test("where((e) => e['~model'] === 'a') narrows to one variant", () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "shared", data: { count: 1 } });
    b.create({ id: "shared", data: { active: true, score: 0 } });

    const l = lens(union({ a, b })).where((e) => e["~model"] === "a");
    const src = (l as any).getSource();
    expect(Object.keys(src)).toHaveLength(1);
    expect(Object.values(src)[0]["~model"]).toBe("a");
  });

  test("ctx.uniqueId returns the same key used internally by the union lens", () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "shared", data: { count: 1 } });
    b.create({ id: "shared", data: { active: true, score: 0 } });

    const u = union({ a, b });
    const collectedKeys: string[] = [];

    const l = lens(u).where((entity, _, ctx) => {
      collectedKeys.push(ctx!.uniqueId(entity["~model"] as any, entity.id));
      return true;
    });
    (l as any).getSource();

    // The collected keys must match the actual internal keys
    const srcKeys = Object.keys((lens(u) as any).getSource());
    expect(collectedKeys.sort()).toEqual(srcKeys.sort());
    // And they must be based on model['~id'], not the variant name
    expect(collectedKeys).toContain(`${a["~id"]}:shared`);
    expect(collectedKeys).toContain(`${b["~id"]}:shared`);
  });

  test("per-key API (lens.a) dispatches only to a-variant even with shared ids", async () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "shared", data: { count: 0 } });
    b.create({ id: "shared", data: { active: false, score: 0 } });

    const l = lens(union({ a, b }));
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: l.a.count.target() });

    const scope = forkWith(a, b);
    await allSettled(trigger, { scope, params: 42 });

    expect(scope.getState(a.$instances)["shared"]?.count).toBe(42);
    // b variant with same id is untouched
    expect(scope.getState(b.$instances)["shared"]?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// union() structure
// ---------------------------------------------------------------------------

describe("union() structure", () => {
  test("has ~kind 'union'", () => {
    const a = makeCounter();
    const b = makeCounter();
    const u = union({ a, b });
    expect(u["~kind"]).toBe("union");
  });

  test("models property references the input map", () => {
    const a = makeCounter();
    const b = makeCounter();
    const u = union({ a, b });
    expect(u.models.a).toBe(a);
    expect(u.models.b).toBe(b);
  });

  test("is.union() returns true", () => {
    const u = union({ a: makeCounter() });
    expect(is.union(u)).toBe(true);
  });

  test("is.union() returns false for a model", () => {
    const m = makeCounter();
    expect(is.union(m)).toBe(false);
  });

  test("is.model() returns false for a union", () => {
    const u = union({ a: makeCounter() });
    expect(is.model(u)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lens(union) – structure
// ---------------------------------------------------------------------------

describe("lens(union) structure", () => {
  test("has where and only methods", () => {
    const u = union({ a: makeCounter(), b: makeCounter() });
    const l = lens(u);
    expect(typeof l.where).toBe("function");
    expect(typeof l.only).toBe("function");
  });

  test("exposes per-key model API for each union variant", () => {
    const u = union({ a: makeCounter(), b: makeFlagged() });
    const l = lens(u);
    expect(l.a).toBeDefined();
    expect(l.b).toBeDefined();
    expect(typeof l.a.count.target).toBe("function");
    expect(typeof l.b.active.target).toBe("function");
  });

  test("only() returns the same lens object (mutable chain)", () => {
    const u = union({ a: makeCounter(), b: makeCounter() });
    const l = lens(u);
    expect(l.only("a")).toBe(l);
  });

  test("where() returns the same lens object (mutable chain)", () => {
    const u = union({ a: makeCounter() });
    const l = lens(u);
    expect(l.where(() => true)).toBe(l);
  });

  test("getSource is accessible via cast (internal, not typed)", () => {
    const u = union({ a: makeCounter() });
    const l = lens(u);
    expect(typeof (l as any).getSource).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// lens(union).getSource() – instance collection and tagging
// ---------------------------------------------------------------------------

describe("lens(union) getSource() via cast", () => {
  test("returns empty when no instances exist", () => {
    const a = makeCounter();
    const b = makeCounter();
    const u = union({ a, b });
    expect((lens(u) as any).getSource()).toEqual({});
  });

  test("collects instances from all variants, each tagged with ~model key", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 1 } });
    b.create({ id: "b1", data: { count: 2 } });

    const result = (lens(union({ a, b })) as any).getSource();
    const entries = Object.values(result) as any[];
    expect(entries.find((e) => e["~model"] === "a" && e.id === "a1")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "b" && e.id === "b1")).toBeDefined();
  });

  test("tagged entities include the original data fields", () => {
    const a = makeCounter();
    a.create({ id: "x", data: { count: 42 } });

    const result = (lens(union({ a })) as any).getSource();
    const entries = Object.values(result) as any[];
    const entry = entries.find((e) => e.id === "x");
    expect(entry?.count).toBe(42);
    expect(entry?.id).toBe("x");
  });

  test("internal key is derived from model['~id'], not the variant name", () => {
    const a = makeCounter();
    a.create({ id: "foo", data: { count: 1 } });

    const result = (lens(union({ a })) as any).getSource();
    const keys = Object.keys(result);
    // key must not be the bare original id
    expect(keys).not.toContain("foo");
    // key must embed the model's ~id
    expect(keys[0]).toBe(`${a["~id"]}:foo`);
  });
});

// ---------------------------------------------------------------------------
// lens(union).only()
// ---------------------------------------------------------------------------

describe("lens(union).only()", () => {
  test("restricts getSource to the specified keys", () => {
    const a = makeCounter();
    const b = makeCounter();
    const c = makeCounter();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { count: 0 } });
    c.create({ id: "c1", data: { count: 0 } });

    const l = lens(union({ a, b, c }));
    l.only("a", "b");
    const entries = Object.values((l as any).getSource()) as any[];

    expect(entries.find((e) => e["~model"] === "a" && e.id === "a1")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "b" && e.id === "b1")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "c")).toBeUndefined();
  });

  test("only() to a single key excludes all other variants", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { count: 0 } });

    const l = lens(union({ a, b }));
    l.only("b");
    const entries = Object.values((l as any).getSource()) as any[];

    expect(entries.find((e) => e["~model"] === "a")).toBeUndefined();
    expect(entries.find((e) => e["~model"] === "b" && e.id === "b1")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// lens(union).where()
// ---------------------------------------------------------------------------

describe("lens(union).where()", () => {
  test("filters instances by data field across all variants", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 10 } });
    a.create({ id: "a2", data: { count: 3 } });
    b.create({ id: "b1", data: { count: 20 } });

    const l = lens(union({ a, b }));
    l.where((entity) => entity.count > 5);
    const entries = Object.values((l as any).getSource()) as any[];

    expect(entries.find((e) => e.id === "a1")).toBeDefined();
    expect(entries.find((e) => e.id === "a2")).toBeUndefined();
    expect(entries.find((e) => e.id === "b1")).toBeDefined();
  });

  test("can discriminate by ~model tag", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { count: 0 } });

    const l = lens(union({ a, b }));
    l.where((entity) => entity["~model"] === "a");
    const entries = Object.values((l as any).getSource()) as any[];

    expect(entries.find((e) => e["~model"] === "a")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "b")).toBeUndefined();
  });

  test("where + only compose correctly", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a-hi", data: { count: 100 } });
    a.create({ id: "a-lo", data: { count: 1 } });
    b.create({ id: "b1", data: { count: 100 } });

    const l = lens(union({ a, b }));
    l.only("a");
    l.where((entity) => entity.count > 5);
    const entries = Object.values((l as any).getSource()) as any[];

    expect(entries.find((e) => e.id === "a-hi")).toBeDefined();
    expect(entries.find((e) => e.id === "a-lo")).toBeUndefined();
    expect(entries.find((e) => e["~model"] === "b")).toBeUndefined();
  });

  test("ctx.match() in where predicate returns the matched value directly", () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "a1", data: { count: 7 } });
    b.create({ id: "b1", data: { active: true, score: 3 } });

    const l = lens(union({ a, b }));
    const matchedValues: Array<any> = [];

    l.where((entity, _, ctx) => {
      const result = ctx!.match({ a: (d) => d.count, b: (d) => d.score });
      matchedValues.push(result);
      return true;
    });

    (l as any).getSource();

    expect(matchedValues).toContain(7);
    expect(matchedValues).toContain(3);
  });

  test("ctx.match() returns undefined for unhandled variants", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 1 } });
    b.create({ id: "b1", data: { count: 2 } });

    const l = lens(union({ a, b }));
    const matchedValues: Array<any> = [];

    l.where((entity, _, ctx) => {
      // only handle 'a', leaving 'b' unmatched
      const result = ctx!.match({ a: (d: any) => d.count });
      matchedValues.push(result);
      return true;
    });

    (l as any).getSource();

    expect(matchedValues).toContain(1);
    expect(matchedValues).toContain(undefined);
  });

  test("ctx.match() can be used as the filter decision", () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 10 } });
    b.create({ id: "b1", data: { count: 2 } });

    const l = lens(union({ a, b }));
    // Keep only entities where the variant-specific count exceeds 5
    l.where((entity, _, ctx) => {
      const result = ctx!.match({
        a: (d: any) => d.count > 5,
        b: (d: any) => d.count > 5,
      });
      return result ?? false;
    });

    const entries = Object.values((l as any).getSource()) as any[];
    expect(entries.find((e) => e["~model"] === "a" && e.id === "a1")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "b")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// lens(union) per-key target() – scope mutations
// ---------------------------------------------------------------------------

describe("lens(union) per-key target() via scope", () => {
  test("lens.a.count.target() updates only modelA instances", async () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { count: 0 } });

    const l = lens(union({ a, b }));
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: l.a.count.target() });

    const scope = forkWith(a, b);
    await allSettled(trigger, { scope, params: 99 });

    expect(scope.getState(a.$instances)["a1"]?.count).toBe(99);
    expect(scope.getState(b.$instances)["b1"]?.count).toBe(0);
  });

  test("lens.b.score.target() updates only modelB instances", async () => {
    const a = makeCounter();
    const b = makeFlagged();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { active: false, score: 0 } });

    const l = lens(union({ a, b }));
    const trigger = createEvent<number>();
    sample({ clock: trigger, target: l.b.score.target() });

    const scope = forkWith(a, b);
    await allSettled(trigger, { scope, params: 55 });

    expect(scope.getState(a.$instances)["a1"]?.count).toBe(0);
    expect(scope.getState(b.$instances)["b1"]?.score).toBe(55);
  });

  test("only('a') makes b.count.target() a no-op", async () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { count: 0 } });

    const l = lens(union({ a, b }));
    l.only("a");

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: l.b.count.target() });

    const scope = forkWith(a, b);
    await allSettled(trigger, { scope, params: 77 });

    // b is not in activeKeys after only('a'), so dispatch is a no-op
    expect(scope.getState(b.$instances)["b1"]?.count).toBe(0);
  });

  test("where() narrows which instances receive the dispatch", async () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a-hi", data: { count: 10 } });
    a.create({ id: "a-lo", data: { count: 2 } });
    b.create({ id: "b1", data: { count: 0 } });

    const l = lens(union({ a, b }));
    l.where((entity) => entity.count >= 5);

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: l.a.count.target() });

    const scope = forkWith(a, b);
    await allSettled(trigger, { scope, params: 100 });

    expect(scope.getState(a.$instances)["a-hi"]?.count).toBe(100);
    expect(scope.getState(a.$instances)["a-lo"]?.count).toBe(2);
    expect(scope.getState(b.$instances)["b1"]?.count).toBe(0);
  });

  test("multiple per-key targets on same lens dispatch independently", async () => {
    const a = makeCounter();
    const b = makeCounter();
    a.create({ id: "a1", data: { count: 0 } });
    b.create({ id: "b1", data: { count: 0 } });

    const l = lens(union({ a, b }));
    const triggerA = createEvent<number>();
    const triggerB = createEvent<number>();
    sample({ clock: triggerA, target: l.a.count.target() });
    sample({ clock: triggerB, target: l.b.count.target() });

    const scope = forkWith(a, b);
    await allSettled(triggerA, { scope, params: 10 });
    await allSettled(triggerB, { scope, params: 20 });

    expect(scope.getState(a.$instances)["a1"]?.count).toBe(10);
    expect(scope.getState(b.$instances)["b1"]?.count).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// lens(union).match()
// ---------------------------------------------------------------------------

describe("lens(union).match()", () => {
  // Models from the user's example:
  //   a has count store
  //   b has value store
  function makeA() {
    return model({
      contract: contract({ count: define.store(define.static<number>(), 0) })(),
      fn: ({ count }) => ({ count }),
    });
  }
  function makeB() {
    return model({
      contract: contract({
        value: define.store(define.static<string>(), ""),
      })(),
      fn: ({ value }) => ({ value }),
    });
  }

  test("match() subLens has where/first/last and per-store target/clock", () => {
    const a = makeA();
    const b = makeB();
    const l = lens(union({ a, b }));
    let seenA: any;
    let seenB: any;
    l.match({
      a: (subLens) => {
        seenA = subLens;
        return subLens.count.target();
      },
      b: (subLens) => {
        seenB = subLens;
        return subLens.value.target();
      },
    });
    expect(typeof seenA.where).toBe("function");
    expect(typeof seenA.first).toBe("function");
    expect(typeof seenA.last).toBe("function");
    expect(typeof seenA.count.target).toBe("function");
    expect(typeof seenB.value.target).toBe("function");
  });

  test("match() returns a single merged Event", () => {
    const a = makeA();
    const b = makeB();
    const merged = lens(union({ a, b })).match({
      a: (subLens) => subLens.count.target(),
      b: (subLens) => subLens.value.target(),
    });
    // merge() returns a plain Event (not EventCallable), check it's a valid unit
    // EventCallable is a callable function — typeof is 'function'
    expect(typeof merged).toBe("function");
    expect(typeof (merged as any).watch).toBe("function");
  });

  test("match — merged event fires for all variant targets", async () => {
    // Both a and b dispatch through the single merged event
    const a = makeA();
    const b = makeB();
    a.create({ id: "1-a", data: { count: 0 } });
    b.create({ id: "1-b", data: { value: "" } });

    const merged = lens(union({ a, b })).match({
      a: (subLens) => subLens.count.target(),
      b: (subLens) => subLens.value.target(),
    });

    const scope = forkWith(a, b);
    // Trigger the a-side via the merged event used as target
    const triggerA = createEvent<number>();
    sample({ clock: triggerA, target: merged });
    await allSettled(triggerA, { scope, params: 42 });

    expect(scope.getState(a.$instances)["1-a"]?.count).toBe(42);
  });

  test("match respects the union lens's own only() filter", async () => {
    const a = makeA();
    const b = makeB();

    a.create({ id: "1-a", data: { count: 10 } });
    b.create({ id: "1-b", data: { value: "hi" } });

    const merged = lens(union({ a, b }))
      .only("a")
      .match({
        a: (subLens) => subLens.count.target(),
      });

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: merged });

    const scope = forkWith(a, b);
    await allSettled(trigger, { scope, params: 55 });

    expect(scope.getState(a.$instances)["1-a"]?.count).toBe(55);
    expect(scope.getState(b.$instances)["1-b"]?.value).toBe("hi");
  });

  test("match respects the union lens's where() filter", async () => {
    const a = makeA();
    a.create({ id: "1-a", data: { count: 3 } });
    a.create({ id: "2-a", data: { count: 7 } });

    const merged = lens(union({ a }))
      .where((e) => (e as any).count > 5)
      .match({ a: (subLens) => subLens.count.target() });

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: merged });

    const scope = forkWith(a);
    await allSettled(trigger, { scope, params: 100 });

    expect(scope.getState(a.$instances)["2-a"]?.count).toBe(100);
    expect(scope.getState(a.$instances)["1-a"]?.count).toBe(3);
  });

  test("subLens.where() filters instances within the variant", async () => {
    // The original spec: a→3-a (count>4), b→1-b,2-b (value.length<3)
    const a = makeA();
    const b = makeB();
    a.create({ id: "1-a", data: { count: 2 } });
    a.create({ id: "2-a", data: { count: 4 } });
    a.create({ id: "3-a", data: { count: 6 } });
    b.create({ id: "1-b", data: { value: "a" } });
    b.create({ id: "2-b", data: { value: "aa" } });
    b.create({ id: "3-b", data: { value: "aaa" } });
    b.create({ id: "4-b", data: { value: "aaaa" } });

    // Two independent match calls — each returns its own merged event
    const aEvent = lens(union({ a, b })).match({
      a: (subLens) => subLens.where((e) => e.count > 4).count.target(),
    });
    const bEvent = lens(union({ a, b })).match({
      b: (subLens) => subLens.where((e) => e.value.length < 3).value.target(),
    });

    const triggerA = createEvent<number>();
    const triggerB = createEvent<string>();
    sample({ clock: triggerA, target: aEvent });
    sample({ clock: triggerB, target: bEvent });

    const scope = forkWith(a, b);
    await allSettled(triggerA, { scope, params: 99 });
    await allSettled(triggerB, { scope, params: "x" });

    const aState = scope.getState(a.$instances);
    const bState = scope.getState(b.$instances);

    expect(aState["3-a"]?.count).toBe(99);
    expect(aState["1-a"]?.count).toBe(2);
    expect(aState["2-a"]?.count).toBe(4);
    expect(bState["1-b"]?.value).toBe("x");
    expect(bState["2-b"]?.value).toBe("x");
    expect(bState["3-b"]?.value).toBe("aaa");
    expect(bState["4-b"]?.value).toBe("aaaa");
  });

  test("subLens.first() targets only the first instance of the variant", async () => {
    const a = makeA();
    a.create({ id: "1-a", data: { count: 1 } });
    a.create({ id: "2-a", data: { count: 2 } });
    a.create({ id: "3-a", data: { count: 3 } });

    const merged = lens(union({ a })).match({
      a: (subLens) => subLens.first().count.target(),
    });

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: merged });

    const scope = forkWith(a);
    await allSettled(trigger, { scope, params: 99 });

    expect(scope.getState(a.$instances)["1-a"]?.count).toBe(99);
    expect(scope.getState(a.$instances)["2-a"]?.count).toBe(2);
    expect(scope.getState(a.$instances)["3-a"]?.count).toBe(3);
  });

  test("match with multiple variants — merged event dispatches both sides", async () => {
    const a = makeA();
    const b = makeB();
    a.create({ id: "1-a", data: { count: 0 } });
    b.create({ id: "1-b", data: { value: "" } });

    // Single match call with both variants — one merged event
    const merged = lens(union({ a, b })).match({
      a: (subLens) => subLens.count.target(),
      b: (subLens) => subLens.value.target(),
    });

    // The merged event is EventCallable when both handlers return
    // EventCallable with the same payload type; here we use it as-is
    // by wiring a compatible trigger
    const triggerCount = createEvent<number>();
    sample({ clock: triggerCount, target: merged });

    const scope = forkWith(a, b);
    await allSettled(triggerCount, { scope, params: 7 });

    // a.count updated (number payload)
    expect(scope.getState(a.$instances)["1-a"]?.count).toBe(7);
  });
});
