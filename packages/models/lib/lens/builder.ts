import { createEffect, createEvent, launch, sample } from "effector";
import { is as modelIs } from "../is";
import type { Model } from "../models";
import type { Union, UnionMap } from "../union";
import { createModelLensApi } from "./model-api";
import {
  firstPredicate,
  lastPredicate,
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
  sourceRef: { current: ModelSourceGetter };
  getTargetModel: () => Model<any, any>;
}

interface UnionLensConfig {
  kind: "union";
  input: Union<UnionMap>;
  activeKeys: string[];
  source: any;
  predicates: any[];
  sourceRef: { current: UnionSourceGetter };
}

type LensConfig = ModelLensConfig | UnionLensConfig;

function collectUnionInstances(
  models: UnionMap,
  activeKeys: string[],
  source?: Record<string, Record<string, any>>,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const key of activeKeys) {
    const model = models[key];

    if (!model) {
      continue;
    }

    const instances = source?.[key] ?? model.$instances.getState() ?? {};

    for (const [id, data] of Object.entries(instances)) {
      result[`${model["~id"]}:${id}`] = { ...(data as any), id, "~model": key };
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
    Object.entries(input.models).map(([key, model]) => [key, model.$instances]),
  );
}

function createModelConfig(
  model: Model<any, any>,
  sourceGetter: ModelSourceGetter = (_, source) =>
    source ?? model.$instances.getState(),
  getTargetModel: () => Model<any, any> = () => model,
  source: any = model.$instances,
): ModelLensConfig {
  return {
    kind: "model",
    model,
    source,
    predicates: [],
    sourceRef: { current: sourceGetter },
    getTargetModel,
  };
}

function createUnionConfig(input: Union<UnionMap>): UnionLensConfig {
  return {
    kind: "union",
    input,
    activeKeys: Object.keys(input.models),
    source: getUnionSource(input),
    predicates: [],
    sourceRef: {
      current: (activeKeys, _, source) =>
        collectUnionInstances(input.models, activeKeys, source),
    },
  };
}

function cloneModelConfig(
  config: ModelLensConfig,
  predicate?: any,
): ModelLensConfig {
  return {
    ...config,
    predicates: predicate
      ? [...config.predicates, predicate]
      : [...config.predicates],
  };
}

function cloneUnionConfig(
  config: UnionLensConfig,
  patch?: Partial<Pick<UnionLensConfig, "activeKeys">>,
  predicate?: any,
): UnionLensConfig {
  return {
    ...config,
    activeKeys: patch?.activeKeys ?? [...config.activeKeys],
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
    where(predicate: any) {
      return createLensRoot(
        cloneModelConfig(config, wherePredicate(predicate)),
      );
    },
    first() {
      return createLensRoot(cloneModelConfig(config, firstPredicate));
    },
    last() {
      return createLensRoot(cloneModelConfig(config, lastPredicate));
    },
    delete() {
      const deleteEvent = createEvent<void>();

      sample({
        clock: deleteEvent,
        source: config.source,
        fn: (source) =>
          Object.keys(
            createLensState(
              (payload) => config.sourceRef.current(payload, source),
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
    source: config.source,
    fn: (source) =>
      createLensState(
        (payload) => config.sourceRef.current(config.activeKeys, payload, source),
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
      return createLensRoot(cloneUnionConfig(config, undefined, firstPredicate));
    },
    last() {
      return createLensRoot(cloneUnionConfig(config, undefined, lastPredicate));
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
                model.$instances.getState() ?? {},
              ),
            () => model,
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
            model.$instances.getState() ?? {},
          ),
        () => model,
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
