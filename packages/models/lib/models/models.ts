import {
  createEvent,
  createStore,
  is,
  sample,
  type StoreWritable,
} from "effector";
import type { Contract } from "../contracts";
import type {
  ContractApi,
  ContractData,
  CreateInstancePayload,
  Instances,
  Model,
  ModelApi,
} from "./types";
import { modifyDeclarations, getEntityId, modifyStore } from "../runtime";
import { createApi, createStaticApi } from "./create-api";
import { lens } from "../lens";

interface ModelOptions<T extends Contract<any>, Api extends ModelApi> {
  contract: T;
  fn: (api: ContractApi<T>) => Api;
  instances?: StoreWritable<Instances<T>>;
}

export function model<T extends Contract<any>, Api extends ModelApi>({
  contract,
  fn,
  instances,
}: ModelOptions<T, Api>): Model<T, Api> {
  const $instances = instances ?? createStore<Instances<T>>({});

  const createInstance = createEvent<
    CreateInstancePayload<T> | CreateInstancePayload<T>[]
  >();

  const deleteInstance = createEvent<string | string[]>();

  const localStoreDefaults: Record<string, unknown> = {};

  const { result: modelApi } = modifyDeclarations(() => {
    const api = createApi(contract);
    const result = fn(api);

    for (const [key, element] of Object.entries(result)) {
      if (!is.store(element)) {
        continue;
      }

      if (!(key in contract.shape)) {
        localStoreDefaults[key] = element.getState();
        Object.defineProperty(element, "~field", {
          value: key,
          configurable: true,
        });
        modifyStore(element, key);
      }
    }

    return result;
  });

  sample({
    clock: createInstance,
    source: $instances,
    fn: (instances, payload) => {
      const newInstances = Array.isArray(payload) ? payload : [payload];
      const copy = { ...instances };

      for (const instance of newInstances) {
        copy[instance.id] = {
          ...localStoreDefaults,
          ...instance.data,
        };
      }

      return copy;
    },
    target: $instances,
  });

  sample({
    clock: deleteInstance,
    source: $instances,
    fn: (instances, id) => {
      const toRemove = Array.isArray(id) ? id : [id];
      const copy = { ...instances };

      for (const id of toRemove) {
        delete copy[id];
      }

      return copy;
    },
    target: $instances,
  });

  const builtModel = {
    "~kind": "model",
    "~contract": contract,
    "~api": modelApi,
    "~fn": fn,

    "~id": getEntityId(),

    $instances,

    create: createInstance,
    delete: deleteInstance,
  } as unknown as Model<T, Api>;

  const builtLens = lens(builtModel);

  return Object.assign(builtModel, {
    lens: builtLens,

    static(data: ContractData<T>) {
      return createStaticApi(contract, data);
    },
  });
}
