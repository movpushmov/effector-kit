import { createEffect, createEvent, launch, sample } from "effector";
import { is as modelIs } from "../is";
import type { Model } from "../models";
import type { Union, UnionMap } from "../union";
import { createModelLensApi } from "./model-api";
import {
  expandInstancesWithAliases,
  markSourceInstance,
} from "../models/aliases";
import {
  firstPredicate,
  idsPredicate,
  lastPredicate,
  singlePredicate,
  unionWherePredicate,
  wherePredicate,
} from "./predicates";
import { createLensState, type LensState } from "./state";

type ModelSourceGetter = (payload: any, source?: any) => Record<string, any>;
type UnionSourceGetter = (
  activeKeys: string[],
  payload: any,
  source?: any,
) => Record<string, any>;

interface ModelLensConfig {
  kind: "model";
  model: Model<any, any>;
  source: any;
  predicates: any[];
  singleResult: boolean;
  sourceRef: { current: ModelSourceGetter };
  getTargetModel: () => Model<any, any>;
  getContextModelId: () => string;
}

interface UnionLensConfig {
  kind: "union";
  input: Union<UnionMap>;
  activeKeys: string[];
  source: any;
  predicates: any[];
  singleResult: boolean;
  contextModelId?: string;
  sourceRef: { current: UnionSourceGetter };
}

type LensConfig = ModelLensConfig | UnionLensConfig;

function collectUnionInstances(
  models: UnionMap,
  activeKeys: string[],
  source?: Record<
    string,
    | Record<string, any>
    | {
        instances?: Record<string, any>;
        aliases?: Record<string, string>;
      }
  >,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const key of activeKeys) {
    const model = models[key];

    if (!model) {
      continue;
    }

    const modelSource = source?.[key];
    const instances =
      modelSource &&
      "instances" in modelSource &&
      modelSource.instances !== undefined
        ? modelSource.instances
        : (modelSource as Record<string, any> | undefined) ??
          model.$instances.getState() ??
          {};
    const aliases =
      modelSource &&
      "aliases" in modelSource &&
      modelSource.aliases !== undefined
        ? modelSource.aliases
        : model.$aliases.getState() ?? {};
    const instancesWithAliases = expandInstancesWithAliases(instances, aliases);

    for (const [id, data] of Object.entries(instancesWithAliases)) {
      result[`${model["~id"]}:${id}`] = markSourceInstance(
        { ...(data as any), id, "~model": key },
        data,
      );
    }
  }

  return result;
}

function selectVariantInstances(
  instances: Record<string, any>,
  variantKey: string,
  originalInstances: Record<string, any>,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const entity of Object.values(instances)) {
    if (entity["~model"] !== variantKey) {
      continue;
    }

    const originalId = entity.id;

    if (originalInstances[originalId]) {
      result[originalId] = originalInstances[originalId];
    }
  }

  return result;
}

function getUnionSource(input: Union<UnionMap>) {
  return Object.fromEntries(
    Object.entries(input.models).map(([key, model]) => [
      key,
      {
        instances: model.$instances,
        aliases: model.$aliases,
      },
    ]),
  );
}

function getModelSource(model: Model<any, any>) {
  return {
    instances: model.$instances,
    aliases: model.$aliases,
  };
}

function getExpandedModelInstances(model: Model<any, any>): Record<string, any> {
  return expandInstancesWithAliases(
    model.$instances.getState() ?? {},
    model.$aliases.getState() ?? {},
  );
}

function createModelConfig(
  model: Model<any, any>,
  sourceGetter: ModelSourceGetter = (_, source) => {
    const instances =
      source && "instances" in source && source.instances !== undefined
        ? source.instances
        : source ?? model.$instances.getState();
    const aliases =
      source && "aliases" in source && source.aliases !== undefined
        ? source.aliases
        : model.$aliases.getState();

    return expandInstancesWithAliases(instances ?? {}, aliases ?? {});
  },
  getTargetModel: () => Model<any, any> = () => model,
  getContextModelId: () => string = () => model["~id"],
  source: any = getModelSource(model),
): ModelLensConfig {
  return {
    kind: "model",
    model,
    source,
    predicates: [],
    singleResult: false,
    sourceRef: { current: sourceGetter },
    getTargetModel,
    getContextModelId,
  };
}

function createUnionConfig(input: Union<UnionMap>): UnionLensConfig {
  return {
    kind: "union",
    input,
    activeKeys: Object.keys(input.models),
    source: getUnionSource(input),
    predicates: [],
    singleResult: false,
    sourceRef: {
      current: (activeKeys, _, source) =>
        collectUnionInstances(input.models, activeKeys, source),
    },
  };
}

function cloneModelConfig(
  config: ModelLensConfig,
  predicate?: any,
  patch?: Partial<Pick<ModelLensConfig, "singleResult">>,
): ModelLensConfig {
  return {
    ...config,
    singleResult: patch?.singleResult ?? config.singleResult,
    predicates: predicate
      ? [...config.predicates, predicate]
      : [...config.predicates],
  };
}

function cloneUnionConfig(
  config: UnionLensConfig,
  patch?: Partial<Pick<UnionLensConfig, "activeKeys" | "singleResult">>,
  predicate?: any,
): UnionLensConfig {
  return {
    ...config,
    activeKeys: patch?.activeKeys ?? [...config.activeKeys],
    singleResult: patch?.singleResult ?? config.singleResult,
    predicates: predicate
      ? [...config.predicates, predicate]
      : [...config.predicates],
  };
}

function createModelState(config: ModelLensConfig): LensState {
  return createLensState(
    (payload) => config.sourceRef.current(payload),
    config.predicates,
  );
}

function createUnionState(config: UnionLensConfig): LensState {
  return createLensState(
    (payload) => config.sourceRef.current(config.activeKeys, payload),
    config.predicates,
  );
}

function buildModelLens(config: ModelLensConfig): any {
  const state = createModelState(config);
  const lensObj: any = {
    props() {
      return lensObj;
    },
    ids(...ids: string[]) {
      return createLensRoot(cloneModelConfig(config, idsPredicate(ids)));
    },
    where(predicate: any) {
      return createLensRoot(
        cloneModelConfig(config, wherePredicate(predicate)),
      );
    },
    first() {
      return createLensRoot(
        cloneModelConfig(config, firstPredicate, { singleResult: true }),
      );
    },
    last() {
      return createLensRoot(
        cloneModelConfig(config, lastPredicate, { singleResult: true }),
      );
    },
    single() {
      return createLensRoot(
        cloneModelConfig(config, singlePredicate, { singleResult: true }),
      );
    },
    addAlias() {
      const addAliasEvent = createEvent<any>();
      const resolvedAliasAdded = createEvent<any>();

      sample({
        clock: addAliasEvent,
        fn: (payload) => {
          if (typeof payload !== "string" && payload.instanceId !== undefined) {
            return payload;
          }

          const entries = Object.entries(
            createLensState(
              (payload) => config.sourceRef.current(payload),
              config.predicates,
            ).getSource(payload),
          );

          if (entries.length !== 1) {
            return null;
          }

          const [id] = entries[0]!;

          if (typeof payload === "string") {
            return { aliasId: payload, instanceId: id };
          }

          return {
            ...payload,
            instanceId: payload.instanceId ?? id,
          };
        },
        target: resolvedAliasAdded,
      });

      sample({
        clock: resolvedAliasAdded,
        filter: (payload) => payload !== null,
        target: config.model.addAlias,
      });

      return addAliasEvent;
    },
    delete() {
      const deleteEvent = createEvent<void>();

      sample({
        clock: deleteEvent,
        fn: () =>
          Object.keys(
            createLensState(
              (payload) => config.sourceRef.current(payload),
              config.predicates,
            ).getSource(undefined),
          ),
        target: config.model.delete,
      });

      return deleteEvent;
    },
    ...createModelLensApi({
      model: config.model,
      getTargetModel: config.getTargetModel,
      getContextModelId: config.getContextModelId,
      getInstances: (payload) => state.getSource(payload),
    }),
  };

  Object.defineProperty(lensObj, "getSource", {
    configurable: true,
    value: (source?: any) => {
      if (source === undefined) {
        return state.getSource(undefined);
      }

      return createLensState(
        (payload) => config.sourceRef.current(payload, source),
        config.predicates,
      ).getSource(undefined);
    },
  });

  Object.defineProperty(lensObj, "~setSourceGetter", {
    configurable: true,
    value: (nextGetter: ModelSourceGetter) => {
      config.sourceRef.current = nextGetter;
    },
  });

  Object.defineProperty(lensObj, "~setSource", {
    configurable: true,
    value: ({
      source,
      getSource,
    }: {
      source: any;
      getSource: ModelSourceGetter;
    }) => {
      config.source = source;
      config.sourceRef.current = getSource;
    },
  });

  Object.defineProperty(lensObj, "~setContextModelId", {
    configurable: true,
    value: (nextModelId: string) => {
      config.getContextModelId = () => nextModelId;
    },
  });

  Object.defineProperty(lensObj, "~setContextModel", {
    configurable: true,
    value: (nextModel: Model<any, any>) => {
      config.getContextModelId = () => nextModel["~id"];
    },
  });

  Object.defineProperty(lensObj, "~single", {
    configurable: true,
    value: config.singleResult,
  });

  return lensObj;
}

function buildUnionDelete(config: UnionLensConfig, state: LensState) {
  const deleteEvent = createEvent<void>();
  const deleteFx = createEffect((entities: Record<string, any>) => {
    const grouped = new Map<Model<any, any>, string[]>();

    for (const entity of Object.values(entities)) {
      const model = config.input.models[entity["~model"]];

      if (!model) {
        continue;
      }

      const current = grouped.get(model) ?? [];
      grouped.set(model, [...current, entity.id]);
    }

    for (const [model, ids] of grouped.entries()) {
      launch(model.delete, ids);
    }
  });

  sample({
    clock: deleteEvent,
    fn: () =>
      createLensState(
        (payload) => config.sourceRef.current(config.activeKeys, payload),
        config.predicates,
      ).getSource(undefined),
    target: deleteFx,
  });
  return deleteEvent;
}

function buildUnionLens(config: UnionLensConfig): any {
  const state = createUnionState(config);
  const lensObj: any = {
    props() {
      return lensObj;
    },
    ids(...ids: string[]) {
      return createLensRoot(
        cloneUnionConfig(config, undefined, idsPredicate(ids)),
      );
    },
    where(predicate: any) {
      return createLensRoot(
        cloneUnionConfig(
          config,
          undefined,
          unionWherePredicate(predicate, config.input.models),
        ),
      );
    },
    only(...keys: string[]) {
      return createLensRoot(cloneUnionConfig(config, { activeKeys: keys }));
    },
    first() {
      return createLensRoot(
        cloneUnionConfig(
          config,
          { singleResult: true },
          firstPredicate,
        ),
      );
    },
    last() {
      return createLensRoot(
        cloneUnionConfig(
          config,
          { singleResult: true },
          lastPredicate,
        ),
      );
    },
    single() {
      return createLensRoot(
        cloneUnionConfig(
          config,
          { singleResult: true },
          singlePredicate,
        ),
      );
    },
    uniqueId(variantKey: string, id: string) {
      return `${config.input.models[variantKey]?.["~id"] ?? variantKey}:${id}`;
    },
    delete() {
      return buildUnionDelete(config, state);
    },
    match(handlers: Record<string, (subLens: any) => any>) {
      const units: any[] = [];

      for (const [key, handler] of Object.entries(handlers)) {
        if (!config.activeKeys.includes(key)) {
          continue;
        }

        const model = config.input.models[key];

        if (!model) {
          continue;
        }

        const subLens = createLensRoot(
          createModelConfig(
            model,
            (payload) =>
              selectVariantInstances(
                state.getSource(payload),
                key,
                getExpandedModelInstances(model),
              ),
            () => model,
            () => config.contextModelId ?? model["~id"],
          ),
        );

        const unit = handler(subLens);

        if (unit) {
          units.push(unit);
        }
      }

      const event = createEvent<any>();

      if (units.length > 0) {
        sample({ clock: event, target: units });
      }

      return event;
    },
  };

  for (const [key, model] of Object.entries(config.input.models)) {
    if (!config.activeKeys.includes(key)) {
      continue;
    }

    lensObj[key] = createLensRoot(
      createModelConfig(
        model,
        (payload) =>
            selectVariantInstances(
              state.getSource(payload),
              key,
              getExpandedModelInstances(model),
            ),
        () => model,
        () => config.contextModelId ?? model["~id"],
      ),
    );
  }

  Object.defineProperty(lensObj, "getSource", {
    configurable: true,
    value: (source?: any) => {
      if (source === undefined) {
        return state.getSource(undefined);
      }

      return createLensState(
        (payload) => config.sourceRef.current(config.activeKeys, payload, source),
        config.predicates,
      ).getSource(undefined);
    },
  });

  Object.defineProperty(lensObj, "~setSourceGetter", {
    configurable: true,
    value: (nextGetter: UnionSourceGetter) => {
      config.sourceRef.current = nextGetter;
    },
  });

  Object.defineProperty(lensObj, "~setSource", {
    configurable: true,
    value: ({
      source,
      getSource,
    }: {
      source: any;
      getSource: UnionSourceGetter;
    }) => {
      config.source = source;
      config.sourceRef.current = getSource;
    },
  });

  Object.defineProperty(lensObj, "~single", {
    configurable: true,
    value: config.singleResult,
  });

  Object.defineProperty(lensObj, "~setContextModelId", {
    configurable: true,
    value: (nextModelId: string) => {
      config.contextModelId = nextModelId;
    },
  });

  return lensObj;
}

export function createLensRoot(
  input: Model<any, any> | Union<UnionMap> | LensConfig,
): any {
  let config: LensConfig;

  if ("kind" in (input as any)) {
    config = input as LensConfig;
  } else if (modelIs.union(input)) {
    config = createUnionConfig(input as Union<UnionMap>);
  } else {
    config = createModelConfig(input as Model<any, any>);
  }

  if (config.kind === "union") {
    return buildUnionLens(config);
  }

  return buildModelLens(config);
}
