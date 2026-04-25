import type {
  Contract,
  ContractApi,
  ContractData,
  Model,
  ModelApi,
  Ref,
  Union,
  UnionMap,
} from '@effector-kit/models';
import type {
  Effect,
  Event,
  EventCallable,
  Scope,
  Store,
  StoreValue,
  StoreWritable,
} from 'effector';
import type { ReactNode } from 'react';
import { reactCreatedModelMeta } from './meta';

type ContractInput = Contract<any> | (() => Contract<any>);
type MountedProps<Mounted extends object | void> = [Mounted] extends [void]
  ? {}
  : Mounted;

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

type NormalizeViewKey<Key extends string> = Key extends `$${infer Rest}`
  ? Rest
  : Key;

type ViewHandlerName<Key extends string> =
  `on${Capitalize<NormalizeViewKey<Key>>}`;

type UnitHandler<Unit> =
  Unit extends EventCallable<infer Payload>
    ? Handler<Payload>
    : Unit extends Event<infer Payload>
      ? Handler<Payload>
      : Unit extends Effect<infer Params, any, any>
        ? Handler<Params>
        : never;

export interface ReactModelHandle<T extends Model<any, any>> {
  '~kind': 'react-model';
  id: string;
  model: T;
  data: Partial<ContractData<T['~contract']>>;
  scope?: Scope | undefined;
}

type CreatedModelUnitValue<Element> =
  Element extends StoreWritable<any>
    ? Element
    : Element extends Store<any>
      ? Element
      : Element extends EventCallable<any> | Event<any> | Effect<any, any, any>
        ? Element
        : Element extends Model<any, any>
          ? Element
          : Element extends Ref<any>
            ? Element
            : Element extends ModelApi
              ? CreatedModelApi<Element>
              : never;

export type CreatedModelApi<Api extends ModelApi> = {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : K]: CreatedModelUnitValue<Api[K]>;
};

export interface CreatedModelMeta<T extends Model<any, any>> {
  changed: EventCallable<void>;
  handle: ReactModelHandle<T>;
  ownedModel: T;
  ownedId: string;
}

export type CreatedModelInput<T extends Model<any, any>> = {
  [reactCreatedModelMeta]: CreatedModelMeta<T>;
};

export type CreatedModel<T extends Model<any, any>> = CreatedModelApi<
  T['~api']
> & {
  [reactCreatedModelMeta]: CreatedModelMeta<T>;
};

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

type ReactUnitValue<Element> =
  Element extends StoreWritable<any>
    ? StoreValue<Element>
    : Element extends Store<any>
      ? StoreValue<Element>
      : Element extends Event<any> | EventCallable<any> | Effect<any, any, any>
        ? UnitHandler<Element>
        : Element extends Model<any, any>
          ? Array<ReactModelEntity<Element>>
          : Element extends CreatedModel<infer TargetModel>
            ? ReactModelEntity<TargetModel>
            : Element extends Ref<infer Target>
              ? ResolvedRefValue<Target>
              : Element extends ModelApi
                ? ReactViewValue<Element>
                : never;

export type ReactViewValue<Api extends ModelApi> = {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : Api[K] extends Event<any> | EventCallable<any> | Effect<any, any, any>
      ? never
      : NormalizeViewKey<string & K>]: ReactUnitValue<Api[K]>;
} & {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : Api[K] extends Event<any> | EventCallable<any> | Effect<any, any, any>
      ? ViewHandlerName<string & K>
      : never]: UnitHandler<Api[K]>;
};

export type ReactModelValue<Api extends ModelApi> = ReactViewValue<Api>;

export type ReactModelEntity<T extends Model<any, any>> = {
  id: string;
} & ReactViewValue<T['~api']>;

export type ReactNestedValue<Api extends ModelApi> = ReactViewValue<Api>;

export type ReactNestedEntity<T extends Model<any, any>> = {
  id: string;
} & ReactViewValue<T['~api']>;

type ComponentUnitValue<Element> =
  Element extends StoreWritable<any>
    ? StoreValue<Element>
    : Element extends Store<any>
      ? StoreValue<Element>
      : Element extends Model<any, any>
        ? Array<ComponentViewEntity<Element>>
        : Element extends CreatedModel<infer TargetModel>
          ? ComponentViewEntity<TargetModel>
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
            : Element extends ModelApi
              ? ComponentViewValue<Element>
              : never;

export type ComponentViewValue<Api extends ModelApi> = {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : Api[K] extends Event<any> | EventCallable<any> | Effect<any, any, any>
      ? never
      : NormalizeViewKey<string & K>]: ComponentUnitValue<Api[K]>;
} & {
  [K in keyof Api as K extends `$$${string}`
    ? never
    : Api[K] extends Event<any> | EventCallable<any> | Effect<any, any, any>
      ? ViewHandlerName<string & K>
      : never]: UnitHandler<Api[K]>;
};

export type ComponentViewEntity<T extends Model<any, any>> = {
  id: string;
} & ComponentViewValue<T['~api']>;

export type ComponentViewEntityFromApi<Api extends ModelApi> = {
  id: string;
} & ComponentViewValue<Api>;

export interface UseModelOptions<
  T extends Model<any, any>,
  Mounted extends object = {},
> {
  data?: Partial<ContractData<T['~contract']>>;
  id?: string;
  mounted?: Mounted;
  retain?: boolean;
  scope?: Scope;
}

export interface ComponentCreateOptions {
  id?: string;
  scope?: Scope | undefined;
}

export interface ComponentConfig<
  Input extends ContractInput,
  Api extends ModelApi,
  Mounted extends object | void = void,
> {
  contract: Input;
  model: (
    api: ContractApi<InferContract<Input>>,
    mounted: Event<Mounted>,
    unmounted: Event<void>,
  ) => Api;
  view: (props: ComponentViewEntityFromApi<Api>) => ReactNode;
}

export type ComponentProps<
  T extends Model<any, any>,
  Mounted extends object | void = void,
> = Partial<ContractData<T['~contract']>> &
  MountedProps<Mounted> & {
    model?: ReactModelHandle<T> | CreatedModelInput<T>;
  };

export type ModelComponent<
  T extends Model<any, any>,
  Mounted extends object | void = void,
> = ((props: ComponentProps<T, Mounted>) => ReactNode) & {
  create(
    data?: Partial<ContractData<T['~contract']>>,
    options?: ComponentCreateOptions,
  ): CreatedModel<T>;
  model: T;
};
