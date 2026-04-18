import { createEvent, type EventCallable } from "effector";
import {
  model as createModel,
  type Contract,
  type ContractData,
  type Model,
  type ModelApi,
} from "@effector-kit/models";
import { createReactModelHandle, toViewEntity } from "./runtime";
import { useModel } from "./use-model";
import type {
  ComponentConfig,
  ComponentProps,
  InferContract,
  ModelComponent,
} from "./types";

function resolveContract<Input extends Contract<any> | (() => Contract<any>)>(
  input: Input,
): InferContract<Input> {
  if (typeof input === "function") {
    return (input as () => InferContract<Input>)();
  }

  return input as InferContract<Input>;
}

function extractComponentData<T extends Model<any, any>>(
  model: T,
  props: ComponentProps<T>,
) {
  const data: Record<string, unknown> = {};

  for (const key of Object.keys(model["~contract"].shape)) {
    if (key in props) {
      data[key] = props[key as keyof typeof props];
    }
  }

  return data as Partial<ContractData<T["~contract"]>>;
}

export function component<
  Input extends Contract<any> | (() => Contract<any>),
  Api extends ModelApi,
>(config: ComponentConfig<Input, Api>): ModelComponent<Model<InferContract<Input>, Api>> {
  const contract = resolveContract(config.contract);

  const builtModel = createModel({
    contract,
    fn(api) {
      const mounted = createEvent<void>();
      const unmounted = createEvent<void>();

      return {
        ...config.model(api as any, mounted, unmounted),
        $$mounted: mounted,
        $$unmounted: unmounted,
      } as Api & {
        $$mounted: EventCallable<void>;
        $$unmounted: EventCallable<void>;
      };
    },
  }) as Model<InferContract<Input>, Api>;

  const Component = ((props: ComponentProps<typeof builtModel>) => {
    const entity = props.model
      ? useModel(props.model)
      : useModel(builtModel, {
          data: extractComponentData(builtModel, props),
        });

    return config.view(toViewEntity(entity as any) as any);
  }) as ModelComponent<typeof builtModel>;

  Component.create = (data, options) =>
    createReactModelHandle(builtModel, data, options);
  Component.model = builtModel;

  return Component;
}
