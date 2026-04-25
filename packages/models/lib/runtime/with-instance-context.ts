import { is, type Scope, type StoreWritable } from "effector";
import { is as runtimeIs } from "../is";
import type { Model } from "../models";
import { getContext, setContext } from "./context";

type StoreDescriptor = {
  field?: string;
  store: {
    targetable?: boolean;
    getState: () => unknown;
    graphite: {
      meta: {
        rootStateRefId?: string;
        stateRef: {
          current: unknown;
          initial?: unknown;
          type?: string;
          before?: Array<{
            type?: string;
            fn?: ((value: unknown) => unknown) | undefined;
            from?: {
              current: unknown;
              initial?: unknown;
              type?: string;
              before?: unknown[];
            };
          }>;
        };
      };
    };
  };
};
type StateRefStep = {
  type?: string;
  fn?: ((value: unknown) => unknown) | undefined;
  from?: StateRefShape;
};
type StateRefShape = {
  current: unknown;
  initial?: unknown;
  type?: string;
  before?: StateRefStep[];
};

const storeDescriptorsCache = new WeakMap<object, StoreDescriptor[]>();

function isPlainModelApiObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !is.store(value) &&
    !runtimeIs.model(value) &&
    !runtimeIs.ref(value) &&
    !runtimeIs.union(value)
  );
}

function collectStoreDescriptors(api: Record<string, unknown>): StoreDescriptor[] {
  const cached = storeDescriptorsCache.get(api);

  if (cached) {
    return cached;
  }

  const seenStores = new Set<object>();
  const descriptors: StoreDescriptor[] = [];

  function visit(value: unknown): void {
    if (is.store(value)) {
      const field =
        typeof (value as { ["~field"]?: unknown })["~field"] === "string"
          ? ((value as { ["~field"]?: string })["~field"] as string)
          : undefined;

      if (seenStores.has(value as object)) {
        return;
      }

      seenStores.add(value as object);
      const descriptor: StoreDescriptor = {
        store: value as unknown as StoreDescriptor["store"],
      };

      if (field !== undefined) {
        descriptor.field = field;
      }

      descriptors.push(descriptor);
      return;
    }

    if (!isPlainModelApiObject(value)) {
      return;
    }

    for (const nestedValue of Object.values(value)) {
      visit(nestedValue);
    }
  }

  visit(api);
  storeDescriptorsCache.set(api, descriptors);

  return descriptors;
}

function evaluateStateRef(stateRef: StateRefShape): unknown {
  if (!Array.isArray(stateRef.before) || stateRef.before.length === 0) {
    return stateRef.current;
  }

  if (stateRef.type === "list") {
    return stateRef.before.map((step) =>
      step.from ? evaluateStateRef(step.from) : undefined,
    );
  }

  if (stateRef.type === "shape") {
    const template =
      stateRef.current && typeof stateRef.current === "object"
        ? (stateRef.current as Record<string, unknown>)
        : stateRef.initial && typeof stateRef.initial === "object"
          ? (stateRef.initial as Record<string, unknown>)
          : {};
    const keys = Object.keys(template);

    return Object.fromEntries(
      stateRef.before.map((step, index) => [
        keys[index] ?? String(index),
        step.from ? evaluateStateRef(step.from) : undefined,
      ]),
    );
  }

  if (stateRef.before.length === 1 && stateRef.before[0]) {
    const step = stateRef.before[0];
    const source = step.from ? evaluateStateRef(step.from) : undefined;

    return step.fn ? step.fn(source) : source;
  }

  return stateRef.current;
}

function primeScopeRefs(
  descriptors: StoreDescriptor[],
  instance: Record<string, any>,
  scope?: Scope,
): void {
  const scopeReg = (scope as
    | (Scope & {
        reg?: Record<string, { current: unknown }>;
      })
    | undefined)?.reg;

  if (!scopeReg) {
    return;
  }

  for (const { field, store } of descriptors) {
    if (store.targetable !== true) {
      continue;
    }

    const rootId = store.graphite.meta.rootStateRefId;

    if (!rootId) {
      continue;
    }

    const nextValue =
      typeof field === "string" && field in instance
        ? instance[field]
        : (() => {
            try {
              return store.getState();
            } catch {
              return store.graphite.meta.stateRef.current;
            }
          })();

    if (!scopeReg[rootId]) {
      scopeReg[rootId] = Object.assign({}, store.graphite.meta.stateRef, {
        current: nextValue,
      });
    } else {
      scopeReg[rootId]!.current = nextValue;
    }
  }
}

export function withInstanceContext<T>(
  model: Model<any, any>,
  instance: Record<string, any>,
  fn: () => T,
  scope?: Scope,
): T {
  const previous = getContext();
  const descriptors = collectStoreDescriptors(
    model["~api"] as Record<string, unknown>,
  );
  const derivedDescriptors = descriptors.filter(
    ({ store }) => store.targetable !== true,
  );
  const snapshots = derivedDescriptors.map(({ store }) => ({
    store,
    value: store.graphite.meta.stateRef.current,
  }));

  setContext({
    current: previous.current
      ? {
          ...previous.current,
          owner: previous.current.owner ?? previous.current,
          model,
          instance,
          scope,
        }
      : {
          model,
          instance,
          scope,
        },
  });

  try {
    primeScopeRefs(descriptors, instance, scope);

    for (const { store } of derivedDescriptors) {
      // Writable model stores already read from the active runtime context via
      // their patched stateRef getters. Touching their stateRefs during a read
      // turns a render-time read into an in-place instance write, which leaks
      // values across ids. Only derived refs need temporary recomputation here.
      store.graphite.meta.stateRef.current = evaluateStateRef(
        store.graphite.meta.stateRef as unknown as StateRefShape,
      );
    }

    return fn();
  } finally {
    setContext(previous);

    for (const { store, value } of snapshots) {
      store.graphite.meta.stateRef.current = value;
    }
  }
}
