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
  type SingleLens,
  withInstanceContext,
} from "@effector-kit/models";
import {
  allSettled,
  createEvent,
  createEffect,
  createStore,
  type Event,
  is as effectorIs,
  launch,
  sample,
  scopeBind,
  type Node,
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
let reactLaunchPageId = 0;
const resolvedViewEntityMarker = Symbol("resolvedViewEntity");
const graphUpdatesCache = new WeakMap<
  AnyModel,
  ReadonlyArray<Event<unknown>>
>();
const launchPageRefsCache = new WeakMap<AnyModel, LaunchPageRefDescriptor[]>();
type AnyModel = Model<any, any>;
type InstanceData = Record<string, unknown>;
type InstancesMap = Record<string, InstanceData>;
type AliasesMap = Record<string, string>;
type UnionRefInstance = { key: string; id: string };
type EffectorStore = Store<unknown> & {
  "~field"?: string;
};
type StateRefStep = {
  type?: string;
  fn?: ((value: unknown) => unknown) | undefined;
  from?: StateRefShape;
};
type StateRefShape = {
  id?: string;
  current: unknown;
  initial?: unknown;
  type?: string;
  before?: StateRefStep[];
};
type LaunchPageRefDescriptor = {
  ids: string[];
  ref: StateRefShape;
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

function normalizeViewKey(key: string) {
  return key.startsWith("$") ? key.slice(1) : key;
}

function toViewHandlerName(key: string) {
  return `on${capitalize(normalizeViewKey(key))}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTraversableApiObject(value: unknown): value is Record<string, unknown> {
  return (
    isObject(value) &&
    !effectorIs.store(value) &&
    !modelIs.model(value) &&
    !isRef(value) &&
    !isCreatedModel(value)
  );
}

function isLens(value: unknown): value is Lens<Model<any, any>> {
  return isObject(value) && typeof value.getSource === "function";
}

function isSingleLens<T extends Model<any, any>>(
  value: unknown,
): value is SingleLens<T> {
  return (
    isObject(value) &&
    typeof value.getSource === "function" &&
    value["~single"] === true
  );
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
): ReactModelHandle<T> {
  return getCreatedModelMeta(value).handle;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function hasDerivedStateRef(store: Store<unknown>): boolean {
  const stateRef = (store as Store<unknown> & {
    graphite?: {
      meta?: {
        stateRef?: {
          before?: unknown[];
        };
      };
    };
  }).graphite?.meta?.stateRef;

  return Array.isArray(stateRef?.before) && stateRef.before.length > 0;
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

function callUnitSync<Unit extends { (payload?: any): any }>(
  unit: Unit,
  payload: unknown,
  scope?: Scope,
) {
  const page = getScopedLaunchPageFromContext();

  if (scope) {
    launch({
      target: unit as unknown as UnitTargetable,
      params: payload,
      scope,
      page: (page ?? null) as any,
    } as any);
    return;
  }

  launch({
    target: unit as unknown as UnitTargetable,
    params: payload,
    page: (page ?? null) as any,
  } as any);
}

type UnitTargetable = Event<unknown> | Store<unknown>;

function launchUnit(unit: unknown, payload: unknown, scope?: Scope) {
  const page = getScopedLaunchPageFromContext();

  if (scope) {
    launch({
      target: unit as UnitTargetable,
      params: payload,
      scope,
      page: (page ?? null) as any,
    } as any);
    return;
  }

  launch({
    target: unit as UnitTargetable,
    params: payload,
    page: (page ?? null) as any,
  } as any);
}

function isStateRefShape(value: unknown): value is StateRefShape {
  return (
    isObject(value) &&
    "current" in value &&
    (typeof value.id === "string" || Array.isArray(value.before))
  );
}

function evaluateStateRefValue(
  stateRef: StateRefShape,
  overrides?: Map<string, unknown>,
  seen: Set<StateRefShape> = new Set<StateRefShape>(),
): unknown {
  const overrideValue =
    typeof stateRef.id === "string" && overrides?.has(stateRef.id)
      ? overrides.get(stateRef.id)
      : undefined;

  if (seen.has(stateRef)) {
    return overrideValue ?? stateRef.current;
  }

  seen.add(stateRef);

  if (stateRef.type === "list") {
    if (!Array.isArray(stateRef.before) || stateRef.before.length === 0) {
      const fallback = overrideValue ?? stateRef.current;

      return Array.isArray(fallback) ? fallback : [];
    }

    return stateRef.before.map((step) =>
      step.from ? evaluateStateRefValue(step.from, overrides, seen) : undefined,
    );
  }

  if (!Array.isArray(stateRef.before) || stateRef.before.length === 0) {
    return overrideValue ?? stateRef.current;
  }

  if (stateRef.type === "shape") {
    const template =
      stateRef.current && typeof stateRef.current === "object"
        ? (stateRef.current as Record<string, unknown>)
        : stateRef.initial && typeof stateRef.initial === "object"
          ? (stateRef.initial as Record<string, unknown>)
          : {};
    const keys = Object.keys(template);

    return Object.fromEntries(
      stateRef.before.map((step, index) => [
        keys[index] ?? String(index),
        step.from ? evaluateStateRefValue(step.from, overrides, seen) : undefined,
      ]),
    );
  }

  if (stateRef.before.length === 1) {
    const step = stateRef.before[0]!;
    const source = step.from
      ? evaluateStateRefValue(step.from, overrides, seen)
      : undefined;

    return step.fn ? step.fn(source) : source;
  }

  return stateRef.current;
}

function collectLaunchPageStateOverrides(
  model: AnyModel,
  instance: InstanceData,
  scope?: Scope,
): Map<string, unknown> {
  const overrides = new Map<string, unknown>();
  const scopeReg = (scope as
    | (Scope & { reg?: Record<string, { current: unknown }> })
    | undefined)?.reg;

  for (const store of collectGraphStores(model)) {
    const meta = (store as StoreWritable<unknown> & {
      graphite?: {
        meta?: {
          rootStateRefId?: string;
          stateRef?: StateRefShape;
        };
      };
    }).graphite?.meta;

    if (!meta?.stateRef) {
      continue;
    }

    const field = (store as EffectorStore)["~field"];
    const rootId = meta.rootStateRefId;
    const stateRefId =
      typeof meta.stateRef.id === "string" ? meta.stateRef.id : undefined;

    let hasValue = false;
    let value: unknown;

    if (typeof field === "string" && field in instance) {
      value = instance[field];
      hasValue = true;
    } else if (rootId && scopeReg?.[rootId]) {
      value = scopeReg[rootId]!.current;
      hasValue = true;
    } else if (stateRefId && scopeReg?.[stateRefId]) {
      value = scopeReg[stateRefId]!.current;
      hasValue = true;
    } else {
      try {
        value = withInstanceContext(
          model,
          instance,
          () => (scope ? scope.getState(store) : store.getState()),
          scope,
        );
        hasValue = true;
      } catch {
        hasValue = false;
      }
    }

    if (!hasValue) {
      continue;
    }

    if (rootId) {
      overrides.set(rootId, value);
    }

    if (stateRefId) {
      overrides.set(stateRefId, value);
    }
  }

  if (!scopeReg) {
    return overrides;
  }

  for (const [id, ref] of Object.entries(scopeReg)) {
    if (!overrides.has(id)) {
      overrides.set(id, ref.current);
    }
  }

  return overrides;
}

function collectRegionNodes(root: Node): Node[] {
  const visited = new Set<Node>();
  const nodes: Node[] = [];

  function visit(node: Node): void {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    nodes.push(node);

    for (const link of node.family.links) {
      visit(link);
    }
  }

  visit(root);

  return nodes;
}

function collectLaunchPageRefDescriptors(model: AnyModel): LaunchPageRefDescriptor[] {
  const cached = launchPageRefsCache.get(model);

  if (cached) {
    return cached;
  }

  const descriptors = new Map<
    string,
    {
      ids: Set<string>;
      ref: StateRefShape;
    }
  >();

  function rememberStateRef(ref: unknown, alias?: string): void {
    if (!isStateRefShape(ref) || typeof ref.id !== "string") {
      return;
    }

    const hasDerivedInputs =
      Array.isArray(ref.before) && ref.before.length > 0;

    if (!alias && !hasDerivedInputs) {
      return;
    }

    const existing = descriptors.get(ref.id) ?? {
      ids: new Set<string>(),
      ref,
    };

    existing.ids.add(ref.id);

    if (alias) {
      existing.ids.add(alias);
    }

    descriptors.set(ref.id, existing);

    if (!Array.isArray(ref.before)) {
      return;
    }

    for (const step of ref.before) {
      if (step.from) {
        rememberStateRef(step.from);
      }
    }
  }

  for (const store of collectGraphStores(model)) {
    const meta = (store as StoreWritable<unknown> & {
      graphite?: {
        meta?: {
          rootStateRefId?: string;
          stateRef?: StateRefShape;
        };
      };
    }).graphite?.meta;

    if (!meta?.stateRef) {
      continue;
    }

    rememberStateRef(meta.stateRef, meta.rootStateRefId);
  }

  const region = (model as AnyModel & { "~region"?: Node })["~region"];
  const regionNodes = region ? collectRegionNodes(region) : [];

  for (const node of regionNodes) {
    for (const step of node.seq) {
      const data = step.data;

      if (!isObject(data) || !("store" in data)) {
        continue;
      }

      rememberStateRef((data as { store?: unknown }).store);
    }
  }

  const collected = Array.from(descriptors.values(), ({ ids, ref }) => ({
    ids: Array.from(ids),
    ref,
  }));

  launchPageRefsCache.set(model, collected);

  return collected;
}

function createScopedLaunchPage(
  model: AnyModel,
  instance: InstanceData,
  scope?: Scope,
) {
  reactLaunchPageId += 1;

  const reg: Record<string, StateRefShape> = {};
  const overrides = collectLaunchPageStateOverrides(model, instance, scope);

  for (const { ids, ref } of collectLaunchPageRefDescriptors(model)) {
    const snapshot = Object.assign({}, ref, {
      current: evaluateStateRefValue(ref, overrides),
    });

    for (const id of ids) {
      reg[id] = snapshot;
    }
  }

  return {
    fullID: `react-launch-page-${reactLaunchPageId}`,
    parent: null,
    reg,
    "~modelsScopedPage": true,
  };
}

function getScopedLaunchPageFromContext() {
  const current = getContext().current;

  if (!current?.model || !current.instance) {
    return null;
  }

  return createScopedLaunchPage(
    current.model as AnyModel,
    current.instance as InstanceData,
    current.scope,
  );
}

function getModelInstance<T extends AnyModel>(
  model: T,
  id: string,
  scope?: Scope,
): InstanceData | undefined {
  const instances = scope
    ? scope.getState(model.$instances)
    : model.$instances.getState();
  const aliases = scope
    ? scope.getState(model.$aliases)
    : model.$aliases.getState();
  const resolvedId = resolveModelInstanceId(instances, aliases, id);

  return resolvedId
    ? (instances[resolvedId] as InstanceData | undefined)
    : undefined;
}

function hasOwn(source: InstancesMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function resolveModelInstanceId(
  instances: InstancesMap,
  aliases: AliasesMap,
  id: string,
): string | undefined {
  if (hasOwn(instances, id)) {
    return id;
  }

  const visited = new Set<string>();
  let current = aliases[id];

  while (current !== undefined && !visited.has(current)) {
    if (hasOwn(instances, current)) {
      return current;
    }

    visited.add(current);
    current = aliases[current];
  }

  return undefined;
}

function getApiElementByPath(api: ModelApi, path: string[]): unknown {
  let current: unknown = api;

  for (const segment of path) {
    if (!isObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function collectPreviewInstanceData(
  api: ModelApi,
  target: InstanceData,
): InstanceData {
  for (const [key, value] of Object.entries(api)) {
    if (isComponentInternalKey(key)) {
      continue;
    }

    if (effectorIs.store(value)) {
      const store = value as EffectorStore;
      const field = store["~field"];

      if (
        (store as StoreWritable<unknown>).targetable === true &&
        typeof field === "string" &&
        !(field in target)
      ) {
        try {
          target[field] = store.getState();
        } catch {
          target[field] = undefined;
        }
      }

      continue;
    }

    if (
      isObject(value) &&
      !modelIs.model(value) &&
      !isRef(value) &&
      !isCreatedModel(value)
    ) {
      collectPreviewInstanceData(value as ModelApi, target);
    }
  }

  return target;
}

function readFieldValue(
  model: AnyModel,
  instance: InstanceData,
  key: string,
  unit: unknown,
  scope?: Scope,
  useScopedState = true,
) {
  if (!effectorIs.store(unit)) {
    return undefined;
  }

  const store = unit as EffectorStore;
  const result = withInstanceContext(
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

      if (useScopedState && scope) {
        try {
          return scope.getState(store);
        } catch {
          return undefined;
        }
      }

      // Derived stores (combine/map) should be recomputed under the current
      // instance context when no scope is available.
      if (
        (store as StoreWritable<unknown>).targetable !== true ||
        hasDerivedStateRef(store)
      ) {
        try {
          return store.getState();
        } catch {
          return undefined;
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

  return result;
}

function bindUnit(
  model: AnyModel,
  instance: InstanceData,
  unit: unknown,
  scope?: Scope,
) {
  if (typeof unit === "function") {
    return (payload?: unknown) =>
      withInstanceContext(
        model,
        instance,
        () => {
          launchUnit(unit, payload, scope);
        },
        scope,
      );
  }

  return undefined;
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
    return (ids as string[])
      .map((id) => {
        const data = getModelInstance(target, id, scope);

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

        const data = getModelInstance(variantModel, item.id, scope);

        if (!data) {
          return null;
        }

        return {
          ...resolveEntity(variantModel, item.id, data, scope),
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
    return [
      ...collectGraphStores(
        getCreatedModelMeta(element).ownedModel,
        seenModels,
        seenRefs,
      ),
    ];
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

function collectCreatedModelChangeEventsFromElement(
  element: unknown,
  seenCreated: WeakSet<object> = new WeakSet<object>(),
): Event<unknown>[] {
  if (isCreatedModel(element)) {
    if (seenCreated.has(element as object)) {
      return [];
    }

    seenCreated.add(element as object);

    return [getCreatedModelMeta(element).changed as unknown as Event<unknown>];
  }

  if (isTraversableApiObject(element)) {
    return Object.values(element).flatMap((value) =>
      collectCreatedModelChangeEventsFromElement(value, seenCreated),
    );
  }

  return [];
}

function collectCreatedModelProxyUpdatesFromCreated(
  created: CreatedDescriptor,
): Event<unknown>[] {
  const updates: Event<unknown>[] = [
    getCreatedModelMeta(created).changed as unknown as Event<unknown>,
  ];

  function visit(value: unknown): void {
    if (effectorIs.store(value)) {
      updates.push((value as Store<unknown>).updates);
      return;
    }

    if (
      isObject(value) &&
      !modelIs.model(value) &&
      !isRef(value) &&
      !isCreatedModel(value)
    ) {
      for (const nestedValue of Object.values(value)) {
        visit(nestedValue);
      }
    }
  }

  for (const value of Object.values(created)) {
    visit(value);
  }

  return updates;
}

function collectCreatedModelProxyUpdatesFromElement(
  element: unknown,
  seenCreated: WeakSet<object> = new WeakSet<object>(),
): Event<unknown>[] {
  if (isCreatedModel(element)) {
    if (seenCreated.has(element as object)) {
      return [];
    }

    seenCreated.add(element as object);

    return collectCreatedModelProxyUpdatesFromCreated(element);
  }

  if (isTraversableApiObject(element)) {
    return Object.values(element).flatMap((value) =>
      collectCreatedModelProxyUpdatesFromElement(value, seenCreated),
    );
  }

  return [];
}

export function collectCreatedModelChangeEvents(
  model: AnyModel,
): Event<unknown>[] {
  return Object.values(model["~api"]).flatMap((element) =>
    collectCreatedModelChangeEventsFromElement(element),
  );
}

export function collectCreatedModelProxyUpdates(
  model: AnyModel,
): Event<unknown>[] {
  return Object.values(model["~api"]).flatMap((element) =>
    collectCreatedModelProxyUpdatesFromElement(element),
  );
}

export function collectGraphStores(
  model: AnyModel,
  seenModels: Set<string> = new Set<string>(),
  seenRefs: Set<string> = new Set<string>(),
): Store<unknown>[] {
  const stores: Array<Store<unknown>> = [model.$instances, model.$aliases];

  if (seenModels.has(model["~id"])) {
    return stores;
  }

  seenModels.add(model["~id"]);

  for (const element of Object.values(model["~api"])) {
    stores.push(
      ...collectGraphStoresFromElement(element, seenModels, seenRefs),
    );
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
  model: AnyModel,
  instance: InstanceData,
  key: string,
  element: unknown,
  scope?: Scope,
  useScopedState = true,
): unknown {
  if (isCreatedModel(element)) {
    return resolveCreatedModelValue(model, instance, element, scope);
  }

  if (modelIs.model(element)) {
    const childInstances = resolveChildInstances(
      model,
      instance,
      element,
      scope,
    );

    return Object.entries(childInstances).map(([childId, childData]) =>
      resolveEntity(element, childId, childData, scope),
    );
  }

  if (isRef(element)) {
    return resolveRefValue(model, instance, element, scope);
  }

  if (effectorIs.store(element)) {
    return readFieldValue(
      model,
      instance,
      key,
      element,
      scope,
      useScopedState,
    );
  }

  if (effectorIs.event(element) || effectorIs.effect(element)) {
    return bindUnit(model, instance, element, scope);
  }

  if (isObject(element)) {
    const result: Record<string, unknown> = {};

    for (const [nestedKey, nestedElement] of Object.entries(element)) {
      if (isComponentInternalKey(nestedKey)) {
        continue;
      }

      result[nestedKey] = resolveElementValue(
        model,
        instance,
        nestedKey,
        nestedElement,
        scope,
        useScopedState,
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
  useScopedState = true,
): ReactModelEntity<T> {
  const result: Record<string, unknown> = { id };

  for (const [key, element] of Object.entries(model["~api"])) {
    if (isComponentInternalKey(key)) {
      continue;
    }

    result[key] = resolveElementValue(
      model,
      instance,
      key,
      element,
      scope,
      useScopedState,
    );
  }

  const viewEntity = transformToView(result, true) as ReactModelEntity<T>;

  Object.defineProperty(viewEntity as object, resolvedViewEntityMarker, {
    value: true,
    enumerable: false,
  });

  return viewEntity;
}

export function resolveLensEntities<T extends Model<any, any>>(
  model: T,
  lens: Lens<T>,
  scope?: Scope,
): ReactModelEntity<T>[] {
  const source = scope
    ? {
        instances: scope.getState(model.$instances),
        aliases: scope.getState(model.$aliases),
      }
    : undefined;
  const instances = (
    lens as {
      getSource(
        source?:
          | InstancesMap
          | {
              instances: InstancesMap;
              aliases: AliasesMap;
            },
      ): InstancesMap;
    }
  ).getSource(source);

  return Object.entries(instances).map(([id, instance]) =>
    resolveEntity(model, id, instance, scope),
  );
}

export function resolveLensEntity<T extends Model<any, any>>(
  model: T,
  lens: SingleLens<T>,
  scope?: Scope,
): ReactModelEntity<T> | undefined {
  return resolveLensEntities(model, lens as unknown as Lens<T>, scope)[0] as
    | ReactModelEntity<T>
    | undefined;
}

export function resolveHandleEntity<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  scope?: Scope,
): ReactModelEntity<T> | null {
  const activeScope = handle.scope ?? scope;
  const instance = getModelInstance(handle.model, handle.id, activeScope);

  if (!instance) {
    return null;
  }

  return resolveEntity(handle.model, handle.id, instance, activeScope);
}

export function resolveHandleInstance<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  scope?: Scope,
): InstanceData | undefined {
  const activeScope = handle.scope ?? scope;

  return getModelInstance(handle.model, handle.id, activeScope);
}

export function resolveHandlePreviewEntity<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  scope?: Scope,
  previewInstance?: InstanceData,
): ReactModelEntity<T> {
  const activeScope = handle.scope ?? scope;
  const instance =
    getModelInstance(handle.model, handle.id, activeScope) ??
    previewInstance ??
    createHandlePreviewInstance(handle, activeScope);

  return resolveEntity(handle.model, handle.id, instance, activeScope, false);
}

export function createHandlePreviewInstance<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  scope?: Scope,
): InstanceData {
  const activeScope = handle.scope ?? scope;
  const existing = getModelInstance(handle.model, handle.id, activeScope);

  if (existing) {
    return existing;
  }

  const localStoreDefaults =
    (
      handle.model as T & {
        ["~localStoreDefaults"]?: InstanceData;
      }
    )["~localStoreDefaults"] ?? {};

  return collectPreviewInstanceData(handle.model["~api"], {
    ...localStoreDefaults,
    ...(createModelPayload(handle.model, handle).data as unknown as InstanceData),
  });
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
    return (
      meta.handle.data[key as keyof typeof meta.handle.data] ??
      contractElement.defaultValue
    );
  }

  try {
    return unit.getState();
  } catch {
    return undefined;
  }
}

type OwnerContext = NonNullable<ReturnType<typeof getCurrentOwnerContext>>;

function createCreatedEventUnit<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  path: string[],
) {
  const target = getApiElementByPath(meta.ownedModel["~api"], path);

  if (typeof target !== "function") {
    return undefined;
  }

  return createEffect<unknown, void>((payload) => {
    const owner = getCurrentOwnerContext();

    if (!owner) {
      return;
    }

    const instance = ensureCreatedModelForContext(meta, owner);

    if (!instance) {
      return;
    }

    withInstanceContext(
      meta.ownedModel,
      instance,
      () => {
        launchUnit(target, payload, owner.scope);
      },
      owner.scope,
    );
    launchUnit(meta.changed, undefined, owner.scope);
  });
}

function createCreatedStoreUnit<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  path: string[],
  unit: Store<unknown>,
) {
  const key = path[path.length - 1]!;
  const ownedStoreCandidate = getApiElementByPath(meta.ownedModel["~api"], path);
  const ownedStore = effectorIs.store(ownedStoreCandidate)
    ? (ownedStoreCandidate as Store<unknown>)
    : unit;
  const defaultValue = getCreatedStoreDefault(meta, key, unit);
  const proxy = createStore(defaultValue, {
    serialize: "ignore",
  }) as StoreWritable<unknown>;
  let isMirroringFromOwnedStore = false;

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
        () => ownedStore.getState(),
        owner.scope,
      );
    },
  });

  const contractElement = meta.ownedModel["~contract"].shape[key];
  const target = ownedStoreCandidate;

  sample({
    clock: ownedStore.updates,
    fn: (value) => {
      isMirroringFromOwnedStore = true;
      return value;
    },
    target: proxy,
  });

  sample({
    clock: ownedStore.updates,
    fn: () => undefined,
    target: meta.changed,
  });

  if (contractElement?.["~kind"] === "store" && target) {
    const syncStoreTrigger = createEvent<{
      owner: OwnerContext | undefined;
      value: unknown;
    }>();
    const syncStore = createEffect<
      { owner: OwnerContext | undefined; value: unknown },
      void
    >(({ owner, value }) => {
      if (!owner) {
        return;
      }

      const instance = ensureCreatedModelForContext(meta, owner);

      if (!instance) {
        return;
      }

      withInstanceContext(
        meta.ownedModel,
        instance,
        () => {
          launchUnit(target, value, owner.scope);
        },
        owner.scope,
      );
    });

    sample({
      clock: proxy.updates,
      filter: () => {
        if (isMirroringFromOwnedStore) {
          isMirroringFromOwnedStore = false;
          return false;
        }

        return true;
      },
      fn: (value: unknown) => ({
        owner: getCurrentOwnerContext(),
        value,
      }),
      target: syncStoreTrigger,
    });

    sample({
      clock: syncStoreTrigger,
      target: syncStore,
    });
  }

  return proxy;
}

function createCreatedModelApi<T extends AnyModel>(
  meta: CreatedModelMeta<T>,
  api: ModelApi,
  path: string[] = [],
): CreatedModelApi<T["~api"]> {
  const result: Record<string, unknown> = {};

  for (const [key, element] of Object.entries(api)) {
    if (isComponentInternalKey(key)) {
      continue;
    }

    if (effectorIs.store(element)) {
      result[key] = createCreatedStoreUnit(meta, [...path, key], element);
      continue;
    }

    if (effectorIs.event(element) || effectorIs.effect(element)) {
      result[key] = createCreatedEventUnit(meta, [...path, key]) ?? element;
      continue;
    }

    if (
      isObject(element) &&
      !modelIs.model(element) &&
      !isRef(element) &&
      !isCreatedModel(element)
    ) {
      result[key] = createCreatedModelApi(meta, element as ModelApi, [
        ...path,
        key,
      ]);
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
    changed: createEvent<void>(),
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
  data?: InstanceData,
): Promise<void> {
  const payload = {
    ...createModelPayload(handle.model, handle),
    data: {
      ...createModelPayload(handle.model, handle).data,
      ...data,
    } as ContractData<T["~contract"]>,
  };

  await callUnit(handle.model.create, payload, handle.scope);
  const mountedUnit = handle.model["~api"]["$$mounted"];
  const instance = getModelInstance(handle.model, handle.id, handle.scope);

  if (typeof mountedUnit === "function" && instance) {
    await withInstanceContext(
      handle.model,
      instance,
      () => callUnit(mountedUnit, mounted, handle.scope),
      handle.scope,
    );
  }
}

export function launchManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  mounted: MountedPayload = {},
  data?: InstanceData,
): void {
  let instance = getModelInstance(handle.model, handle.id, handle.scope);

  if (!instance) {
    callUnitSync(
      handle.model.create,
      {
        ...createModelPayload(handle.model, handle),
        data: {
          ...createModelPayload(handle.model, handle).data,
          ...data,
        },
      },
      handle.scope,
    );
    instance = getModelInstance(handle.model, handle.id, handle.scope);
  }
  const mountedUnit = handle.model["~api"]["$$mounted"];

  if (typeof mountedUnit === "function" && instance) {
    withInstanceContext(
      handle.model,
      instance,
      () => {
        launchUnit(mountedUnit, mounted, handle.scope);
      },
      handle.scope,
    );
  }
}

export function syncManagedModelData<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  data: InstanceData,
): void {
  callUnitSync(
    handle.model.create,
    {
      ...createModelPayload(handle.model, handle),
      data: {
        ...data,
      },
    },
    handle.scope,
  );
}

export async function unmountManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
): Promise<void> {
  const unmountedUnit = handle.model["~api"]["$$unmounted"];
  const instance = getModelInstance(handle.model, handle.id, handle.scope);

  if (typeof unmountedUnit === "function" && instance) {
    await withInstanceContext(
      handle.model,
      instance,
      () => callUnit(unmountedUnit, undefined, handle.scope),
      handle.scope,
    );
  }

  await callUnit(handle.model.delete, handle.id, handle.scope);
}

export function launchUnmountManagedModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
): void {
  const unmountedUnit = handle.model["~api"]["$$unmounted"];
  const instance = getModelInstance(handle.model, handle.id, handle.scope);

  if (typeof unmountedUnit === "function" && instance) {
    withInstanceContext(
      handle.model,
      instance,
      () => {
        launchUnit(unmountedUnit, undefined, handle.scope);
      },
      handle.scope,
    );
  }

  callUnitSync(handle.model.delete, handle.id, handle.scope);
}

export function toViewEntity<T extends Model<any, any>>(
  entity: ReactModelEntity<T>,
): ComponentViewEntity<T> {
  return entity as unknown as ComponentViewEntity<T>;
}

function transformToView(value: unknown, isRoot = false): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => transformToView(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  if (resolvedViewEntityMarker in value) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "function" && !(isRoot && key === "id")) {
      result[toViewHandlerName(key)] = entry;
      continue;
    }

    const nextKey = isRoot && key === "id" ? key : normalizeViewKey(key);
    result[nextKey] = transformToView(entry);
  }

  return result;
}

export { isLens, isSingleLens, isCreatedModel };
