import { createEvent, createStore, sample } from "effector";
import type { Model } from "../models";
import { lens } from "../lens";
import type { Ref } from "./types";
import { is as modelIs } from "../is";
import type { Union, UnionMap } from "../union";
import { getEntityId, modifyRefsStore } from "../runtime";

type RefItem = { key: string; id: string };

function setModelRefSource(
  patchedLens: any,
  model: Model<any, any>,
  $ids: ReturnType<typeof createStore<string[]>>,
): void {
  patchedLens["~setSource"]?.({
    source: {
      ids: $ids,
      instances: model.$instances,
    },
    getSource: (
      _: any,
      source: {
        ids: string[];
        instances: Record<string, any>;
      },
    ) => {
      const ids = source?.ids ?? $ids.getState() ?? [];

      if (!ids.length) {
        return {};
      }

      const instances = source?.instances ?? model.$instances.getState() ?? {};

      return Object.fromEntries(
        Object.entries(instances).filter(([id]) => ids.includes(id)),
      );
    },
  });
}

function setUnionRefSource(
  patchedLens: any,
  input: Union<UnionMap>,
  $ids: ReturnType<typeof createStore<RefItem[]>>,
): void {
  patchedLens["~setSource"]?.({
    source: {
      ids: $ids,
      models: Object.fromEntries(
        Object.entries(input.models).map(([key, model]) => [key, model.$instances]),
      ),
    },
    getSource: (
      activeKeys: string[],
      _: any,
      source: {
        ids: RefItem[];
        models: Record<string, Record<string, any>>;
      },
    ) => {
      const ids = source?.ids ?? $ids.getState() ?? [];

      if (!ids.length) {
        return {};
      }

      const result: Record<string, any> = {};

      for (const { key, id } of ids) {
        if (!activeKeys.includes(key)) {
          continue;
        }

        const model = input.models[key];

        if (!model) {
          continue;
        }

        const instances =
          source?.models?.[key] ?? input.models[key].$instances.getState() ?? {};

        if (!instances[id]) {
          continue;
        }

        result[`${model["~id"]}:${id}`] = {
          ...instances[id],
          id,
          "~model": key,
        };
      }

      return result;
    },
  });
}

export function ref<T extends Union<UnionMap>>(union: T): Ref<T>;
export function ref<T extends Model<any, any>>(model: T): Ref<T>;
export function ref(input: Union<UnionMap> | Model<any, any>): Ref<any> {
  const refId = getEntityId();
  const patchedLens = lens(input as any);

  if (modelIs.union(input)) {
    const $ids = createStore<RefItem[]>([], {
      serialize: "ignore",
    });

    modifyRefsStore($ids as any, refId);
    setUnionRefSource(patchedLens, input, $ids);

    const add: Record<string, any> = {};
    const remove: Record<string, any> = {};

    for (const key of Object.keys(input.models)) {
      const addKey = createEvent<string>();
      const removeKey = createEvent<string>();

      sample({
        clock: addKey,
        source: $ids,
        filter: (ids, id) =>
          !ids.some((item) => item.key === key && item.id === id),
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

    return {
      "~kind": "ref",
      "~id": refId,
      "~target": input,
      lens: patchedLens,
      add,
      remove,
      $ids,
    };
  }

  const modelInput = input as Model<any, any>;

  const $ids = createStore<string[]>([]);
  modifyRefsStore($ids, refId);
  setModelRefSource(patchedLens, modelInput, $ids);

  const add = createEvent<string>();
  const remove = createEvent<string>();

  sample({
    clock: add,
    source: $ids,
    filter: (ids, id) => !ids.includes(id),
    fn: (ids, id) => [...ids, id],
    target: $ids,
  });

  sample({
    clock: remove,
    source: $ids,
    fn: (ids, id) => ids.filter((i) => i !== id),
    target: $ids,
  });

  return {
    "~kind": "ref",
    "~id": refId,
    "~target": modelInput,
    lens: patchedLens,
    add,
    remove,
    $ids,
  };
}
