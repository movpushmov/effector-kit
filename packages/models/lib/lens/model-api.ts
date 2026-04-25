import { is } from 'effector';
import { is as modelIs } from '../is';
import type { Model, ModelApi } from '../models';
import type { ModelLensApi } from './types';
import { createClock, createTarget } from './dispatch';
import { lens } from './lens';
import { expandInstancesWithAliases } from '../models/aliases';

function collectNestedInstances(
  parentInstances: Record<string, any>,
  nestedModel: Model<any, any>,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [parentId, parentInstance] of Object.entries(parentInstances)) {
    const children = parentInstance?.['~children']?.[nestedModel['~id']] ?? {};
    const childAliases =
      parentInstance?.['~childAliases']?.[nestedModel['~id']] ?? {};
    const childrenWithAliases = expandInstancesWithAliases(
      children,
      childAliases,
    );

    for (const [childId, childInstance] of Object.entries(
      childrenWithAliases,
    )) {
      if (typeof childInstance === 'object' && childInstance !== null) {
        Object.defineProperty(childInstance, '~owner', {
          value: parentInstance,
          configurable: true,
          enumerable: false,
          writable: true,
        });
      }

      result[`${parentId}:${childId}`] = childInstance;
    }
  }

  return result;
}

interface ModelApiOptions<T extends Model<any, ModelApi>> {
  model: T;
  getInstances: (payload: any) => Record<string, any>;
  getTargetModel: () => Model<any, any>;
  getContextModelId: () => string;
}

function createElementActions(
  element: unknown,
  model: Model<any, any>,
  getInstances: (payload: any) => Record<string, any>,
  getTargetModel: () => Model<any, any>,
  getContextModelId: () => string,
): unknown {
  if (is.store(element) || is.event(element)) {
    const actions: any = {
      clock() {
        return createClock(
          element as any,
          model,
          getInstances,
          getContextModelId,
        );
      },
    };

    if (is.targetable(element)) {
      actions.target = (map?: (payload: any) => any) =>
        createTarget(
          element as any,
          model,
          getInstances,
          getTargetModel,
          getContextModelId,
          map,
        );
    }

    return actions;
  }

  if (modelIs.model(element)) {
    const nestedLens = lens(element);

    (nestedLens as any)['~setSource']?.({
      source: element.$instances,
      getSource: (payload: any) =>
        collectNestedInstances(getInstances(payload), element),
    });
    (nestedLens as any)['~setContextModelId']?.(model['~id']);

    return nestedLens;
  }

  if (typeof element === 'object' && element !== null) {
    const result: Record<string, unknown> = {};

    for (const [key, nestedElement] of Object.entries(element)) {
      const resolved = createElementActions(
        nestedElement,
        model,
        getInstances,
        getTargetModel,
        getContextModelId,
      );

      if (resolved !== undefined) {
        result[key] = resolved;
      }
    }

    return result;
  }

  return undefined;
}

export function createModelLensApi<T extends Model<any, ModelApi>>({
  model,
  getInstances,
  getTargetModel,
  getContextModelId,
}: ModelApiOptions<T>): ModelLensApi<T, any> {
  const api: any = {};

  for (const key in model['~api']) {
    const element = model['~api'][key];

    if (!element) {
      continue;
    }

    const resolved = createElementActions(
      element,
      model,
      getInstances,
      getTargetModel,
      getContextModelId,
    );

    if (resolved !== undefined) {
      api[key] = resolved;
    }
  }

  return api;
}
