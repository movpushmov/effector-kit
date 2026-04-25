import type { AddAliasPayload, Aliases } from './types';

const sourceInstanceKey = Symbol('effector-kit.source-instance');

type InstancesMap = Record<string, any>;

function hasOwn(source: InstancesMap, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

export function resolveInstanceId(
  instances: InstancesMap,
  aliases: Aliases,
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

export function getOriginalIdByInstance(
  instances: InstancesMap,
  instance: unknown,
): string | undefined {
  for (const [id, value] of Object.entries(instances)) {
    if (value === instance) {
      return id;
    }
  }

  return undefined;
}

export function expandInstancesWithAliases(
  instances: InstancesMap,
  aliases: Aliases,
): InstancesMap {
  const result: InstancesMap = { ...instances };

  for (const [aliasId, id] of Object.entries(aliases)) {
    if (hasOwn(instances, aliasId)) {
      continue;
    }

    const originalId = resolveInstanceId(instances, aliases, id);

    if (originalId === undefined) {
      continue;
    }

    result[aliasId] = instances[originalId];
  }

  return result;
}

export function normalizeAddAliasPayload(
  payload: AddAliasPayload | AddAliasPayload[],
): Array<{ aliasId: string; instanceId?: string }> {
  const list = Array.isArray(payload) ? payload : [payload];

  return list.map(item =>
    typeof item === 'string' ? { aliasId: item } : item,
  );
}

export function addAliases(
  aliases: Aliases,
  instances: InstancesMap,
  payload: AddAliasPayload | AddAliasPayload[],
  contextInstance?: unknown,
): Aliases {
  const nextAliases: Aliases = { ...aliases };

  for (const item of normalizeAddAliasPayload(payload)) {
    const targetId =
      item.instanceId !== undefined
        ? resolveInstanceId(instances, nextAliases, item.instanceId)
        : contextInstance !== undefined
          ? getOriginalIdByInstance(instances, contextInstance)
          : undefined;

    delete nextAliases[item.aliasId];

    if (
      targetId === undefined ||
      targetId === item.aliasId ||
      hasOwn(instances, item.aliasId)
    ) {
      continue;
    }

    nextAliases[item.aliasId] = targetId;
  }

  return nextAliases;
}

export function removeAliases(
  aliases: Aliases,
  payload: string | string[],
): Aliases {
  const ids = Array.isArray(payload) ? payload : [payload];
  const nextAliases: Aliases = { ...aliases };

  for (const id of ids) {
    delete nextAliases[id];
  }

  return nextAliases;
}

export function removeAliasesForCreatedInstances(
  aliases: Aliases,
  payload: { id: string } | Array<{ id: string }>,
): Aliases {
  const instances = Array.isArray(payload) ? payload : [payload];
  const nextAliases: Aliases = { ...aliases };

  for (const instance of instances) {
    delete nextAliases[instance.id];
  }

  return nextAliases;
}

export function resolveDeleteIds(
  instances: InstancesMap,
  aliases: Aliases,
  payload: string | string[],
): string[] {
  const ids = Array.isArray(payload) ? payload : [payload];
  const result = new Set<string>();

  for (const id of ids) {
    const originalId = resolveInstanceId(instances, aliases, id);

    if (originalId !== undefined) {
      result.add(originalId);
    }
  }

  return Array.from(result);
}

export function removeAliasesForDeletedInstances(
  aliases: Aliases,
  deletedIds: string[],
): Aliases {
  if (deletedIds.length === 0) {
    return aliases;
  }

  const deleted = new Set(deletedIds);
  const nextAliases: Aliases = {};

  for (const [aliasId, id] of Object.entries(aliases)) {
    if (deleted.has(aliasId) || deleted.has(id)) {
      continue;
    }

    nextAliases[aliasId] = id;
  }

  return nextAliases;
}

function resolveAliasTarget(aliases: Aliases, id: string): string | undefined {
  const visited = new Set<string>();
  let current = aliases[id];

  while (current !== undefined && !visited.has(current)) {
    const next = aliases[current];

    if (next === undefined) {
      return current;
    }

    visited.add(current);
    current = next;
  }

  return current;
}

export function removeAliasesForDeletedPayload(
  aliases: Aliases,
  payload: string | string[],
): Aliases {
  const requestedIds = Array.isArray(payload) ? payload : [payload];
  const deletedIds = new Set<string>();

  for (const id of requestedIds) {
    deletedIds.add(id);

    const targetId = resolveAliasTarget(aliases, id);

    if (targetId !== undefined) {
      deletedIds.add(targetId);
    }
  }

  return removeAliasesForDeletedInstances(aliases, Array.from(deletedIds));
}

export function markSourceInstance<T extends object>(
  value: T,
  sourceInstance: unknown,
): T {
  Object.defineProperty(value, sourceInstanceKey, {
    value: sourceInstance,
    configurable: true,
  });

  return value;
}

function getSourceInstance(value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    sourceInstanceKey in value
  ) {
    return (value as { [sourceInstanceKey]?: unknown })[sourceInstanceKey];
  }

  return value;
}

export function dedupeInstances<T extends Record<string | number, any>>(
  instances: T,
): T {
  const result: Record<string | number, any> = {};
  const seenObjects = new WeakSet<object>();
  const seenPrimitives = new Set<unknown>();

  for (const [id, instance] of Object.entries(instances)) {
    const sourceInstance = getSourceInstance(instance);

    if (typeof sourceInstance === 'object' && sourceInstance !== null) {
      if (seenObjects.has(sourceInstance)) {
        continue;
      }

      seenObjects.add(sourceInstance);
    } else {
      if (seenPrimitives.has(sourceInstance)) {
        continue;
      }

      seenPrimitives.add(sourceInstance);
    }

    result[id] = instance;
  }

  return result as T;
}
