import { describe, test, expect } from "vitest";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";
import { child } from "../lib/child/child";
import { is } from "../lib";

const tick = () => new Promise<void>((r) => setTimeout(r, 10));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeBaseModel() {
  return model({
    contract: contract({
      name: define.store(define.static<string>(), ""),
      value: define.store(define.static<number>(), 0),
    })(),
    fn: ({ name, value }) => ({ name, value }),
  });
}

// ---------------------------------------------------------------------------
// child() structure
// ---------------------------------------------------------------------------

describe("child() structure", () => {
  test("returns a model (is.model returns true)", () => {
    const base = makeBaseModel();
    const c = child(base);
    expect(is.model(c)).toBe(true);
  });

  test("returned child has same contract as input model", () => {
    const base = makeBaseModel();
    const c = child(base);
    expect(c["~contract"]).toBe(base["~contract"]);
  });

  test("returned child has same fn as input model", () => {
    const base = makeBaseModel();
    const c = child(base);
    expect(c["~fn"]).toBe(base["~fn"]);
  });

  test("child has its own $instances store", () => {
    const base = makeBaseModel();
    const c = child(base);
    expect(c.$instances).not.toBe(base.$instances);
  });

  test("child has its own create event", () => {
    const base = makeBaseModel();
    const c = child(base);
    expect(c.create).not.toBe(base.create);
  });

  test("child has a lens", () => {
    const base = makeBaseModel();
    const c = child(base);
    expect(c.lens).toBeDefined();
    expect(typeof c.lens.getSource).toBe("function");
  });

  test("multiple children from same base are independent models", () => {
    const base = makeBaseModel();
    const c1 = child(base);
    const c2 = child(base);

    expect(c1).not.toBe(c2);
    expect(c1.$instances).not.toBe(c2.$instances);
    expect(c1["~id"]).not.toBe(c2["~id"]);
  });
});

// ---------------------------------------------------------------------------
// child $instances isolation
// ---------------------------------------------------------------------------

describe("child $instances isolation", () => {
  test("child $instances returns null outside any parent context", () => {
    const base = makeBaseModel();
    const c = child(base);

    // modifyChildStore overrides stateRef.current with a context-aware getter.
    // Outside of any parent instance context, the getter returns null.
    expect(c.$instances.getState()).toBeNull();
  });

  test("creating instances on base does not change child $instances outside context", () => {
    const base = makeBaseModel();
    const c = child(base);

    base.create({ id: "1", data: { name: "Alice", value: 1 } });
    base.create({ id: "2", data: { name: "Bob", value: 2 } });

    // Child store still returns null outside context — base instances don't affect it
    expect(c.$instances.getState()).toBeNull();
  });

  test("creating child instances outside context throws (store has only a getter)", () => {
    const base = makeBaseModel();
    const c = child(base);

    // Calling c.create() outside any parent context tries to write to
    // a store whose stateRef.current has only a getter → TypeError
    expect(() => {
      c.create({ id: "child-1", data: { name: "Inner", value: 99 } });
    }).toThrow();

    // Base global instances are untouched
    expect(base.$instances.getState()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// child used inside parent model fn
// ---------------------------------------------------------------------------

describe("child used inside parent model fn", () => {
  test("child created inside fn does not throw", () => {
    const itemModel = model({
      contract: contract({
        label: define.store(define.static<string>(), ""),
        score: define.store(define.static<number>(), 0),
      })(),
      fn: ({ label, score }) => ({ label, score }),
    });

    expect(() => {
      model({
        contract: contract({
          parentValue: define.store(define.static<number>(), 0),
        })(),
        fn: ({ parentValue }) => {
          // Create a child scope for itemModel
          const childItems = child(itemModel);
          expect(is.model(childItems)).toBe(true);
          return { parentValue };
        },
      });
    }).not.toThrow();
  });

  test("child model has api that mirrors base model api", () => {
    const base = makeBaseModel();
    const c = child(base);

    // Child's api should mirror base model's api structure
    expect(c["~api"].name).toBeDefined();
    expect(c["~api"].value).toBeDefined();
  });

  test("multiple children with different base models coexist", () => {
    const modelA = model({
      contract: contract({ a: define.store(define.static<number>(), 0) })(),
      fn: ({ a }) => ({ a }),
    });

    const modelB = model({
      contract: contract({ b: define.store(define.static<string>(), "") })(),
      fn: ({ b }) => ({ b }),
    });

    expect(() => {
      const childA = child(modelA);
      const childB = child(modelB);

      expect(is.model(childA)).toBe(true);
      expect(is.model(childB)).toBe(true);
      expect(childA["~id"]).not.toBe(childB["~id"]);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// child lens
// ---------------------------------------------------------------------------

describe("child lens", () => {
  test("child lens getSource returns null outside context (via $instances getter)", () => {
    const base = makeBaseModel();
    const c = child(base);
    // The child lens delegates to $instances.getState() which returns null outside context
    expect(c.lens.getSource()).toBeNull();
  });

  test("child lens has target and clock on model api elements", () => {
    const base = makeBaseModel();
    const c = child(base);

    expect(typeof c.lens.name.target).toBe("function");
    expect(typeof c.lens.name.clock).toBe("function");
    expect(typeof c.lens.value.target).toBe("function");
  });

  test("child lens target outside context is a no-op (no instances to iterate)", async () => {
    const base = makeBaseModel();
    const c = child(base);

    // target() succeeds — but with null instances there are no entries to iterate
    const setName = c.lens.name.target();
    setName("should-not-update");
    await tick();

    // $instances is still null (no context has been established)
    expect(c.$instances.getState()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// child vs define.child
// ---------------------------------------------------------------------------

describe("child() vs define.child()", () => {
  test("define.child wraps model in element, child() creates a model", () => {
    const base = makeBaseModel();

    const elem = define.child(base);
    const m = child(base);

    expect(elem["~kind"]).toBe("child");
    expect(m["~kind"]).toBe("model");
  });

  test("define.child preserves the model reference", () => {
    const base = makeBaseModel();
    const elem = define.child(base);
    expect(elem.model).toBe(base);
  });
});
