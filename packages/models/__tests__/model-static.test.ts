/**
 * Tests for model.static(data).
 *
 * model.static() creates a ContractApi snapshot: each store field is a plain
 * (non-context-aware) StoreWritable initialised with the provided data values,
 * and each event field is a plain EventCallable.  The result is independent of
 * any model instance context and behaves like a normal effector unit graph.
 */
import { describe, test, expect, vi } from "vitest";
import { sample, createEvent, fork, allSettled } from "effector";
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
      renamed: define.event(define.static<string>()),
    })(),
    fn: ({ name, age, active, renamed }) => ({ name, age, active, renamed }),
  });
}

function makeCounterModel() {
  return model({
    contract: contract({
      count: define.store(define.static<number>(), 0),
      reset: define.event(define.static<void>()),
    })(),
    fn: ({ count, reset }) => {
      sample({ clock: reset, fn: () => 0, target: count });
      return { count, reset };
    },
  });
}

// ---------------------------------------------------------------------------
// model.static() – structure
// ---------------------------------------------------------------------------

describe("model.static() structure", () => {
  test("static() method exists on a model", () => {
    const m = makeUserModel();
    expect(typeof m.static).toBe("function");
  });

  test("returns an object with a key for each shape field", () => {
    const m = makeUserModel();
    const api = m.static({ name: "Alice", age: 30, active: true });
    expect(api.name).toBeDefined();
    expect(api.age).toBeDefined();
    expect(api.active).toBeDefined();
    expect(api.renamed).toBeDefined();
  });

  test("store fields are StoreWritable (have getState)", () => {
    const m = makeUserModel();
    const api = m.static({ name: "Bob", age: 25, active: false });
    expect(typeof api.name.getState).toBe("function");
    expect(typeof api.age.getState).toBe("function");
  });

  test("event fields are EventCallable (have watch)", () => {
    const m = makeUserModel();
    const api = m.static({ name: "", age: 0, active: false });
    expect(typeof api.renamed.watch).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// model.static() – initial values
// ---------------------------------------------------------------------------

describe("model.static() initial values", () => {
  test("store fields hold the provided data values", () => {
    const m = makeUserModel();
    const api = m.static({ name: "Eve", age: 42, active: true });
    expect(api.name.getState()).toBe("Eve");
    expect(api.age.getState()).toBe(42);
    expect(api.active.getState()).toBe(true);
  });

  test("missing keys fall back to the contract default value", () => {
    const m = makeUserModel();
    // Only provide name; age and active should use their defaults (0 and false)
    const api = m.static({ name: "Partial" } as any);
    expect(api.name.getState()).toBe("Partial");
    expect(api.age.getState()).toBe(0);
    expect(api.active.getState()).toBe(false);
  });

  test("empty data object uses all contract defaults", () => {
    const m = makeUserModel();
    const api = m.static({} as any);
    expect(api.name.getState()).toBe("");
    expect(api.age.getState()).toBe(0);
    expect(api.active.getState()).toBe(false);
  });

  test("complex default values are preserved when not overridden", () => {
    const m = model({
      contract: contract({
        tags: define.store(define.static<string[]>(), ["default"]),
      })(),
      fn: ({ tags }) => ({ tags }),
    });
    const api = m.static({} as any);
    expect(api.tags.getState()).toEqual(["default"]);
  });
});

// ---------------------------------------------------------------------------
// model.static() – independence from model instances
// ---------------------------------------------------------------------------

describe("model.static() independence", () => {
  test("two static snapshots are independent stores", () => {
    const m = makeUserModel();
    const a = m.static({ name: "Alice", age: 30, active: true });
    const b = m.static({ name: "Bob", age: 25, active: false });

    expect(a.name).not.toBe(b.name);
    expect(a.name.getState()).toBe("Alice");
    expect(b.name.getState()).toBe("Bob");
  });

  test("mutating a static store does not affect another snapshot", async () => {
    const m = makeUserModel();
    const a = m.static({ name: "Alice", age: 1, active: false });
    const b = m.static({ name: "Bob", age: 2, active: false });

    const trigger = createEvent<string>();
    sample({ clock: trigger, target: a.name });

    const scope = fork({ values: [[a.name, a.name.getState()]] });
    await allSettled(trigger, { scope, params: "Changed" });

    expect(scope.getState(a.name)).toBe("Changed");
    expect(b.name.getState()).toBe("Bob");
  });

  test("static instance is not affected by model.create()", () => {
    const m = makeUserModel();
    const api = m.static({ name: "Static", age: 99, active: true });

    m.create({ id: "i1", data: { name: "Dynamic", age: 1, active: false } });

    // Static store holds its own value, unaffected by instance creation
    expect(api.name.getState()).toBe("Static");
    expect(api.age.getState()).toBe(99);
  });

  test("static instance is not affected by model $instances updates", () => {
    const m = makeCounterModel();
    const api = m.static({ count: 7 });

    m.create({ id: "x", data: { count: 0 } });

    expect(api.count.getState()).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// model.static() – reactivity of the returned units
// ---------------------------------------------------------------------------

describe("model.static() reactivity", () => {
  test("static store can be used as a sample source", async () => {
    const m = makeUserModel();
    const api = m.static({ name: "Reactive", age: 5, active: false });

    const output = createEvent<string>();
    const trigger = createEvent<void>();
    sample({ clock: trigger, source: api.name, target: output });

    const captured: string[] = [];
    output.watch((v) => captured.push(v));

    const scope = fork({ values: [[api.name, api.name.getState()]] });
    await allSettled(trigger, { scope });

    expect(captured).toContain("Reactive");
  });

  test("static event can be used as a sample clock", () => {
    const m = makeUserModel();
    const api = m.static({ name: "", age: 0, active: false });

    const spy = vi.fn();
    api.renamed.watch(spy);
    api.renamed("new-name");

    expect(spy).toHaveBeenCalledWith("new-name");
  });

  test("static store can be written to directly", async () => {
    const m = makeCounterModel();
    const api = m.static({ count: 0 });

    const trigger = createEvent<number>();
    sample({ clock: trigger, target: api.count });

    const scope = fork({ values: [[api.count, api.count.getState()]] });
    await allSettled(trigger, { scope, params: 42 });

    expect(scope.getState(api.count)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// model.static() – multiple calls on the same model
// ---------------------------------------------------------------------------

describe("model.static() called multiple times", () => {
  test("each call creates a fresh set of stores", () => {
    const m = makeCounterModel();
    const a = m.static({ count: 1 });
    const b = m.static({ count: 2 });
    const c = m.static({ count: 3 });

    expect(a.count.getState()).toBe(1);
    expect(b.count.getState()).toBe(2);
    expect(c.count.getState()).toBe(3);
    expect(a.count).not.toBe(b.count);
    expect(b.count).not.toBe(c.count);
  });

  test("static snapshots from different models are independent", () => {
    const m1 = makeCounterModel();
    const m2 = makeCounterModel();
    const a = m1.static({ count: 10 });
    const b = m2.static({ count: 20 });

    expect(a.count.getState()).toBe(10);
    expect(b.count.getState()).toBe(20);
    expect(a.count).not.toBe(b.count);
  });
});
