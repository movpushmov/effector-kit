import { createEvent, type EventCallable } from 'effector';
import {
  model as createModel,
  type Contract,
  type ContractData,
  type Model,
  type ModelApi,
} from '@effector-kit/models';
import { createCreatedModel, toViewEntity } from './runtime';
import { useModel } from './use-model';
import type {
  ComponentConfig,
  ComponentProps,
  InferContract,
  ModelComponent,
} from './types';

function resolveContract<Input extends Contract<any> | (() => Contract<any>)>(
  input: Input,
): InferContract<Input> {
  if (typeof input === 'function') {
    return (input as () => InferContract<Input>)();
  }

  return input as InferContract<Input>;
}

function extractComponentData<T extends Model<any, any>>(
  model: T,
  props: ComponentProps<T, any>,
) {
  const data: Record<string, unknown> = {};

  for (const key of Object.keys(model['~contract'].shape)) {
    if (key in props) {
      data[key] = props[key as keyof typeof props];
    }
  }

  return data as Partial<ContractData<T['~contract']>>;
}

function extractMountedPayload<
  T extends Model<any, any>,
  Mounted extends object | void,
>(model: T, props: ComponentProps<T, Mounted>) {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (key === 'model' || key in model['~contract'].shape) {
      continue;
    }

    payload[key] = value;
  }

  return payload;
}

export function component<
  Input extends Contract<any> | (() => Contract<any>) = Contract<any>,
  Api extends ModelApi = ModelApi,
  Mounted extends object | void = void,
>(
  config: ComponentConfig<Input, Api, Mounted>,
): ModelComponent<Model<InferContract<Input>, Api>, Mounted> {
  const contract = resolveContract(config.contract);

  const builtModel = createModel({
    contract,
    fn(api) {
      const mounted = createEvent<Mounted>();
      const unmounted = createEvent<void>();

      return {
        ...config.model(api as any, mounted, unmounted),
        $$mounted: mounted,
        $$unmounted: unmounted,
      } as Api & {
        $$mounted: EventCallable<Mounted>;
        $$unmounted: EventCallable<void>;
      };
    },
  }) as Model<InferContract<Input>, Api>;

  const Component = ((props: ComponentProps<typeof builtModel, Mounted>) => {
    const mounted = extractMountedPayload(builtModel, props);
    const entity = props.model
      ? // @ts-expect-error
        useModel(props.model, { mounted })
      : useModel(builtModel, {
          data: extractComponentData(builtModel, props),
          mounted,
        });

    return config.view(toViewEntity(entity as any) as any);
  }) as ModelComponent<typeof builtModel, Mounted>;

  Component.create = (data, options) =>
    createCreatedModel(builtModel, data, options);
  Component.model = builtModel;

  return Component;
}
