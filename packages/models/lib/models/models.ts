import {
  createEvent,
  createStore,
  is,
  sample,
  type StoreWritable,
} from 'effector';
import type { Contract } from '../contracts';
import { is as runtimeIs } from '../is';
import type {
  ContractApi,
  ContractData,
  CreateInstancePayload,
  Aliases,
  AddAliasPayload,
  Instances,
  Model,
  ModelApi,
} from './types';
import {
  bindRegionModel,
  modifyDeclarations,
  getContext,
  getDeclarationModelId,
  getEntityId,
  modifyStore,
  setDeclarationModelId,
} from '../runtime';
import { createApi, createStaticApi } from './create-api';
import { lens } from '../lens';
import {
  addAliases,
  removeAliases,
  removeAliasesForCreatedInstances,
  removeAliasesForDeletedPayload,
  resolveDeleteIds,
} from './aliases';

interface ModelOptions<T extends Contract<any>, Api extends ModelApi> {
  contract: T;
  fn: (api: ContractApi<T>) => Api;
  instances?: StoreWritable<Instances<T>>;
  aliases?: StoreWritable<Aliases>;
}

function isPlainModelApiObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !is.store(value) &&
    !runtimeIs.model(value) &&
    !runtimeIs.ref(value) &&
    !runtimeIs.union(value)
  );
}

function isWritableStore(value: unknown): value is StoreWritable<unknown> {
  return (
    is.store(value) && (value as StoreWritable<unknown>).targetable === true
  );
}

export function model<T extends Contract<any>, Api extends ModelApi>({
  contract,
  fn,
  instances,
  aliases,
}: ModelOptions<T, Api>): Model<T, Api> {
  const modelId = getEntityId();
  const $instances = instances ?? createStore<Instances<T>>({});
  const $aliases = aliases ?? createStore<Aliases>({});

  const createInstance = createEvent<
    CreateInstancePayload<T> | CreateInstancePayload<T>[]
  >();

  const deleteInstance = createEvent<string | string[]>();
  const addAlias = createEvent<AddAliasPayload | AddAliasPayload[]>();
  const removeAlias = createEvent<string | string[]>();

  const localStoreDefaults: Record<string, unknown> = {};

  const { result: modelApi, region } = modifyDeclarations(() => {
    const api = createApi(contract);
    const previousDeclarationModelId = getDeclarationModelId();
    setDeclarationModelId(modelId);
    const result = (() => {
      try {
        return fn(api);
      } finally {
        setDeclarationModelId(previousDeclarationModelId);
      }
    })();
    const seenStores = new Set<StoreWritable<unknown>>();

    function registerLocalStores(value: unknown, path: string[] = []): void {
      if (isWritableStore(value)) {
        const existingField =
          typeof (value as { ['~field']?: unknown })['~field'] === 'string'
            ? ((value as { ['~field']?: string })['~field'] as string)
            : undefined;

        if (existingField && existingField in contract.shape) {
          return;
        }

        if (seenStores.has(value)) {
          return;
        }

        seenStores.add(value);

        const field = path.join('.');

        if (!field || field in contract.shape) {
          return;
        }

        localStoreDefaults[field] = value.getState();
        Object.defineProperty(value, '~field', {
          value: field,
          configurable: true,
        });
        modifyStore(value, field);
        return;
      }

      if (is.store(value)) {
        return;
      }

      if (!isPlainModelApiObject(value)) {
        return;
      }

      for (const [key, element] of Object.entries(value)) {
        registerLocalStores(element, [...path, key]);
      }
    }

    registerLocalStores(result);

    return result;
  });

  sample({
    clock: createInstance,
    source: $instances,
    fn: (
      instances: Instances<T>,
      payload: CreateInstancePayload<T> | CreateInstancePayload<T>[],
    ): Instances<T> => {
      const newInstances = Array.isArray(payload) ? payload : [payload];
      const copy: Instances<T> = { ...instances };

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
    clock: createInstance,
    source: $aliases,
    fn: removeAliasesForCreatedInstances,
    target: $aliases,
  });

  sample({
    clock: deleteInstance,
    source: {
      instances: $instances,
      aliases: $aliases,
    },
    fn: ({ instances, aliases }, id: string | string[]): Instances<T> => {
      const toRemove = resolveDeleteIds(instances, aliases, id);
      const copy: Instances<T> = { ...instances };

      for (const id of toRemove) {
        delete copy[id];
      }

      return copy;
    },
    target: $instances,
  });

  sample({
    clock: deleteInstance,
    source: $aliases,
    fn: removeAliasesForDeletedPayload,
    target: $aliases,
  });

  sample({
    clock: addAlias,
    source: {
      instances: $instances,
      aliases: $aliases,
    },
    fn: ({ instances, aliases }, payload): Aliases => {
      const ctx = getContext();
      const contextInstance =
        ctx.current?.model['~id'] === modelId
          ? ctx.current.instance
          : undefined;

      return addAliases(aliases, instances, payload, contextInstance);
    },
    target: $aliases,
  });

  sample({
    clock: removeAlias,
    source: $aliases,
    fn: removeAliases,
    target: $aliases,
  });

  const builtModel = {
    '~kind': 'model',
    '~contract': contract,
    '~api': modelApi,
    '~fn': fn,
    '~localStoreDefaults': localStoreDefaults,

    '~id': modelId,
    '~region': region,

    $instances,
    $aliases,

    create: createInstance,
    delete: deleteInstance,
    addAlias,
    removeAlias,
  } as unknown as Model<T, Api>;

  const builtLens = lens(builtModel);
  bindRegionModel(region, builtModel);

  return Object.assign(builtModel, {
    lens: builtLens,

    static(data: ContractData<T>) {
      return createStaticApi(contract, data);
    },
  });
}
