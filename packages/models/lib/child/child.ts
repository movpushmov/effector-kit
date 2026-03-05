import { createStore } from "effector";
import { model, type Instances, type Model } from "../models";
import type { Contract } from "../contracts";
import { modifyChildStore } from "../runtime";

export function child<
  T extends Model<any, any>,
  ModelContract extends Contract<any> = T extends Model<infer C, any>
    ? C
    : never,
>(inputModel: T): T {
  const $instances = createStore<Instances<ModelContract>>({});
  modifyChildStore(inputModel, $instances);

  return model({
    instances: $instances,
    fn: inputModel["~fn"],
    contract: inputModel["~contract"],
  }) as T;
}
