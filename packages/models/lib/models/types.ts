import type {
  Effect,
  Event,
  EventCallable,
  Node,
  Store,
  StoreWritable,
} from 'effector';
import {
  type ChildElement,
  type Contract,
  type EventElement,
  type RefElement,
  type ShapeElement,
  type StoreElement,
} from '../contracts';
import type { Lens, LensInputModel, LensProps } from '../lens';
import type { Ref } from '../ref';

export type Instances<T extends Contract<any>> = Record<
  string,
  ContractData<T>
>;

export type Aliases = Record<string, string>;

export type AddAliasPayload =
  | string
  | {
      aliasId: string;
      instanceId?: string;
    };

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

type ShapeElementData<T extends ShapeElement> =
  T extends StoreElement<any>
    ? T['~type']
    : T extends EventElement<any>
      ? never
      : T extends ChildElement<infer K>
        ? Record<string, ContractData<K['~contract']>>
        : T extends RefElement<infer K>
          ? ContractData<K['~contract']> | null
          : never;

export type ContractData<T extends Contract<any>> = OmitNever<{
  [k in keyof T['shape']]: ShapeElementData<T['shape'][k]>;
}>;

type ShapeElementApi<T extends ShapeElement> =
  T extends StoreElement<any>
    ? StoreWritable<T['~type']>
    : T extends EventElement<any>
      ? EventCallable<T['~type']>
      : T extends ChildElement<infer K>
        ? Record<string, ContractApi<K['~contract']>>
        : T extends RefElement<infer K>
          ? ContractApi<K['~contract']> | null
          : never;

export type ContractApi<T extends Contract<any>> = OmitNever<{
  [k in keyof T['shape']]: ShapeElementApi<T['shape'][k]>;
}>;

export type CreateInstancePayload<T extends Contract<any>> = {
  id: string;
  data: ContractData<T>;
};

export type ModelApiElement =
  | StoreWritable<any>
  | EventCallable<any>
  | Store<any>
  | Event<any>
  | Effect<any, any, any>
  | Model<any, any>
  | Ref<any>
  | ModelApi;

export type ModelApi = {
  [k: string]: ModelApiElement;
};

type ModelLensTarget<
  T extends Contract<any>,
  Api extends ModelApi,
> = LensInputModel<T, Api, Record<string, BaseInstance & ContractData<T>>>;

export interface Model<T extends Contract<any>, Api extends ModelApi> {
  '~kind': 'model';
  '~contract': T;
  '~api': Api;
  '~fn': (api: ContractApi<T>) => Api;
  '~id': string;
  '~region': Node;

  $instances: Store<Record<string, BaseInstance & ContractData<T>>>;
  $aliases: Store<Aliases>;
  create: EventCallable<CreateInstancePayload<T> | CreateInstancePayload<T>[]>;
  delete: EventCallable<string | string[]>;
  addAlias: EventCallable<AddAliasPayload | AddAliasPayload[]>;
  removeAlias: EventCallable<string | string[]>;

  lens: Lens<ModelLensTarget<T, Api>> & LensProps<ModelLensTarget<T, Api>>;

  static: (data: ContractData<T>) => Api;
}

export interface BaseInstance {
  '~refs': Record<string, Array<{ model: Model<any, any>; id: string }>>;
  '~children': Record<string, Record<string, unknown>>;
  '~childAliases': Record<string, Aliases>;
}
