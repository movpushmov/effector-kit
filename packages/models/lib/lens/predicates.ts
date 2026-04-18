import type { LensPredicate } from "./types";
import type { UnionMap } from "../union";

export function createMatchContext(entity: any, models: UnionMap) {
  return {
    match(config: Record<string, (data: any) => any>): any {
      const handler = config[entity["~model"]];
      return handler ? handler(entity) : undefined;
    },
    uniqueId(variantKey: string, id: string): string {
      return `${models[variantKey]?.["~id"] ?? variantKey}:${id}`;
    },
  };
}

export function wherePredicate(
  fn: (data: any, props: any) => boolean,
): LensPredicate {
  return (instances, props) => {
    const result: Record<string | number, any> = {};

    for (const key in instances) {
      const instance = instances[key];
      const entity = { id: key, ...instance };

      if (fn(entity, props)) {
        result[key] = instance;
      }
    }

    return result;
  };
}

export function firstPredicate(
  instances: Record<string | number, any>,
): Record<string | number, any> {
  const entry = Object.entries(instances)[0];
  return entry ? { [entry[0]]: entry[1] } : {};
}

export function lastPredicate(
  instances: Record<string | number, any>,
): Record<string | number, any> {
  const entry = Object.entries(instances).at(-1);
  return entry ? { [entry[0]]: entry[1] } : {};
}

export function idsPredicate(ids: string[]): LensPredicate {
  if (ids.length === 0) {
    return () => ({});
  }

  if (ids.length === 1) {
    const [id] = ids;

    return (instances) => {
      const instance = instances[id];

      return instance === undefined ? {} : { [id]: instance };
    };
  }

  return (instances) => {
    const result: Record<string | number, any> = {};

    for (const id of ids) {
      const instance = instances[id];

      if (instance !== undefined) {
        result[id] = instance;
      }
    }

    return result;
  };
}

export function unionWherePredicate(
  fn: (
    data: any,
    props: any,
    ctx: ReturnType<typeof createMatchContext>,
  ) => boolean,
  models: UnionMap,
): LensPredicate {
  return (instances, props) => {
    const result: Record<string | number, any> = {};

    for (const key in instances) {
      const instance = instances[key];
      const entity = { id: key, ...instance };
      const ctx = createMatchContext(entity, models);

      if (fn(entity, props, ctx)) {
        result[key] = instance;
      }
    }

    return result;
  };
}
