import { createEvent, createStore, sample, type StoreWritable } from "effector";
import type { Contract } from "../contracts";
import type {
  ContractApi,
  ContractData,
  CreateInstancePayload,
  Instances,
  Model,
  ModelApi,
} from "./types";
import { modifyDeclarations } from "../runtime";
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
  const sid = createStore(null).sid;
  const $instances =
    instances ?? createStore<Instances<T>>({}, { sid: `$instances/${sid}` });

  const createInstance = createEvent<CreateInstancePayload<T>>();
  const deleteInstance = createEvent<string>();

  const { result: modelApi } = modifyDeclarations(() => {
    const api = createApi(contract);

    return fn(api);
  });

  sample({
    clock: createInstance,
    source: $instances,
    fn: (instances, { id, data }) => ({
      ...instances,
      [id]: {
        ...data,
      },
    }),
    target: $instances,
  });

  sample({
    clock: deleteInstance,
    source: $instances,
    fn: (instances, id) => {
      const { [id]: _, ...rest } = instances;
      return rest;
    },
    target: $instances,
  })

  const builtModel = {
    "~kind": "model",
    "~contract": contract,
    "~api": modelApi,
    "~fn": fn,

    // TODO: support effector babel plugin!
    "~id": sid,

    $instances,

    create: createInstance,
    delete: deleteInstance,
  };

  return Object.assign(builtModel, {
    lens: lens(builtModel as unknown as Model<T, Api>),

    static(data: ContractData<T>) {
      return createStaticApi(contract, data);
    },
  }) as unknown as Model<T, Api>;
}
