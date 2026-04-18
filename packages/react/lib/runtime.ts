import {
  is as modelIs,
  type Contract,
  type ContractData,
  type Lens,
  type Model,
  type Ref,
  withInstanceContext,
} from "@effector-kit/models";
import {
  allSettled,
  type Event,
  is as effectorIs,
  launch,
  scopeBind,
  type Scope,
  type Store,
} from "effector";
import type {
  ComponentCreateOptions,
  ComponentViewEntity,
  ReactModelEntity,
  ReactModelHandle,
} from "./types";

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
      try {
        return store.getState();
      } catch {
        if (key in instance) {
          return instance[key];
        }

        const field = store["~field"];

        if (typeof field === "string" && field in instance) {
          return instance[field];
        }

        return undefined;
      }
    },
    scope,
  );
}

function bindUnit(
  lens: Record<string, unknown>,
  key: string,
  unit: unknown,
  scope?: Scope,
) {
  const target = getLensTarget(lens, key);

  if (typeof target === "function") {
    return scope ? scopeBind(target, { scope }) : target;
  }

  if (typeof unit === "function") {
    return scope ? scopeBind(unit, { scope }) : unit;
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
    if (effectorIs.store(element)) {
      stores.push(element as Store<unknown>);
      continue;
    }

    if (modelIs.model(element)) {
      stores.push(...collectGraphStores(element, seenModels, seenRefs));
      continue;
    }

    if (!isRef(element)) {
      continue;
    }

    if (!seenRefs.has(element["~id"])) {
      seenRefs.add(element["~id"]);
      stores.push(element.$ids as unknown as Store<unknown>);
    }

    const target = element["~target"];

    if (modelIs.model(target)) {
      stores.push(...collectGraphStores(target, seenModels, seenRefs));
      continue;
    }

    if (!modelIs.union(target)) {
      continue;
    }

    for (const nestedModel of Object.values(target.models)) {
      stores.push(...collectGraphStores(nestedModel, seenModels, seenRefs));
    }
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

    if (modelIs.model(element)) {
      const childInstances = resolveChildInstances(
        model,
        instance,
        element,
        scope,
      );
      result[key] = Object.entries(childInstances).map(([childId, childData]) =>
        resolveEntity(element, childId, childData, scope),
      );
      continue;
    }

    if (isRef(element)) {
      result[key] = resolveRefValue(model, instance, element, scope);
      continue;
    }

    if (effectorIs.store(element)) {
      result[key] = readFieldValue(model, instance, key, element, scope);
      continue;
    }

    if (effectorIs.event(element) || effectorIs.effect(element)) {
      result[key] = bindUnit(lens, key, element, scope);
    }
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
): Promise<void> {
  await callUnit(
    handle.model.create,
    createModelPayload(handle.model, handle),
    handle.scope,
  );

  const mountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ) as unknown as Record<string, unknown>;
  const mountedUnit = getLensTarget(mountedTarget, "$$mounted");

  if (typeof mountedUnit === "function") {
    await callUnit(mountedUnit, undefined, handle.scope);
  }
}

export function launchManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
): void {
  const instances = handle.scope
    ? handle.scope.getState(handle.model.$instances)
    : handle.model.$instances.getState();

  if (!instances[handle.id]) {
    // @ts-expect-error
    launch({
      target: handle.model.create,
      params: createModelPayload(handle.model, handle),
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
      params: undefined,
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

export { isLens };
