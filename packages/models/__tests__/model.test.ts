import { describe, test, expect, vi } from "vitest";
import { createEvent, createStore, fork, allSettled } from "effector";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";
import { isModel } from "../lib/models/utils";

// ---------------------------------------------------------------------------
// define helpers
// ---------------------------------------------------------------------------

describe("define.store", () => {
  test("creates a store element with correct type and default", () => {
    const elem = define.store(42);
    expect(elem["~type"]).toBe("store");
    expect(elem.defaultValue).toBe(42);
  });

  test("preserves complex default values", () => {
    const defaultObj = { x: 1, y: 2 };
    const elem = define.store(defaultObj);
    expect(elem.defaultValue).toBe(defaultObj);
  });

  test("supports null as default", () => {
    const elem = define.store<string | null>(null);
    expect(elem.defaultValue).toBeNull();
  });
});

describe("define.event", () => {
  test("creates an event element with correct type", () => {
    const elem = define.event<string>();
    expect(elem["~type"]).toBe("event");
  });

  test("creates void event element", () => {
    const elem = define.event<void>();
    expect(elem["~type"]).toBe("event");
  });
});

describe("define.child", () => {
  test("creates a child element wrapping a model", () => {
    const innerModel = model({
      contract: contract({ val: define.store(0) })(),
      fn: ({ val }) => ({ val }),
    });
    const elem = define.child(innerModel);
    expect(elem["~type"]).toBe("child");
    expect(elem.model).toBe(innerModel);
  });
});

describe("define.ref", () => {
  test("creates a ref element wrapping a contract", () => {
    const c = contract({ x: define.store(0) })();
    const elem = define.ref(c);
    expect(elem["~type"]).toBe("ref");
    expect(elem.contract).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

describe("contract", () => {
  test("returns a factory function", () => {
    const factory = contract({ x: define.store(0) });
    expect(typeof factory).toBe("function");
  });

  test("calling factory returns a contract with correct shape", () => {
    const c = contract({
      name: define.store(""),
      age: define.store(0),
      updated: define.event<void>(),
    })();
    expect(c["~type"]).toBe("contract");
    expect(c.shape.name["~type"]).toBe("store");
    expect(c.shape.age["~type"]).toBe("store");
    expect(c.shape.updated["~type"]).toBe("event");
  });

  test("different calls to the factory return independent contracts", () => {
    const factory = contract({ x: define.store(0) });
    const c1 = factory();
    const c2 = factory();
    expect(c1).not.toBe(c2);
  });
});

// ---------------------------------------------------------------------------
// isModel
// ---------------------------------------------------------------------------

describe("isModel", () => {
  test("returns true for a model", () => {
    const m = model({
      contract: contract({ x: define.store(0) })(),
      fn: ({ x }) => ({ x }),
    });
    expect(isModel(m)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isModel(null)).toBe(false);
  });

  test("returns false for undefined", () => {
    expect(isModel(undefined)).toBe(false);
  });

  test("returns false for a plain object", () => {
    expect(isModel({ "~type": "not-model" })).toBe(false);
  });

  test("returns false for a plain object without ~type", () => {
    expect(isModel({})).toBe(false);
  });

  test("returns false for a number", () => {
    expect(isModel(42)).toBe(false);
  });

  test("returns false for an effector event", () => {
    expect(isModel(createEvent())).toBe(false);
  });

  test("returns false for an effector store", () => {
    expect(isModel(createStore(0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// model structure
// ---------------------------------------------------------------------------

describe("model structure", () => {
  test("model has expected fields", () => {
    const m = model({
      contract: contract({ x: define.store(0) })(),
      fn: ({ x }) => ({ x }),
    });
    expect(m["~type"]).toBe("model");
    expect(typeof m["~id"]).toBe("string");
    expect(m["~contract"]).toBeDefined();
    expect(m["~fn"]).toBeTypeOf("function");
    expect(m.$instances).toBeDefined();
    expect(m.create).toBeDefined();
    expect(m.lens).toBeDefined();
  });

  test("$instances starts empty", () => {
    const m = model({
      contract: contract({ x: define.store(0) })(),
      fn: ({ x }) => ({ x }),
    });
    expect(m.$instances.getState()).toEqual({});
  });

  test("model api contains stores and events returned from fn", () => {
    const m = model({
      contract: contract({
        count: define.store(0),
        increment: define.event<void>(),
        label: define.store("hello"),
      })(),
      fn: ({ count, increment, label }) => ({ count, increment, label }),
    });
    expect(m["~api"].count).toBeDefined();
    expect(m["~api"].increment).toBeDefined();
    expect(m["~api"].label).toBeDefined();
  });

  test("model api can return a subset of elements", () => {
    const m = model({
      contract: contract({
        a: define.store(0),
        b: define.store(0),
        c: define.event<void>(),
      })(),
      fn: ({ a }) => ({ a }), // only expose 'a'
    });
    expect(m["~api"].a).toBeDefined();
    expect((m["~api"] as any).b).toBeUndefined();
    expect((m["~api"] as any).c).toBeUndefined();
  });

  test("two models with same contract are independent", () => {
    const c = contract({ val: define.store(0) })();
    const m1 = model({ contract: c, fn: ({ val }) => ({ val }) });
    const m2 = model({ contract: c, fn: ({ val }) => ({ val }) });

    m1.create({ id: "x", data: { val: 1 } });
    m2.create({ id: "x", data: { val: 2 } });

    expect(m1.$instances.getState()["x"]).toMatchObject({ val: 1 });
    expect(m2.$instances.getState()["x"]).toMatchObject({ val: 2 });
  });
});

// ---------------------------------------------------------------------------
// instance creation
// ---------------------------------------------------------------------------

describe("instance creation", () => {
  test("create adds instance to $instances", () => {
    const m = model({
      contract: contract({ name: define.store("") })(),
      fn: ({ name }) => ({ name }),
    });

    m.create({ id: "1", data: { name: "Alice" } });

    expect(m.$instances.getState()).toMatchObject({
      "1": { name: "Alice" },
    });
  });

  test("create with multiple string/number fields", () => {
    const m = model({
      contract: contract({
        name: define.store(""),
        age: define.store(0),
        score: define.store(0),
      })(),
      fn: ({ name, age, score }) => ({ name, age, score }),
    });

    m.create({ id: "u1", data: { name: "Bob", age: 25, score: 100 } });

    expect(m.$instances.getState()["u1"]).toMatchObject({
      name: "Bob",
      age: 25,
      score: 100,
    });
  });

  test("multiple instances are stored independently", () => {
    const m = model({
      contract: contract({ value: define.store(0) })(),
      fn: ({ value }) => ({ value }),
    });

    m.create({ id: "a", data: { value: 1 } });
    m.create({ id: "b", data: { value: 2 } });
    m.create({ id: "c", data: { value: 3 } });

    const instances = m.$instances.getState();
    expect(Object.keys(instances)).toHaveLength(3);
    expect(instances["a"]).toMatchObject({ value: 1 });
    expect(instances["b"]).toMatchObject({ value: 2 });
    expect(instances["c"]).toMatchObject({ value: 3 });
  });

  test("creating instance with same id overwrites previous data", () => {
    const m = model({
      contract: contract({ value: define.store(0) })(),
      fn: ({ value }) => ({ value }),
    });

    m.create({ id: "dup", data: { value: 10 } });
    m.create({ id: "dup", data: { value: 99 } });

    const instances = m.$instances.getState();
    expect(Object.keys(instances)).toHaveLength(1);
    expect(instances["dup"]).toMatchObject({ value: 99 });
  });

  test("creates many instances in sequence", () => {
    const m = model({
      contract: contract({ index: define.store(0) })(),
      fn: ({ index }) => ({ index }),
    });

    const count = 50;
    for (let i = 0; i < count; i++) {
      m.create({ id: String(i), data: { index: i } });
    }

    const instances = m.$instances.getState();
    expect(Object.keys(instances)).toHaveLength(count);

    for (let i = 0; i < count; i++) {
      expect(instances[String(i)]).toMatchObject({ index: i });
    }
  });

  test("instance creation via fork does not affect global $instances", async () => {
    const m = model({
      contract: contract({ x: define.store(0) })(),
      fn: ({ x }) => ({ x }),
    });

    const scope = fork();

    await allSettled(m.create, {
      scope,
      params: { id: "scoped", data: { x: 42 } },
    });

    // Global state should not be changed
    expect(m.$instances.getState()).toEqual({});
    // Scope should have the instance
    expect(scope.getState(m.$instances)).toMatchObject({
      scoped: { x: 42 },
    });
  });

  test("two forks with same model are independent", async () => {
    const m = model({
      contract: contract({ label: define.store("") })(),
      fn: ({ label }) => ({ label }),
    });

    const scope1 = fork();
    const scope2 = fork();

    await allSettled(m.create, {
      scope: scope1,
      params: { id: "same-id", data: { label: "from-scope-1" } },
    });

    await allSettled(m.create, {
      scope: scope2,
      params: { id: "same-id", data: { label: "from-scope-2" } },
    });

    expect(scope1.getState(m.$instances)["same-id"]).toMatchObject({
      label: "from-scope-1",
    });
    expect(scope2.getState(m.$instances)["same-id"]).toMatchObject({
      label: "from-scope-2",
    });
  });

  test("multiple instances in same fork scope", async () => {
    const m = model({
      contract: contract({ n: define.store(0) })(),
      fn: ({ n }) => ({ n }),
    });

    const scope = fork();

    await allSettled(m.create, { scope, params: { id: "1", data: { n: 10 } } });
    await allSettled(m.create, { scope, params: { id: "2", data: { n: 20 } } });
    await allSettled(m.create, { scope, params: { id: "3", data: { n: 30 } } });

    const instances = scope.getState(m.$instances);
    expect(Object.keys(instances)).toHaveLength(3);
    expect(instances["1"]).toMatchObject({ n: 10 });
    expect(instances["2"]).toMatchObject({ n: 20 });
    expect(instances["3"]).toMatchObject({ n: 30 });
  });
});
