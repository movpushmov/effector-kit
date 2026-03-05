import { createEvent, createStore, sample } from "effector";
import type { Model } from "../models";
import { lens } from "../lens";
import type { Ref } from "./types";
import { modifyRefsStore } from "../runtime";

export function ref<T extends Model<any, any>>(model: T): Ref<T> {
  const $ids = createStore<string[]>([]);
  modifyRefsStore(model, $ids);

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

  const patchedLens = lens(model);
  Object.defineProperty(patchedLens, "getSource", {
    value: () => {
      const ids = $ids.getState();
      if (!ids) return {};
      const instances = model.$instances.getState();

      return Object.fromEntries(
        Object.entries(instances).filter(([key]) => ids.includes(key)),
      );
    },
  });

  return {
    "~type": "ref",
    lens: patchedLens,
  };
}
