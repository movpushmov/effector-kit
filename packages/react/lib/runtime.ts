import {
  child,
  getContext,
  is as modelIs,
  type Contract,
  type ContractData,
  type Lens,
  type Model,
  type ModelApi,
  type Ref,
  withInstanceContext,
} from "@effector-kit/models";
import {
  allSettled,
  createEffect,
  createStore,
  type Event,
  is as effectorIs,
  launch,
  sample,
  scopeBind,
  type Scope,
  type Store,
  type StoreWritable,
} from "effector";
import type {
  ComponentCreateOptions,
  CreatedModel,
  CreatedModelApi,
  CreatedModelMeta,
  ComponentViewEntity,
  ReactModelEntity,
  ReactModelHandle,
} from "./types";
import { reactCreatedModelMeta } from "./meta";

let reactModelId = 0;
const graphUpdatesCache = new WeakMap<
  AnyModel,
  ReadonlyArray<Event<unknown>>
>();
type AnyModel = Model<any, any>;
type InstanceData = Record<string, unknown>;
type InstancesMap = Record<string, InstanceData>;
type RefInstance = { id: string };
type UnionRefInstance = { key: string; id: string };
type EffectorStore = Store<unknown> & {
  "~field"?: string;
};
type CreatedDescriptor = CreatedModel<AnyModel>;
type MountedPayload = Record<string, unknown>;

function nextReactModelId() {
  reactModelId += 1;
  return `react-model-${reactModelId}`;
}

function capitalize(value: string) {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLens(value: unknown): value is Lens<Model<any, any>> {
  return isObject(value) && typeof value.getSource === "function";
}

function isRef(value: unknown): value is Ref<any> {
  return modelIs.ref(value);
}

function isCreatedModel(value: unknown): value is CreatedDescriptor {
  return (
    isObject(value) &&
    reactCreatedModelMeta in value &&
    isObject(value[reactCreatedModelMeta])
  );
}

function getCreatedModelMeta<T extends AnyModel>(
  value: CreatedModel<T>,
): CreatedModelMeta<T> {
  return value[reactCreatedModelMeta];
}

export function getCreatedModelHandle<T extends AnyModel>(
  value: CreatedModel<T>,
) {
  return getCreatedModelMeta(value).handle;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function isComponentInternalKey(key: string) {
  return key.startsWith("$$");
}

function callUnit<Unit extends { (payload?: any): any }>(
  unit: Unit,
  payload: unknown,
  scope?: Scope,
) {
  if (scope) {
    return allSettled(unit as any, {
      scope,
      params: payload,
    });
  }

  return Promise.resolve((unit as any)(payload));
}

function createInstanceLens<T extends AnyModel>(model: T, id: string) {
  return model.lens.where((entity: RefInstance) => entity.id === id);
}

function readFieldValue(
  model: AnyModel,
  instance: InstanceData,
  key: string,
  unit: unknown,
  scope?: Scope,
) {
  if (!effectorIs.store(unit)) {
    return undefined;
  }

  const store = unit as EffectorStore;

  return withInstanceContext(
    model,
    instance,
    () => {
      if (key in instance) {
        return instance[key];
      }

      const field = store["~field"];

      if (typeof field === "string" && field in instance) {
        return instance[field];
      }

      if (scope) {
        const scopedValue = scope.getState(store);

        if (scopedValue !== null) {
          return scopedValue;
        }
      }

      try {
        return store.getState();
      } catch {
        return undefined;
      }
    },
    scope,
  );
}

function bindUnit(
  lens: Record<string, unknown>,
  model: AnyModel,
  instance: InstanceData,
  key: string,
  unit: unknown,
  scope?: Scope,
) {
  if (typeof unit === "function") {
    const boundUnit = scope ? scopeBind(unit, { scope }) : unit;

    return (payload?: unknown) =>
      withInstanceContext(model, instance, () => boundUnit(payload), scope);
  }

  const target = getLensTarget(lens, key);

  if (typeof target === "function") {
    const boundTarget = scope ? scopeBind(target, { scope }) : target;

    return (payload?: unknown) =>
      withInstanceContext(
        model,
        instance,
        () => boundTarget(payload),
        scope,
      );
  }

  return undefined;
}

function getLensTarget(lens: Record<string, unknown>, key: string) {
  const entry = lens[key];

  if (!isObject(entry) || typeof entry.target !== "function") {
    return undefined;
  }

  return entry.target();
}

function resolveChildInstances(
  model: AnyModel,
  instance: InstanceData,
  childModel: AnyModel,
  scope?: Scope,
): InstancesMap {
  const instances = withInstanceContext(
    model,
    instance,
    () => childModel.$instances.getState(),
    scope,
  );

  return (instances ?? {}) as InstancesMap;
}

function resolveRefValue(
  model: AnyModel,
  instance: InstanceData,
  refModel: Ref<any>,
  scope?: Scope,
): unknown[] {
  const ids = withInstanceContext(
    model,
    instance,
    () => refModel.$ids.getState(),
    scope,
  ) as Array<string> | Array<UnionRefInstance>;
  const target = refModel["~target"];

  if (modelIs.model(target)) {
    const instances = scope
      ? scope.getState(target.$instances)
      : target.$instances.getState();

    return (ids as string[])
      .map((id) => {
        const data = instances[id];

        if (!data) {
          return null;
        }

        return resolveEntity(target, id, data, scope);
      })
      .filter(isDefined);
  }

  if (modelIs.union(target)) {
    return (ids as UnionRefInstance[])
      .map((item) => {
        const variantModel = target.models[item.key];

        if (!variantModel) {
          return null;
        }

        const instances = scope
          ? scope.getState(variantModel.$instances)
          : variantModel.$instances.getState();
        const data = instances[item.id];

        if (!data) {
          return null;
        }

        return {
          ...resolveEntity(variantModel, item.id, data),
          variant: item.key,
        };
      })
      .filter(isDefined);
  }

  return [];
}

function collectGraphStoresFromElement(
  element: unknown,
  seenModels: Set<string>,
  seenRefs: Set<string>,
): Store<unknown>[] {
  if (effectorIs.store(element)) {
    return [element as Store<unknown>];
  }

  if (isCreatedModel(element)) {
    return collectGraphStores(
      getCreatedModelMeta(element).ownedModel,
      seenModels,
      seenRefs,
    );
  }

  if (modelIs.model(element)) {
    return collectGraphStores(element, seenModels, seenRefs);
  }

  if (isRef(element)) {
    const stores: Store<unknown>[] = [];

    if (!seenRefs.has(element["~id"])) {
      seenRefs.add(element["~id"]);
      stores.push(element.$ids as unknown as Store<unknown>);
    }

    const target = element["~target"];

    if (modelIs.model(target)) {
      stores.push(...collectGraphStores(target, seenModels, seenRefs));
    } else if (modelIs.union(target)) {
      for (const nestedModel of Object.values(target.models)) {
        stores.push(...collectGraphStores(nestedModel, seenModels, seenRefs));
      }
    }

    return stores;
  }

  if (isObject(element)) {
    return Object.values(element).flatMap((value) =>
      collectGraphStoresFromElement(value, seenModels, seenRefs),
    );
  }

  return [];
}

export function collectGraphStores(
  model: AnyModel,
  seenModels: Set<string> = new Set<string>(),
  seenRefs: Set<string> = new Set<string>(),
): Store<unknown>[] {
  const stores: Array<Store<unknown>> = [model.$instances];

  if (seenModels.has(model["~id"])) {
    return stores;
  }

  seenModels.add(model["~id"]);

  for (const element of Object.values(model["~api"])) {
    stores.push(...collectGraphStoresFromElement(element, seenModels, seenRefs));
  }

  return Array.from(new Set(stores));
}

export function collectGraphUpdates(model: AnyModel): Event<unknown>[] {
  const cached = graphUpdatesCache.get(model) as unknown as Event<unknown>[];

  if (cached) {
    return cached;
  }

  const updates = collectGraphStores(model).map((store) => store.updates);
  graphUpdatesCache.set(model, updates);

  return updates;
}

function getCurrentOwnerContext() {
  const current = getContext().current;

  return current?.owner ?? current;
}

function createOwnedHandle<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
): ReactModelHandle<T> {
  return {
    "~kind": "react-model",
    id: meta.ownedId,
    model: meta.ownedModel,
    data: meta.handle.data,
    scope: meta.handle.scope,
  };
}

function getOwnedInstancesForContext<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  owner: NonNullable<ReturnType<typeof getCurrentOwnerContext>>,
) {
  return withInstanceContext(
    owner.model,
    owner.instance,
    () => meta.ownedModel.$instances.getState(),
    owner.scope,
  ) as InstancesMap;
}

function ensureCreatedModelForContext<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  owner: NonNullable<ReturnType<typeof getCurrentOwnerContext>>,
) {
  const existing = getOwnedInstancesForContext(meta, owner)[meta.ownedId];

  if (existing) {
    return existing;
  }

  const create = owner.scope
    ? scopeBind(meta.ownedModel.create, { scope: owner.scope })
    : meta.ownedModel.create;

  withInstanceContext(
    owner.model,
    owner.instance,
    () => {
      create(createModelPayload(meta.ownedModel, createOwnedHandle(meta)));
    },
    owner.scope,
  );

  return getOwnedInstancesForContext(meta, owner)[meta.ownedId] ?? null;
}

function resolveCreatedModelValue<T extends AnyModel>(
  parentModel: AnyModel,
  parentInstance: InstanceData,
  createdModel: CreatedModel<T>,
  scope?: Scope,
) {
  const meta = getCreatedModelMeta(createdModel);
  const owner = {
    model: parentModel,
    instance: parentInstance,
    scope,
  };
  const instance = ensureCreatedModelForContext(meta, owner);

  if (!instance) {
    return null;
  }

  return resolveEntity(meta.ownedModel, meta.ownedId, instance, scope);
}

function resolveElementValue(
  lens: Record<string, unknown>,
  model: AnyModel,
  instance: InstanceData,
  key: string,
  element: unknown,
  scope?: Scope,
): unknown {
  if (isCreatedModel(element)) {
    return resolveCreatedModelValue(model, instance, element, scope);
  }

  if (modelIs.model(element)) {
    const childInstances = resolveChildInstances(model, instance, element, scope);

    return Object.entries(childInstances).map(([childId, childData]) =>
      resolveEntity(element, childId, childData, scope),
    );
  }

  if (isRef(element)) {
    return resolveRefValue(model, instance, element, scope);
  }

  if (effectorIs.store(element)) {
    return readFieldValue(model, instance, key, element, scope);
  }

  if (effectorIs.event(element) || effectorIs.effect(element)) {
    return bindUnit(lens, model, instance, key, element, scope);
  }

  if (isObject(element)) {
    const result: Record<string, unknown> = {};

    for (const [nestedKey, nestedElement] of Object.entries(element)) {
      if (isComponentInternalKey(nestedKey)) {
        continue;
      }

      result[nestedKey] = resolveElementValue(
        lens,
        model,
        instance,
        nestedKey,
        nestedElement,
        scope,
      );
    }

    return result;
  }

  return undefined;
}

export function resolveEntity<T extends Model<any, any>>(
  model: T,
  id: string,
  instance: InstanceData,
  scope?: Scope,
): ReactModelEntity<T> {
  const lens = createInstanceLens(model, id);
  const result: Record<string, unknown> = { id };

  for (const [key, element] of Object.entries(model["~api"])) {
    if (isComponentInternalKey(key)) {
      continue;
    }

    result[key] = resolveElementValue(lens, model, instance, key, element, scope);
  }

  return result as ReactModelEntity<T>;
}

export function resolveLensEntities<T extends Model<any, any>>(
  model: T,
  lens: Lens<T>,
  scope?: Scope,
): ReactModelEntity<T>[] {
  const source = scope ? scope.getState(model.$instances) : undefined;
  const instances = (
    lens as {
      getSource(source?: InstancesMap): InstancesMap;
    }
  ).getSource(source as InstancesMap | undefined);

  return Object.entries(instances).map(([id, instance]) =>
    resolveEntity(model, id, instance, scope),
  );
}

export function resolveHandleEntity<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  scope?: Scope,
): ReactModelEntity<T> | null {
  const activeScope = handle.scope ?? scope;
  const instances = activeScope
    ? activeScope.getState(handle.model.$instances)
    : handle.model.$instances.getState();
  const instance = instances[handle.id];

  if (!instance) {
    return null;
  }

  return resolveEntity(handle.model, handle.id, instance, activeScope);
}

export function getDefaultData<T extends Contract<any>>(contract: T) {
  const data: Record<string, unknown> = {};

  for (const [key, element] of Object.entries(contract.shape) as Array<
    [string, T["shape"][keyof T["shape"]]]
  >) {
    if (element["~kind"] !== "store") {
      continue;
    }

    data[key] = element.defaultValue;
  }

  return data as ContractData<T>;
}

export function createReactModelHandle<T extends Model<any, any>>(
  model: T,
  data?: Partial<ContractData<T["~contract"]>>,
  options?: ComponentCreateOptions,
): ReactModelHandle<T> {
  return {
    "~kind": "react-model",
    id: options?.id ?? nextReactModelId(),
    model,
    data: data ?? {},
    scope: options?.scope,
  };
}

function getCreatedStoreDefault<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  key: string,
  unit: Store<unknown>,
) {
  const contractElement = meta.ownedModel["~contract"].shape[key];

  if (contractElement?.["~kind"] === "store") {
    return meta.handle.data[key as keyof typeof meta.handle.data] ?? contractElement.defaultValue;
  }

  try {
    return unit.getState();
  } catch {
    return undefined;
  }
}

function createCreatedUnitTarget<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  key: string,
) {
  return getLensTarget(
    createInstanceLens(meta.ownedModel, meta.ownedId) as unknown as Record<
      string,
      unknown
    >,
    key,
  );
}

function createCreatedEventUnit<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  key: string,
) {
  const target = createCreatedUnitTarget(meta, key);

  if (typeof target !== "function") {
    return undefined;
  }

  return createEffect<any, void>((payload) => {
    const owner = getCurrentOwnerContext();

    if (!owner) {
      return;
    }

    const boundTarget = owner.scope ? scopeBind(target, { scope: owner.scope }) : target;

    ensureCreatedModelForContext(meta, owner);
    withInstanceContext(
      owner.model,
      owner.instance,
      () => {
        boundTarget(payload);
      },
      owner.scope,
    );
  });
}

function createCreatedStoreUnit<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  key: string,
  unit: Store<unknown>,
) {
  const defaultValue = getCreatedStoreDefault(meta, key, unit);
  const proxy = createStore(defaultValue, {
    serialize: "ignore",
  }) as StoreWritable<unknown>;

  Object.defineProperty((proxy as any).graphite.meta.stateRef, "current", {
    get() {
      const owner = getCurrentOwnerContext();

      if (!owner) {
        return defaultValue;
      }

      const instance = ensureCreatedModelForContext(meta, owner);

      if (!instance) {
        return defaultValue;
      }

      return withInstanceContext(
        meta.ownedModel,
        instance,
        () => unit.getState(),
        owner.scope,
      );
    },
  });

  const contractElement = meta.ownedModel["~contract"].shape[key];
  const target = createCreatedUnitTarget(meta, key);

  if (contractElement?.["~kind"] === "store" && typeof target === "function") {
    const syncStore = createEffect<unknown, void>((value) => {
      const owner = getCurrentOwnerContext();

      if (!owner) {
        return;
      }

      const boundTarget = owner.scope
        ? scopeBind(target, { scope: owner.scope })
        : target;

      ensureCreatedModelForContext(meta, owner);
      withInstanceContext(
        owner.model,
        owner.instance,
        () => {
          boundTarget(value);
        },
        owner.scope,
      );
    });

    sample({
      clock: proxy.updates,
      target: syncStore,
    });
  }

  return proxy;
}

function createCreatedModelApi<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  api: ModelApi,
): CreatedModelApi<T["~api"]> {
  const result: Record<string, unknown> = {};

  for (const [key, element] of Object.entries(api)) {
    if (isComponentInternalKey(key)) {
      continue;
    }

    if (effectorIs.store(element)) {
      result[key] = createCreatedStoreUnit(meta, key, element);
      continue;
    }

    if (effectorIs.event(element) || effectorIs.effect(element)) {
      result[key] = createCreatedEventUnit(meta, key) ?? element;
      continue;
    }

    if (
      isObject(element) &&
      !modelIs.model(element) &&
      !isRef(element) &&
      !isCreatedModel(element)
    ) {
      result[key] = createCreatedModelApi(meta, element as ModelApi);
      continue;
    }

    result[key] = element;
  }

  return result as CreatedModelApi<T["~api"]>;
}

export function createCreatedModel<T extends AnyModel>(
  model: T,
  data?: Partial<ContractData<T["~contract"]>>,
  options?: ComponentCreateOptions,
): CreatedModel<T> {
  const handle = createReactModelHandle(model, data, options);
  const meta: CreatedModelMeta<T> = {
    handle,
    ownedModel: child(model),
    ownedId: handle.id,
  };
  const created = createCreatedModelApi(meta, model["~api"]) as CreatedModel<T>;

  Object.defineProperty(created, reactCreatedModelMeta, {
    value: meta,
    enumerable: false,
  });

  return created;
}

export function isReactModelHandle(
  value: unknown,
): value is ReactModelHandle<any> {
  return isObject(value) && value["~kind"] === "react-model";
}

export function createModelPayload<T extends Model<any, any>>(
  model: T,
  handle: ReactModelHandle<T>,
): { id: string; data: ContractData<T["~contract"]> } {
  return {
    id: handle.id,
    data: {
      ...getDefaultData(model["~contract"]),
      ...handle.data,
    },
  };
}

export async function mountManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  mounted: MountedPayload = {},
): Promise<void> {
  const payload = createModelPayload(handle.model, handle);

  await callUnit(
    handle.model.create,
    payload,
    handle.scope,
  );

  const mountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ) as unknown as Record<string, unknown>;
  const mountedUnit = getLensTarget(mountedTarget, "$$mounted");

  if (typeof mountedUnit === "function") {
    await callUnit(mountedUnit, mounted, handle.scope);
  }
}

export function launchManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  mounted: MountedPayload = {},
): void {
  const payload = createModelPayload(handle.model, handle);
  const instances = handle.scope
    ? handle.scope.getState(handle.model.$instances)
    : handle.model.$instances.getState();

  if (!instances[handle.id]) {
    // @ts-expect-error
    launch({
      target: handle.model.create,
      params: payload,
      scope: handle.scope,
    });
  }

  const mountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ) as unknown as Record<string, unknown>;
  const mountedUnit = getLensTarget(mountedTarget, "$$mounted");

  if (typeof mountedUnit === "function") {
    // @ts-expect-error
    launch({
      target: mountedUnit,
      params: mounted,
      scope: handle.scope,
    });
  }
}

export async function unmountManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
): Promise<void> {
  const unmountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ) as unknown as Record<string, unknown>;
  const unmountedUnit = getLensTarget(unmountedTarget, "$$unmounted");

  if (typeof unmountedUnit === "function") {
    await callUnit(unmountedUnit, undefined, handle.scope);
  }

  await callUnit(handle.model.delete, handle.id, handle.scope);
}

export function toViewEntity<T extends Model<any, any>>(
  entity: ReactModelEntity<T>,
): ComponentViewEntity<T> {
  return transformToView(entity) as ComponentViewEntity<T>;
}

function transformToView(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(transformToView);
  }

  if (!isObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "function" && key !== "id") {
      result[`on${capitalize(key)}`] = entry;
      continue;
    }

    result[key] = transformToView(entry);
  }

  return result;
}

export { isLens, isCreatedModel };
