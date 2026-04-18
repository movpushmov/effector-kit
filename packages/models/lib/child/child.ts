import { createEvent, createStore, sample } from "effector";
import { model, type Instances, type Model } from "../models";
import type { Contract } from "../contracts";
import { getContext, modifyChildStore } from "../runtime";

export function child<
  T extends Model<any, any>,
  ModelContract extends Contract<any> = T extends Model<infer C, any>
    ? C
    : never,
>(inputModel: T): T {
  const $instances = createStore<Instances<ModelContract>>({});

  const childModel = model({
    instances: $instances,
    fn: inputModel["~fn"],
    contract: inputModel["~contract"],
  }) as T;

  modifyChildStore(childModel, $instances);

  const createInContext = createEvent<Parameters<typeof childModel.create>[0]>();
  const deleteInContext = createEvent<Parameters<typeof childModel.delete>[0]>();
  const internalCreate = childModel.create;
  const internalDelete = childModel.delete;

  sample({
    clock: createInContext,
    filter: () => Boolean(getContext().current),
    target: internalCreate,
  });

  sample({
    clock: deleteInContext,
    filter: () => Boolean(getContext().current),
    target: internalDelete,
  });

  return Object.assign(childModel, {
    create: createInContext,
    delete: deleteInContext,
  });
}
