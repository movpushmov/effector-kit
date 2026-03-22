import {
  createEffect,
  createEvent,
  is,
  launch,
  sample,
  type Event,
  type StoreWritable,
} from "effector";
import { type Model, type ModelApi } from "../models";
import type {
  Lens,
  LensProps,
  LensPredicate,
  MatchCtx,
  ModelLensApi,
  UnionLens,
} from "./types";
import { getContext, setContext, setTarget } from "../runtime";
import { is as modelIs } from "../is";
import type { Union, UnionMap } from "../union";

const basePredicates = {
  where:
    (
      fn: (data: any, props: any, ctx?: any) => boolean,
      makeCtx?: (entity: any) => any,
    ): LensPredicate =>
    (instances, props) => {
      const newInstances: any = {};

      for (const key in instances) {
        const instance = instances[key];

        // Include the instance key as `id` so predicates can filter by key:
        // lens.where(({ id }) => id === "someKey")
        const entity = { id: key, ...instance };
        const ctx = makeCtx ? makeCtx(entity) : undefined;

        if (fn(entity, props, ctx)) {
          newInstances[key] = instance;
        }
      }

      return newInstances;
    },
  first: (instances: Record<string | number, any>) => {
    const entry = Object.entries(instances)[0];
    return entry ? { [entry[0]]: entry[1] } : {};
  },
  last: (instances: Record<string | number, any>) => {
    const entry = Object.entries(instances).at(-1);
    return entry ? { [entry[0]]: entry[1] } : {};
  },
};

function findInstance(instances: Record<string | number, any>, instance: any) {
  return Object.values(instances).find((value) => value === instance);
}

function applyTransformers(
  instances: Record<string, any>,
  predicates: LensPredicate[],
  payload: any,
): Record<string, any> {
  let buffer = instances;
  for (const predicate of predicates) {
    buffer = predicate(buffer, payload);
  }
  return buffer;
}

function getRuntimeInfo(
  getInstances: () => Record<string, any>,
  predicates: LensPredicate[],
  payload: any,
) {
  const ctx = getContext();
  const instances = applyTransformers(getInstances(), predicates, payload);
  return { ctx, instances };
}

function exportModelApi<T extends Model<any, ModelApi>>(
  model: T,
  getPredicates: () => LensPredicate[],
  getInstances: () => Record<string, any> = () => model.$instances.getState(),
  getTarget: () => Model<any, any>,
): ModelLensApi<T, any> {
  const lensApi: any = {};

  for (const key in model["~api"]) {
    const element = model["~api"][key];

    if (!element) {
      continue;
    }

    if (is.store(element) || is.event(element)) {
      const unitElement = {
        clock() {
          const clock = createEvent<any>();

          sample({
            clock: element as Event<any>,
            filter: (payload) => {
              const { ctx, instances } = getRuntimeInfo(
                getInstances,
                getPredicates(),
                payload,
              );

              if (!ctx.current) {
                return false;
              }

              return (
                Boolean(ctx.current) &&
                ctx.current.model === model &&
                Object.keys(instances).length > 0 &&
                findInstance(instances, ctx.current.instance)
              );
            },
            target: clock,
          });

          return clock;
        },
      };

      if (is.targetable(element)) {
        Object.defineProperty(unitElement, "target", {
          value: (map: (props: any) => any) => {
            const target = createEvent<any>();
            const actionFx = createEffect(async (payload: any) => {
              const { instances } = getRuntimeInfo(
                getInstances,
                getPredicates(),
                payload,
              );

              if (Object.keys(instances).length === 0) {
                return Promise.reject();
              }

              // When running inside allSettled(scope), Effector uses the
              // scope's registry for store equality checks. After the first
              // instance's launch sets scope.reg[store].current = payload,
              // subsequent launches with the same payload are skipped
              // (equal values). Fix: reset scope.reg[store].current to
              // undefined before each launch so the check always passes.
              let capturedScope: any = undefined;
              const storeRootId = is.store(element)
                ? (element as any).graphite.meta.rootStateRefId
                : null;

              for (const instance of Object.values(instances)) {
                setContext({ current: { model, instance } });
                setTarget(getTarget());

                if (capturedScope && storeRootId) {
                  const stateRef = capturedScope.reg[storeRootId];
                  if (stateRef) stateRef.current = undefined;
                }

                launch(element, payload);

                if (!capturedScope) {
                  capturedScope = getContext().current?.scope;
                }
              }
            });

            sample({
              clock: map !== undefined ? target.map(map) : target,
              target: actionFx,
            });

            return target;
          },
        });
      }

      lensApi[key] = unitElement;
    }

    if (modelIs.model(element)) {
      lensApi[key] = element.lens;
    }
  }

  return lensApi;
}

// ---- Shared lens core ----

function buildLensCore(getInstances: () => Record<string, any>) {
  const predicates: LensPredicate[] = [];
  return {
    predicates,
    getSource() {
      return applyTransformers(getInstances(), predicates, undefined);
    },
  };
}

// ---- Union helpers ----

/**
 * Merges instances from all active union variants into a single map.
 *
 * Internal keys are namespaced as `"${model['~id']}:${id}"` so variants can
 * share the same original ID without collision.  The entity's `id` field
 * always holds the **original** ID, so `where((e) => e.id === "foo")` matches
 * correctly across all variants.  Use `e["~model"]` to distinguish variants
 * that share an ID.
 */
function collectUnionInstances(
  inputUnion: Union<UnionMap>,
  activeKeys: string[],
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of activeKeys) {
    const m = inputUnion.models[key];
    if (!m) continue;
    for (const [id, data] of Object.entries(m.$instances.getState() ?? {})) {
      result[`${m["~id"]}:${id}`] = { ...(data as any), id, "~model": key };
    }
  }
  return result;
}

function makeMatchCtx(entity: any, models: UnionMap): MatchCtx<any> {
  return {
    match(config: any) {
      const handler = config[entity["~model"]];
      return handler ? handler(entity) : undefined;
    },
    // @ts-expect-error
    uniqueId(variantKey: string, id: string): string {
      return `${models[variantKey]?.["~id"] ?? variantKey}:${id}`;
    },
  };
}

// ---- Public API ----

export function lens<T extends Union<UnionMap>>(
  input: T,
): UnionLens<T, keyof T["models"]> & LensProps<T>;
export function lens<T extends Model<any, any>>(
  model: T,
): Lens<T> & LensProps<T>;
export function lens(input: Union<UnionMap> | Model<any, any>): any {
  if (modelIs.union(input)) {
    const unionInput = input as Union<UnionMap>;
    let activeKeys = Object.keys(unionInput.models);
    const { predicates, getSource } = buildLensCore(() =>
      collectUnionInstances(unionInput, activeKeys),
    );

    const lensObj: any = {
      where(predicate: any) {
        predicates.push(
          basePredicates.where(predicate, (entity) =>
            makeMatchCtx(entity, unionInput.models),
          ),
        );
        return lensObj;
      },
      only(...keys: string[]) {
        activeKeys = keys;
        return lensObj;
      },
      remove() {
        const removeEvent = createEvent<void>();

        for (const [key, m] of Object.entries(unionInput.models)) {
          sample({
            clock: removeEvent,
            source: m.$instances as unknown as StoreWritable<any>,
            fn: (current: any) => {
              const filtered = getSource();
              const updates: Record<string, any> = {};

              for (const [id, data] of Object.entries(current)) {
                const keep = !Object.values(filtered).some(
                  (entity: any) => entity["~model"] === key && entity.id === id,
                );
                if (keep) updates[id] = data;
              }
              return updates;
            },
            target: m.$instances as unknown as StoreWritable<any>,
          });
        }

        return removeEvent;
      },
      match(config: Record<string, (subLens: any) => any>) {
        const units: any[] = [];

        for (const [key, handler] of Object.entries(config)) {
          const variantModel = unionInput.models[key];
          if (!variantModel) continue;

          // Base instances for this key: union lens's own predicates applied.
          // Internal keys are namespaced; extract the original id from the
          // entity's `id` field to look up the raw instance in $instances.
          const getKeyInstances = () => {
            const filtered = getSource();
            const original = variantModel.$instances.getState() ?? {};
            const out: Record<string, any> = {};
            for (const entity of Object.values(filtered)) {
              if (entity["~model"] === key) {
                const originalId = entity.id;
                if (original[originalId])
                  out[originalId] = original[originalId];
              }
            }
            return out;
          };

          // Full model lens (where/first/last + per-store API) scoped to this
          // variant's filtered instances — same pattern as the regular model lens.
          const { predicates: subPredicates, getSource: getSubSource } =
            buildLensCore(getKeyInstances);

          const subLens: any = {
            where(predicate: any) {
              subPredicates.push(basePredicates.where(predicate));
              return subLens;
            },
            first() {
              subPredicates.push(basePredicates.first);
              return subLens;
            },
            last() {
              subPredicates.push(basePredicates.last);
              return subLens;
            },
            remove() {
              const removeEvent = createEvent<void>();

              sample({
                clock: removeEvent,
                source:
                  variantModel.$instances as unknown as StoreWritable<any>,
                fn: (current: any) => {
                  const filtered = getSubSource();
                  const updates: Record<string, any> = {};

                  for (const [id, data] of Object.entries(current)) {
                    const keep = !Object.keys(filtered).includes(id);
                    if (keep) updates[id] = data;
                  }
                  return updates;
                },
                target:
                  variantModel.$instances as unknown as StoreWritable<any>,
              });

              return removeEvent;
            },
            ...exportModelApi(
              variantModel,
              () => subPredicates,
              getKeyInstances,
              () => variantModel,
            ),
          };

          Object.defineProperty(subLens, "getSource", {
            configurable: true,
            value: getSubSource,
          });

          const unit = handler(subLens);
          if (unit) units.push(unit);
        }

        // Return a single writable EventCallable that fans out to all per-key
        // targets. Unlike merge(), this can be used as a sample target.
        const event = createEvent<any>();
        if (units.length > 0) {
          sample({ clock: event, target: units });
        }
        return event;
      },
    };

    // Per-key model API. getInstances reads through the union's filtered view
    // (namespaced keys) and maps back to original ids for dispatch.
    for (const [key, model] of Object.entries(unionInput.models)) {
      lensObj[key] = exportModelApi(
        model,
        () => [],
        () => {
          const filtered = getSource();
          const original = model.$instances.getState() ?? {};
          const result: Record<string, any> = {};
          for (const entity of Object.values(filtered)) {
            if (entity["~model"] === key) {
              const originalId = entity.id;
              if (original[originalId])
                result[originalId] = original[originalId];
            }
          }
          return result;
        },
        () => model,
      );
    }

    // Keep getSource accessible for internal overrides (e.g. ref) but off the type.
    Object.defineProperty(lensObj, "getSource", {
      configurable: true,
      value: getSource,
    });

    return lensObj;
  }

  const model = input as Model<any, any>;
  const { predicates, getSource } = buildLensCore(() =>
    model.$instances.getState(),
  );

  const lensObj: any = {
    props() {
      return lensObj;
    },
    where(predicate: (data: any, props?: any) => boolean) {
      predicates.push(basePredicates.where(predicate));
      return lensObj;
    },
    first() {
      predicates.push(basePredicates.first);
      return lensObj;
    },
    last() {
      predicates.push(basePredicates.last);
      return lensObj;
    },
    remove() {
      const removeEvent = createEvent<void>();

      sample({
        clock: removeEvent,
        source: model.$instances as unknown as StoreWritable<any>,
        fn: (current: any) => {
          const filtered = getSource();
          const updates: Record<string, any> = {};

          for (const [id, data] of Object.entries(current)) {
            const keep = !Object.keys(filtered).includes(id);
            if (keep) updates[id] = data;
          }
          return updates;
        },
        target: model.$instances as unknown as StoreWritable<any>,
      });

      return removeEvent;
    },
    ...exportModelApi(
      model,
      () => predicates,
      undefined,
      () => model,
    ),
  };

  Object.defineProperty(lensObj, "getSource", {
    configurable: true,
    value: getSource,
  });

  return lensObj;
}
