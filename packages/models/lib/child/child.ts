import { createEvent, createStore, sample } from "effector";
import { model, type Instances, type Model } from "../models";
import type { Contract } from "../contracts";
import {
  getContext,
  getDeclarationModelId,
  modifyChildStore,
} from "../runtime";

export function child<
  T extends Model<any, any>,
  ModelContract extends Contract<any> = T extends Model<infer C, any>
    ? C
    : never,
>(inputModel: T): T {
  const ownerModelId = getDeclarationModelId();
  const $instances = createStore<Instances<ModelContract>>({});

  const childModel = model({
    instances: $instances,
    fn: inputModel["~fn"],
    contract: inputModel["~contract"],
  }) as T;

  modifyChildStore(childModel, $instances, ownerModelId);

  if (ownerModelId) {
    (childModel.lens as any)["~setContextModelId"]?.(ownerModelId);
  }

  type CreateParams = NonNullable<Parameters<typeof childModel.create>[0]>;
  type DeleteParams = NonNullable<Parameters<typeof childModel.delete>[0]>;

  const createInContext = createEvent<CreateParams>();
  const deleteInContext = createEvent<DeleteParams>();
  const internalCreate = childModel.create;
  const internalDelete = childModel.delete;

  function hasValidOwnerContext(): boolean {
    const current = getContext().current;

    return Boolean(current && ownerModelId && current.model["~id"] === ownerModelId);
  }

  sample({
    clock: createInContext,
    filter: hasValidOwnerContext,
    fn: (payload) => payload,
    target: internalCreate,
  });

  sample({
    clock: deleteInContext,
    filter: hasValidOwnerContext,
    fn: (payload) => payload,
    target: internalDelete,
  });

  return Object.assign(childModel, {
    create: createInContext,
    delete: deleteInContext,
  });
}
