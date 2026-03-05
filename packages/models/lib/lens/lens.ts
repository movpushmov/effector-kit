import {
  createEffect,
  createEvent,
  is,
  launch,
  sample,
  type Event,
} from "effector";
import { isModel, type Model, type ModelApi } from "../models";
import type { Lens, LensProps, LensPredicate, ModelLensApi } from "./types";
import { getContext, setContext } from "../runtime";

const basePredicates = {
  where:
    (fn: (data: any, props: any) => boolean): LensPredicate =>
    (instances, props) => {
      const newInstances: any = {};

      for (const key in instances) {
        const instance = instances[key];

        // Include the instance key as `id` so predicates can filter by key:
        // lens.where(({ id }) => id === "someKey")
        if (fn({ id: key, ...instance }, props)) {
          newInstances[key] = instance;
        }
      }

      return newInstances;
    },
  first: (instances: Record<string | number, any>) => {
    const entry = Object.entries(instances)[0];

    if (entry) {
      return { [entry[0]]: entry[1] };
    }

    return {};
  },
  last: (instances: Record<string | number, any>) => {
    const entry = Object.entries(instances).at(-1);

    if (entry) {
      return { [entry[0]]: entry[1] };
    }

    return {};
  },
};

function findInstance(instances: Record<string | number, any>, instance: any) {
  return Object.values(instances).find((value) => value === instance);
}

function applyTransformers(
  instances: Record<string, any>,
  predicates: LensPredicate[],
  payload: any,
) {
  let buffer = instances;

  for (const predicate of predicates) {
    buffer = predicate(buffer, payload);
  }

  return buffer;
}

function getRuntimeInfo(
  model: Model<any, any>,
  predicates: LensPredicate[],
  payload: any,
) {
  const ctx = getContext();
  const instances = applyTransformers(
    model.$instances.getState(),
    predicates,
    payload,
  );

  return { ctx, instances };
}

function exportModelApi<T extends Model<any, ModelApi>>(
  model: T,
  getPredicates: () => LensPredicate[],
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
                model,
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
                model,
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

    if (isModel(element)) {
      lensApi[key] = element.lens;
    }
  }

  return lensApi;
}

export function lens<T extends Model<any, any>>(
  model: T,
): Lens<T> & LensProps<T> {
  let predicates: LensPredicate[] = [];
  let mode: "single" | "multiply" = "multiply";

  // @ts-expect-error
  return {
    getSource() {
      return model.$instances.getState();
    },

    props() {
      return this;
    },

    where(predicate) {
      predicates.push(basePredicates.where(predicate));
      return this;
    },

    first() {
      mode = "single";
      predicates.push(basePredicates.first);
      return this;
    },

    last() {
      mode = "single";
      predicates.push(basePredicates.last);
      return this;
    },

    ...exportModelApi(model, () => predicates),
  };
}
