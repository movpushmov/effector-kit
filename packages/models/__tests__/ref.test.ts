/**
 * Tests for ref() – the simplified add/remove API.
 *
 * ref(model) exposes:
 *   add:    EventCallable<string>  — track an instance id
 *   remove: EventCallable<string>  — untrack an instance id
 *
 * ref(union({a, b, …})) exposes:
 *   add:    { a: EventCallable<string>, b: EventCallable<string>, … }
 *   remove: { a: EventCallable<string>, b: EventCallable<string>, … }
 *
 * The ref overrides getSource on its lens so it reads only from the tracked
 * ids store (custom storage) instead of the full model $instances.  This is
 * the same pattern used by child: the lens points at a different storage layer,
 * not a filtered view of the original storage.
 *
 * NOTE on scope: $ids is a plain store.  store.getState() returns scope-local
 * values inside allSettled when the store is not included in fork({ values }).
 * Ensuring $ids is in scope is the developer's responsibility — it is not
 * tested here.
 */
import { describe, test, expect } from "vitest";
import { sample, createEvent } from "effector";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";
import { ref } from "../lib/ref/ref";
import { union } from "../lib/union";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeItemModel() {
  return model({
    contract: contract({
      label: define.store(define.static<string>(), ""),
      active: define.store(define.static<boolean>(), false),
    })(),
    fn: ({ label, active }) => ({ label, active }),
  });
}

function makeCounter() {
  return model({
    contract: contract({ count: define.store(define.static<number>(), 0) })(),
    fn: ({ count }) => ({ count }),
  });
}

/** Call (ref.lens as any).getSource() */
function getSource(r: any): Record<string, any> {
  return (r.lens as any).getSource();
}

// ---------------------------------------------------------------------------
// ref(model) – structure
// ---------------------------------------------------------------------------

describe("ref(model) structure", () => {
  test("has ~kind 'ref'", () => {
    const r = ref(makeItemModel());
    expect(r["~kind"]).toBe("ref");
  });

  test("has add and remove as callable events", () => {
    const r = ref(makeItemModel());
    expect(typeof r.add).toBe("function");
    expect(typeof r.remove).toBe("function");
  });

  test("add and remove are EventCallable (have watch)", () => {
    const r = ref(makeItemModel());
    expect(typeof r.add.watch).toBe("function");
    expect(typeof r.remove.watch).toBe("function");
  });

  test("has a lens property", () => {
    const r = ref(makeItemModel());
    expect(r.lens).toBeDefined();
  });

  test("lens has where, first, last methods from the underlying model lens", () => {
    const r = ref(makeItemModel());
    expect(typeof r.lens.where).toBe("function");
    expect(typeof r.lens.first).toBe("function");
    expect(typeof r.lens.last).toBe("function");
  });

  test("getSource is accessible via cast (internal, not on public type)", () => {
    const r = ref(makeItemModel());
    expect(typeof (r.lens as any).getSource).toBe("function");
  });

  test("lens exposes the model's API units", () => {
    const r = ref(makeItemModel());
    expect((r.lens as any).label).toBeDefined();
    expect(typeof (r.lens as any).label.target).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ref(model) – add and remove behaviour via getSource
// ---------------------------------------------------------------------------

describe("ref(model) add/remove behaviour", () => {
  test("getSource returns empty before any add", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "A", active: true } });
    const r = ref(m);
    expect(getSource(r)).toEqual({});
  });

  test("after add(id) the instance appears in getSource", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "Hello", active: true } });
    const r = ref(m);

    r.add("1");

    const src = getSource(r);
    expect(src["1"]).toBeDefined();
    expect(src["1"]?.label).toBe("Hello");
  });

  test("multiple adds accumulate tracked ids", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "A", active: true } });
    m.create({ id: "2", data: { label: "B", active: false } });
    m.create({ id: "3", data: { label: "C", active: true } });
    const r = ref(m);

    r.add("1");
    r.add("2");
    r.add("3");

    expect(Object.keys(getSource(r))).toHaveLength(3);
  });

  test("remove(id) stops tracking that id", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "A", active: true } });
    m.create({ id: "2", data: { label: "B", active: false } });
    const r = ref(m);

    r.add("1");
    r.add("2");
    r.remove("1");

    const src = getSource(r);
    expect(src["1"]).toBeUndefined();
    expect(src["2"]).toBeDefined();
  });

  test("remove of an untracked id is a no-op", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "A", active: true } });
    const r = ref(m);

    r.add("1");
    r.remove("not-tracked");

    expect(getSource(r)["1"]).toBeDefined();
  });

  test("two refs on the same model track independently", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "A", active: true } });
    m.create({ id: "2", data: { label: "B", active: false } });
    const r1 = ref(m);
    const r2 = ref(m);

    r1.add("1");
    r2.add("2");

    expect(getSource(r1)["1"]).toBeDefined();
    expect(getSource(r1)["2"]).toBeUndefined();
    expect(getSource(r2)["1"]).toBeUndefined();
    expect(getSource(r2)["2"]).toBeDefined();
  });

  test("add does not expose add.someKey (union-only API)", () => {
    const r = ref(makeItemModel()) as any;
    expect(typeof r.add).toBe("function");
    expect(r.add.a).toBeUndefined();
  });

  test("add can be used as a sample target", () => {
    const m = makeCounter();
    m.create({ id: "x", data: { count: 0 } });
    const r = ref(m);

    const trigger = createEvent<string>();
    sample({ clock: trigger, target: r.add });

    trigger("x");
    expect(getSource(r)["x"]).toBeDefined();
  });

  test("remove can be used as a sample target", () => {
    const m = makeCounter();
    m.create({ id: "x", data: { count: 0 } });
    const r = ref(m);

    const trigger = createEvent<string>();
    sample({ clock: trigger, target: r.remove });

    r.add("x");
    expect(getSource(r)["x"]).toBeDefined();

    trigger("x");
    expect(getSource(r)["x"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ref(model) – lens API
// ---------------------------------------------------------------------------

describe("ref(model) lens API", () => {
  test("ref.lens and model.lens are different objects", () => {
    const m = makeItemModel();
    const r = ref(m);
    expect(r.lens).not.toBe(m.lens);
  });

  test("model.lens.getSource returns all instances; ref.lens.getSource is tracked-only", () => {
    const m = makeItemModel();
    m.create({ id: "1", data: { label: "A", active: true } });
    m.create({ id: "2", data: { label: "B", active: false } });
    const r = ref(m);

    r.add("1");

    expect(Object.keys((m.lens as any).getSource())).toHaveLength(2);
    expect(Object.keys(getSource(r))).toHaveLength(1);
  });

  test("ref.lens.where() is available for dispatch filtering", () => {
    // where() adds a predicate used by target()/clock() dispatch — not by getSource().
    // getSource() on a ref always returns the full set of tracked instances.
    const m = makeItemModel();
    const r = ref(m);
    expect(typeof r.lens.where).toBe("function");
    expect(typeof r.lens.first).toBe("function");
    expect(typeof r.lens.last).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ref(union) – structure
// ---------------------------------------------------------------------------

describe("ref(union) structure", () => {
  test("has ~kind 'ref'", () => {
    const r = ref(union({ a: makeItemModel(), b: makeItemModel() }));
    expect(r["~kind"]).toBe("ref");
  });

  test("add is an object with a key per union variant", () => {
    const r = ref(union({ a: makeItemModel(), b: makeItemModel() }));
    expect(typeof (r.add as any).a).toBe("function");
    expect(typeof (r.add as any).b).toBe("function");
  });

  test("remove is an object with a key per union variant", () => {
    const r = ref(union({ a: makeItemModel(), b: makeItemModel() }));
    expect(typeof (r.remove as any).a).toBe("function");
    expect(typeof (r.remove as any).b).toBe("function");
  });

  test("per-key add/remove events are EventCallable (have watch)", () => {
    const r = ref(union({ a: makeItemModel(), b: makeItemModel() }));
    expect(typeof (r.add as any).a.watch).toBe("function");
    expect(typeof (r.remove as any).b.watch).toBe("function");
  });

  test("has a lens with only and where methods (UnionLens)", () => {
    const r = ref(union({ a: makeItemModel(), b: makeItemModel() }));
    expect(typeof r.lens.only).toBe("function");
    expect(typeof r.lens.where).toBe("function");
  });

  test("add.a and add.b are different events", () => {
    const r = ref(union({ a: makeItemModel(), b: makeItemModel() }));
    expect((r.add as any).a).not.toBe((r.add as any).b);
  });
});

// ---------------------------------------------------------------------------
// ref(union) – add/remove behaviour via getSource
// ---------------------------------------------------------------------------

describe("ref(union) add/remove behaviour", () => {
  test("getSource returns empty before any add", () => {
    const a = makeItemModel();
    const b = makeItemModel();
    a.create({ id: "a1", data: { label: "A", active: true } });
    b.create({ id: "b1", data: { label: "B", active: false } });
    const r = ref(union({ a, b }));

    expect(getSource(r)).toEqual({});
  });

  test("add.a(id) tracks a modelA instance, tagged with ~model: 'a'", () => {
    const a = makeItemModel();
    const b = makeItemModel();
    a.create({ id: "a1", data: { label: "Alpha", active: true } });
    const r = ref(union({ a, b }));

    (r.add as any).a("a1");

    const entries = Object.values(getSource(r)) as any[];
    const entry = entries.find((e) => e.id === "a1");
    expect(entry).toBeDefined();
    expect(entry?.["~model"]).toBe("a");
    expect(entry?.label).toBe("Alpha");
  });

  test("add.b(id) tracks a modelB instance, tagged with ~model: 'b'", () => {
    const a = makeItemModel();
    const b = makeItemModel();
    b.create({ id: "b1", data: { label: "Beta", active: false } });
    const r = ref(union({ a, b }));

    (r.add as any).b("b1");

    const entries = Object.values(getSource(r)) as any[];
    const entry = entries.find((e) => e.id === "b1");
    expect(entry?.["~model"]).toBe("b");
    expect(entry?.label).toBe("Beta");
  });

  test("add.a and add.b together track both variants independently", () => {
    const a = makeItemModel();
    const b = makeItemModel();
    a.create({ id: "a1", data: { label: "A", active: true } });
    b.create({ id: "b1", data: { label: "B", active: false } });
    const r = ref(union({ a, b }));

    (r.add as any).a("a1");
    (r.add as any).b("b1");

    const entries = Object.values(getSource(r)) as any[];
    expect(entries.find((e) => e["~model"] === "a" && e.id === "a1")).toBeDefined();
    expect(entries.find((e) => e["~model"] === "b" && e.id === "b1")).toBeDefined();
  });

  test("remove.a(id) untracks only that variant's instance", () => {
    const a = makeItemModel();
    const b = makeItemModel();
    a.create({ id: "a1", data: { label: "A", active: true } });
    b.create({ id: "b1", data: { label: "B", active: false } });
    const r = ref(union({ a, b }));

    (r.add as any).a("a1");
    (r.add as any).b("b1");
    (r.remove as any).a("a1");

    const entries = Object.values(getSource(r)) as any[];
    expect(entries.find((e) => e["~model"] === "a" && e.id === "a1")).toBeUndefined();
    expect(entries.find((e) => e["~model"] === "b" && e.id === "b1")).toBeDefined();
  });

  test("two union refs on the same union track independently", () => {
    const a = makeItemModel();
    a.create({ id: "a1", data: { label: "A", active: true } });
    const u = union({ a });
    const r1 = ref(u);
    const r2 = ref(u);

    (r1.add as any).a("a1");

    const r1Entries = Object.values(getSource(r1)) as any[];
    const r2Entries = Object.values(getSource(r2)) as any[];
    expect(r1Entries.find((e) => e.id === "a1")).toBeDefined();
    expect(r2Entries.find((e) => e.id === "a1")).toBeUndefined();
  });

  test("union ref lens where() is available for dispatch filtering", () => {
    // where() adds a predicate used by target()/clock() — not by getSource().
    // getSource() on a ref always returns the full tracked set.
    const a = makeItemModel();
    const r = ref(union({ a }));
    expect(typeof r.lens.where).toBe("function");
    expect(typeof r.lens.only).toBe("function");
  });
});
