import type {
  Contract,
  ContractApi,
  ContractData,
  Lens,
  Model,
  ModelApi,
  Ref,
  Union,
  UnionMap,
} from "@effector-kit/models";
import type {
  Effect,
  Event,
  EventCallable,
  Scope,
  Store,
  StoreValue,
  StoreWritable,
} from "effector";
import type { ReactNode } from "react";

type ContractInput = Contract<any> | (() => Contract<any>);

export type InferContract<Input extends ContractInput> =
  Input extends Contract<any>
    ? Input
    : Input extends (...args: any[]) => infer Result
      ? Result extends Contract<any>
        ? Result
        : never
      : never;

type Handler<Payload> = [Payload] extends [void]
  ? () => void
  : (payload: Payload) => void;

type UnitHandler<Unit> =
  Unit extends EventCallable<infer Payload>
    ? Handler<Payload>
    : Unit extends Event<infer Payload>
      ? Handler<Payload>
      : Unit extends Effect<infer Params, any, any>
        ? Handler<Params>
        : never;

export interface ReactModelHandle<T extends Model<any, any>> {
  "~kind": "react-model";
  id: string;
  model: T;
  data: Partial<ContractData<T["~contract"]>>;
  scope?: Scope | undefined;
}

type UnionModels<T extends Union<UnionMap>> =
  T extends Union<infer Models extends UnionMap> ? Models : never;

type ResolvedUnionEntity<T extends Union<UnionMap>> = {
  [K in keyof UnionModels<T>]: ReactModelEntity<UnionModels<T>[K]> & {
    variant: K;
  };
}[keyof UnionModels<T>];

type ResolvedRefValue<T extends Model<any, any> | Union<UnionMap>> =
  T extends Model<any, any>
    ? Array<ReactModelEntity<T>>
    : T extends Union<UnionMap>
      ? Array<ResolvedUnionEntity<T>>
      : never;

type ResolvedModelValue<Element> =
  Element extends StoreWritable<any>
    ? StoreValue<Element>
    : Element extends Store<any>
      ? StoreValue<Element>
      : Element extends Event<any> | EventCallable<any> | Effect<any, any, any>
        ? UnitHandler<Element>
        : Element extends Model<any, any>
          ? Array<ReactModelEntity<Element>>
          : Element extends Ref<infer Target>
            ? ResolvedRefValue<Target>
            : never;

export type ReactModelValue<Api extends ModelApi> = {
  [K in keyof Api as K extends `$$${string}` ? never : K]: ResolvedModelValue<
    Api[K]
  >;
};

export type ReactModelEntity<T extends Model<any, any>> = {
  id: string;
} & ReactModelValue<T["~api"]>;

type ComponentUnitValue<Element> =
  Element extends StoreWritable<any>
    ? StoreValue<Element>
    : Element extends Store<any>
      ? StoreValue<Element>
      : Element extends Model<any, any>
        ? Array<ComponentViewEntity<Element>>
        : Element extends Ref<infer Target>
          ? Target extends Model<any, any>
            ? Array<ComponentViewEntity<Target>>
            : Target extends Union<UnionMap>
              ? Array<
                  {
                    [K in keyof UnionModels<Target>]: ComponentViewEntity<
                      UnionModels<Target>[K]
                    > & {
                      variant: K;
                    };
                  }[keyof UnionModels<Target>]
                >
              : never
          : never;

type ComponentUnitHandlerName<Key extends string> = `on${Capitalize<Key>}`;

export type ComponentViewValue<Api extends ModelApi> = {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : Api[K] extends Event<any> | EventCallable<any> | Effect<any, any, any>
      ? never
      : K]: ComponentUnitValue<Api[K]>;
} & {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : Api[K] extends Event<any> | EventCallable<any> | Effect<any, any, any>
      ? ComponentUnitHandlerName<string & K>
      : never]: UnitHandler<Api[K]>;
};

export type ComponentViewEntity<T extends Model<any, any>> = {
  id: string;
} & ComponentViewValue<T["~api"]>;

export interface UseModelOptions<T extends Model<any, any>> {
  data?: Partial<ContractData<T["~contract"]>>;
  scope?: Scope;
}

export interface ComponentCreateOptions {
  id?: string;
  scope?: Scope | undefined;
}

export interface ComponentConfig<
  Input extends ContractInput,
  Api extends ModelApi,
> {
  contract: Input;
  model: (
    api: ContractApi<InferContract<Input>>,
    mounted: EventCallable<void>,
    unmounted: EventCallable<void>,
  ) => Api;
  view: (
    props: ComponentViewEntity<Model<InferContract<Input>, Api>>,
  ) => ReactNode;
}

export type ComponentProps<T extends Model<any, any>> = Partial<
  ContractData<T["~contract"]>
> & {
  model?: ReactModelHandle<T>;
};

export type ModelComponent<T extends Model<any, any>> = ((
  props: ComponentProps<T>,
) => ReactNode) & {
  create(
    data?: Partial<ContractData<T["~contract"]>>,
    options?: ComponentCreateOptions,
  ): ReactModelHandle<T>;
  model: T;
};
