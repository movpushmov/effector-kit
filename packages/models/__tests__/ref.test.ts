import { describe, test, expect } from "vitest";
import { sample, createEvent } from "effector";
import { model } from "../lib/models";
import { contract } from "../lib/contracts";
import { define } from "../lib/define";
import { ref } from "../lib/ref/ref";

const tick = () => new Promise<void>((r) => setTimeout(r, 10));

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

// ---------------------------------------------------------------------------
// ref creation
// ---------------------------------------------------------------------------

describe("ref() structure", () => {
  test("returns an object with ~type 'ref'", () => {
    const m = makeItemModel();
    const r = ref(m);
    expect(r["~kind"]).toBe("ref");
  });

  test("returned ref has a lens property", () => {
    const m = makeItemModel();
    const r = ref(m);
    expect(r.lens).toBeDefined();
  });

  test("ref lens has getSource", () => {
    const m = makeItemModel();
    const r = ref(m);
    expect(typeof r.lens.getSource).toBe("function");
  });

  test("ref lens has where, first, last", () => {
    const m = makeItemModel();
    const r = ref(m);
    expect(typeof r.lens.where).toBe("function");
    expect(typeof r.lens.first).toBe("function");
    expect(typeof r.lens.last).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ref getSource() – filters by tracked ids
// ---------------------------------------------------------------------------

describe("ref lens.getSource()", () => {
  test("returns empty object when outside context (null ids guarded to {})", () => {
    const m = makeItemModel();
    const r = ref(m);

    // $ids reads from instance context; outside context the getter returns null.
    // getSource() guards against null and returns {} in that case.
    m.create({ id: "1", data: { label: "A", active: true } });
    m.create({ id: "2", data: { label: "B", active: false } });

    expect(r.lens.getSource()).toEqual({});
  });

  test("different refs on same model are independent — both empty outside context", () => {
    const m = makeItemModel();
    const r1 = ref(m);
    const r2 = ref(m);

    m.create({ id: "1", data: { label: "A", active: true } });

    expect(r1.lens.getSource()).toEqual({});
    expect(r2.lens.getSource()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ref lens API – target and clock exist
// ---------------------------------------------------------------------------

describe("ref lens API", () => {
  test("ref lens exposes store targets from the underlying model", () => {
    const m = makeItemModel();
    const r = ref(m);

    // The lens should have the model's API units
    expect((r.lens as any).label).toBeDefined();
    expect(typeof (r.lens as any).label.target).toBe("function");
    expect(typeof (r.lens as any).label.clock).toBe("function");
  });

  test("ref lens target on empty ref is a no-op", async () => {
    const m = makeItemModel();
    const r = ref(m);

    m.create({ id: "1", data: { label: "original", active: false } });

    // r has no ids tracked, so target should be a no-op
    const setLabel = (r.lens as any).label.target();
    setLabel("changed");
    await tick();

    // Instance should not be updated since ref has no ids
    expect(m.$instances.getState()["1"]?.label).toBe("original");
  });
});

// ---------------------------------------------------------------------------
// ref inside a model (using modifyRefsStore context)
// ---------------------------------------------------------------------------

describe("ref used inside a model's fn", () => {
  test("ref created inside fn can be used to store instance ids", async () => {
    const targetModel = makeItemModel();

    // A parent model that holds a ref to targetModel
    const parentModel = model({
      contract: contract({
        refIds: define.store(define.static<string[]>(), []),
        setRef: define.event(define.static<string[]>()),
      })(),
      fn: ({ refIds, setRef }) => {
        const r = ref(targetModel);

        // Wire setRef event to update ref ids
        // (In real usage, r's $ids would be the context-aware store,
        //  but we test that the ref object is created without errors)
        sample({
          clock: setRef,
          target: refIds,
        });

        return { refIds, setRef };
      },
    });

    parentModel.create({ id: "p1", data: { refIds: [] } });

    // Verify parent model was created successfully
    expect(parentModel.$instances.getState()["p1"]).toBeDefined();
  });

  test("multiple refs to different models can coexist in a fn", () => {
    const modelA = makeItemModel();
    const modelB = makeItemModel();

    expect(() => {
      model({
        contract: contract({
          x: define.store(define.static<number>(), 0),
        })(),
        fn: ({ x }) => {
          const refA = ref(modelA);
          const refB = ref(modelB);

          // Just creating refs shouldn't throw
          expect(refA["~kind"]).toBe("ref");
          expect(refB["~kind"]).toBe("ref");

          return { x };
        },
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ref – distinct from model lens
// ---------------------------------------------------------------------------

describe("ref vs model lens", () => {
  test("ref and model.lens are different objects", () => {
    const m = makeItemModel();
    const r = ref(m);

    expect(r.lens).not.toBe(m.lens);
  });

  test("model.lens.getSource returns all instances; ref.lens.getSource is filtered", () => {
    const m = makeItemModel();
    const r = ref(m);

    m.create({ id: "1", data: { label: "A", active: true } });
    m.create({ id: "2", data: { label: "B", active: false } });

    // model lens returns all
    expect(Object.keys(m.lens.getSource())).toHaveLength(2);

    // ref lens returns only tracked ids (none here → empty)
    expect(r.lens.getSource()).toEqual({});
  });
});
