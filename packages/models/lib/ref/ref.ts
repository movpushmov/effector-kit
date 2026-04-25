import { createEvent, createStore, sample } from 'effector';
import type { Model } from '../models';
import { lens } from '../lens';
import type { Ref } from './types';
import { is as modelIs } from '../is';
import type { Union, UnionMap } from '../union';
import {
  getDeclarationModelId,
  getEntityId,
  modifyRefsStore,
} from '../runtime';
import {
  expandInstancesWithAliases,
  markSourceInstance,
} from '../models/aliases';

type RefItem = { key: string; id: string };

function setModelRefSource(
  patchedLens: any,
  model: Model<any, any>,
  $ids: ReturnType<typeof createStore<string[]>>,
): void {
  patchedLens['~setSource']?.({
    source: {
      ids: $ids,
      instances: model.$instances,
      aliases: model.$aliases,
    },
    getSource: (
      _: any,
      source: {
        ids: string[];
        instances: Record<string, any>;
        aliases: Record<string, string>;
      },
    ) => {
      const ids = source?.ids ?? $ids.getState() ?? [];

      if (!ids.length) {
        return {};
      }

      const instances = source?.instances ?? model.$instances.getState() ?? {};
      const aliases = source?.aliases ?? model.$aliases.getState() ?? {};
      const instancesWithAliases = expandInstancesWithAliases(
        instances,
        aliases,
      );

      return Object.fromEntries(
        Object.entries(instancesWithAliases).filter(([id]) => ids.includes(id)),
      );
    },
  });
}

function setUnionRefSource(
  patchedLens: any,
  input: Union<UnionMap>,
  $ids: ReturnType<typeof createStore<RefItem[]>>,
): void {
  patchedLens['~setSource']?.({
    source: {
      ids: $ids,
      models: Object.fromEntries(
        Object.entries(input.models).map(([key, model]) => [
          key,
          {
            instances: model.$instances,
            aliases: model.$aliases,
          },
        ]),
      ),
    },
    getSource: (
      activeKeys: string[],
      _: any,
      source: {
        ids: RefItem[];
        models: Record<
          string,
          {
            instances?: Record<string, any>;
            aliases?: Record<string, string>;
          }
        >;
      },
    ) => {
      const ids = source?.ids ?? $ids.getState() ?? [];

      if (!ids.length) {
        return {};
      }

      const result: Record<string, any> = {};

      for (const { key, id } of ids) {
        if (!activeKeys.includes(key)) {
          continue;
        }

        const model = input.models[key];

        if (!model) {
          continue;
        }

        const modelSource = source?.models?.[key];
        const instances =
          modelSource?.instances ?? model.$instances.getState() ?? {};
        const aliases = modelSource?.aliases ?? model.$aliases.getState() ?? {};
        const instancesWithAliases = expandInstancesWithAliases(
          instances,
          aliases,
        );

        if (!instancesWithAliases[id]) {
          continue;
        }

        result[`${model['~id']}:${id}`] = markSourceInstance(
          {
            ...instancesWithAliases[id],
            id,
            '~model': key,
          },
          instancesWithAliases[id],
        );
      }

      return result;
    },
  });
}

export function ref<T extends Union<UnionMap>>(union: T): Ref<T>;
export function ref<T extends Model<any, any>>(model: T): Ref<T>;
export function ref(input: Union<UnionMap> | Model<any, any>): Ref<any> {
  const refId = getEntityId();
  const patchedLens = lens(input as any);
  const declarationModelId = getDeclarationModelId();

  if (declarationModelId) {
    (patchedLens as any)['~setContextModelId']?.(declarationModelId);
  }

  if (modelIs.union(input)) {
    const $ids = createStore<RefItem[]>([], {
      serialize: 'ignore',
    });

    modifyRefsStore($ids as any, refId, declarationModelId);
    setUnionRefSource(patchedLens, input, $ids);

    const add: Record<string, any> = {};
    const remove: Record<string, any> = {};

    for (const key of Object.keys(input.models)) {
      const addKey = createEvent<string>();
      const removeKey = createEvent<string>();

      sample({
        clock: addKey,
        source: $ids,
        filter: (ids, id) =>
          !ids.some(item => item.key === key && item.id === id),
        fn: (ids, id) => [...ids, { key, id }],
        target: $ids,
      });

      sample({
        clock: removeKey,
        source: $ids,
        fn: (ids, id) => ids.filter(i => !(i.key === key && i.id === id)),
        target: $ids,
      });

      add[key] = addKey;
      remove[key] = removeKey;
    }

    return {
      '~kind': 'ref',
      '~id': refId,
      '~target': input,
      lens: patchedLens,
      add,
      remove,
      $ids,
    };
  }

  const modelInput = input as Model<any, any>;

  const $ids = createStore<string[]>([]);
  modifyRefsStore($ids, refId, declarationModelId);
  setModelRefSource(patchedLens, modelInput, $ids);

  const add = createEvent<string>();
  const remove = createEvent<string>();

  sample({
    clock: add,
    source: $ids,
    filter: (ids, id) => !ids.includes(id),
    fn: (ids, id) => [...ids, id],
    target: $ids,
  });

  sample({
    clock: remove,
    source: $ids,
    fn: (ids, id) => ids.filter(i => i !== id),
    target: $ids,
  });

  return {
    '~kind': 'ref',
    '~id': refId,
    '~target': modelInput,
    lens: patchedLens,
    add,
    remove,
    $ids,
  };
}
