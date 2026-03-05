import { createEvent, createStore, type Store } from "effector";
import type { Contract, ShapeElement } from "../contracts";
import type { ContractApi } from "./types";
import { getContext, modifyStore } from "../runtime";
import { createAction } from "effector-action";

function transform(
  from: Record<string, ShapeElement>,
  to: Record<string, any>,
) {
  for (const key in from) {
    const item = from[key];

    if (!item) {
      throw new Error("Invalid item type: undefined");
    }

    switch (item?.["~type"]) {
      case "store": {
        to[key] = createStore(item.defaultValue, { serialize: "ignore" });

        modifyStore(to[key], key);

        break;
      }
      case "event": {
        to[key] = createEvent();
        break;
      }
    }
  }
}

export function createApi<T extends Contract<any>>(
  contract: T,
): ContractApi<T> {
  const api = {} as ContractApi<T>;

  transform(contract.shape, api);

  return api;
}
