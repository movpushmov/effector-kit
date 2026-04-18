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

function createInstanceLens<T extends Model<any, any>>(model: T, id: string) {
  return model.lens.where((entity) => entity.id === id);
}

function readFieldValue(
  model: Model<any, any>,
  instance: Record<string, any>,
  key: string,
  unit: any,
  scope?: Scope,
) {
  if (!effectorIs.store(unit)) {
    return undefined;
  }

  return withInstanceContext(model, instance, () => {
    try {
      return unit.getState();
    } catch {
      if (key in instance) {
        return instance[key];
      }

      const field = unit?.["~field"];

      if (typeof field === "string" && field in instance) {
        return instance[field];
      }

      return undefined;
    }
  }, scope);
}

function bindUnit(lens: any, key: string, unit: any, scope?: Scope) {
  const target = lens?.[key]?.target?.();

  if (typeof target === "function") {
    return scope ? scopeBind(target, { scope }) : target;
  }

  if (typeof unit === "function") {
    return scope ? scopeBind(unit, { scope }) : unit;
  }

  return undefined;
}

function resolveChildInstances(
  model: Model<any, any>,
  instance: Record<string, any>,
  childModel: Model<any, any>,
  scope?: Scope,
): Record<string, any> {
  return withInstanceContext(
    model,
    instance,
    () => childModel.$instances.getState(),
    scope,
  );
}

function resolveRefValue(
  model: Model<any, any>,
  instance: Record<string, any>,
  refModel: Ref<any>,
  scope?: Scope,
): unknown[] {
  const ids = withInstanceContext(
    model,
    instance,
    () => refModel.$ids.getState(),
    scope,
  );
  const target = refModel["~target"];

  if (modelIs.model(target)) {
    const instances = scope ? scope.getState(target.$instances) : target.$instances.getState();

    return ids
      .map((id: string) => {
        const data = instances[id];

        if (!data) {
          return null;
        }

        return resolveEntity(target, id, data);
      })
      .filter(Boolean);
  }

  if (modelIs.union(target)) {
    return ids
      .map((item: { key: string; id: string }) => {
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
      .filter(Boolean);
  }

  return [];
}

export function collectGraphStores(
  model: Model<any, any>,
  seenModels = new Set<string>(),
  seenRefs = new Set<string>(),
) {
  const stores: Store<any>[] = [model.$instances];

  if (seenModels.has(model["~id"])) {
    return stores;
  }

  seenModels.add(model["~id"]);

  for (const element of Object.values(model["~api"])) {
    if (effectorIs.store(element)) {
      stores.push(element as Store<any>);
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
      stores.push(element.$ids as unknown as Store<any>);
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

export function resolveEntity<T extends Model<any, any>>(
  model: T,
  id: string,
  instance: Record<string, any>,
  scope?: Scope,
): ReactModelEntity<T> {
  const lens = createInstanceLens(model, id);
  const result: Record<string, unknown> = { id };

  for (const [key, element] of Object.entries(model["~api"])) {
    if (isComponentInternalKey(key)) {
      continue;
    }

    if (modelIs.model(element)) {
      const childInstances = resolveChildInstances(model, instance, element, scope);
      result[key] = Object.entries(childInstances).map(([childId, childData]) =>
        resolveEntity(element, childId, childData as Record<string, any>, scope),
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
) {
  const source = scope ? scope.getState(model.$instances) : undefined;
  const instances = (lens as any).getSource(source);

  return Object.entries(instances).map(([id, instance]) =>
    resolveEntity(model, id, instance as Record<string, any>, scope),
  );
}

export function resolveHandleEntity<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  scope?: Scope,
) {
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

  for (const [key, element] of Object.entries(contract.shape)) {
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
) {
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
) {
  await callUnit(
    handle.model.create,
    createModelPayload(handle.model, handle),
    handle.scope,
  );

  const mountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ).$$mounted?.target?.();

  if (typeof mountedTarget === "function") {
    await callUnit(mountedTarget, undefined, handle.scope);
  }
}

export function launchManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
) {
  const instances = handle.scope
    ? handle.scope.getState(handle.model.$instances)
    : handle.model.$instances.getState();

  if (!instances[handle.id]) {
    launch({
      target: handle.model.create,
      params: createModelPayload(handle.model, handle),
      scope: handle.scope,
    });
  }

  const mountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ).$$mounted?.target?.();

  if (typeof mountedTarget === "function") {
    launch({
      target: mountedTarget,
      params: undefined,
      scope: handle.scope,
    });
  }
}

export async function unmountManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
) {
  const unmountedTarget = createInstanceLens(
    handle.model,
    handle.id,
  ).$$unmounted?.target?.();

  if (typeof unmountedTarget === "function") {
    await callUnit(unmountedTarget, undefined, handle.scope);
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
