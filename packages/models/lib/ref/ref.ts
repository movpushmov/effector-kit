import { createEvent, createStore, sample } from "effector";
import type { Model } from "../models";
import { lens } from "../lens";
import type { Ref } from "./types";
import { is as modelIs } from "../is";
import type { Union, UnionMap } from "../union";
import { modifyRefsStore } from "../runtime";

export function ref<T extends Union<UnionMap>>(union: T): Ref<T>;
export function ref<T extends Model<any, any>>(model: T): Ref<T>;
export function ref(input: Union<UnionMap> | Model<any, any>): Ref<any> {
  const refSid = createStore(null).sid;
  const patchedLens = lens(input as any);

  if (modelIs.union(input)) {
    // Store { key, id } pairs — JSON-serializable for SSR hydration.
    const $ids = createStore<Array<{ key: string; id: string }>>([], {
      sid: `$ref-union/${refSid}`,
    });

    Object.defineProperty(patchedLens, "getSource", {
      configurable: true,
      value: () => {
        const ids = $ids.getState();
        if (!ids.length) return {};
        const result: Record<string, any> = {};
        for (const { key, id } of ids) {
          const m = (input as Union<UnionMap>).models[key];
          if (!m) continue;
          const instances = m.$instances.getState();
          if (!instances?.[id]) continue;
          // Namespace using model['~id'] — same rule as collectUnionInstances.
          // The entity's `id` field holds the original id for where() lookups.
          result[`${m["~id"]}:${id}`] = { ...instances[id], id, "~model": key };
        }
        return result;
      },
    });

    const add: Record<string, any> = {};
    const remove: Record<string, any> = {};

    for (const key of Object.keys(input.models)) {
      const addKey = createEvent<string>();
      const removeKey = createEvent<string>();

      sample({
        clock: addKey,
        source: $ids,
        fn: (ids, id) => [...ids, { key, id }],
        target: $ids,
      });

      sample({
        clock: removeKey,
        source: $ids,
        fn: (ids, id) => ids.filter((i) => !(i.key === key && i.id === id)),
        target: $ids,
      });

      add[key] = addKey;
      remove[key] = removeKey;
    }

    return { "~kind": "ref", lens: patchedLens, add, remove, $ids };
  }

  const modelInput = input as Model<any, any>;

  // Store plain string IDs — JSON-serializable for SSR hydration.
  const $ids = createStore<string[]>([], { sid: `$ref/${refSid}` });
  modifyRefsStore($ids);

  Object.defineProperty(patchedLens, "getSource", {
    configurable: true,
    value: () => {
      const ids = $ids.getState();
      if (!ids.length) return {};
      const instances = modelInput.$instances.getState() ?? {};
      return Object.fromEntries(
        Object.entries(instances).filter(([key]) => ids.includes(key)),
      );
    },
  });

  const add = createEvent<string>();
  const remove = createEvent<string>();

  sample({
    clock: add,
    source: $ids,
    fn: (ids, id) => [...ids, id],
    target: $ids,
  });

  sample({
    clock: remove,
    source: $ids,
    fn: (ids, id) => ids.filter((i) => i !== id),
    target: $ids,
  });

  return { "~kind": "ref", lens: patchedLens, add, remove, $ids };
}
