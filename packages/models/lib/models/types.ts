import type {
  Effect,
  Event,
  EventCallable,
  Store,
  StoreWritable,
} from "effector";
import {
  type ChildElement,
  type Contract,
  type EventElement,
  type RefElement,
  type ShapeElement,
  type StoreElement,
} from "../contracts";
import type { Lens, LensProps } from "../lens";

export type Instances<T extends Contract<any>> = Record<
  string,
  ContractData<T>
>;

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

type ShapeElementData<T extends ShapeElement> = T extends StoreElement
  ? T["~type"]
  : T extends EventElement
    ? never
    : T extends ChildElement<infer K>
      ? Record<string, ContractData<K["~contract"]>>
      : T extends RefElement<infer K>
        ? ContractData<K["~contract"]> | null
        : never;

export type ContractData<T extends Contract<any>> = OmitNever<{
  [k in keyof T["shape"]]: ShapeElementData<T["shape"][k]>;
}>;

type ShapeElementApi<T extends ShapeElement> = T extends StoreElement
  ? StoreWritable<T["~type"]>
  : T extends EventElement
    ? EventCallable<T["~type"]>
    : T extends ChildElement<infer K>
      ? Record<string, ContractApi<K["~contract"]>>
      : T extends RefElement<infer K>
        ? ContractApi<K["~contract"]> | null
        : never;

export type ContractApi<T extends Contract<any>> = OmitNever<{
  [k in keyof T["shape"]]: ShapeElementApi<T["shape"][k]>;
}>;

export type CreateInstancePayload<T extends Contract<any>> = {
  id: string;
  data: ContractData<T>;
};

export type ModelApiElement =
  | StoreWritable<any>
  | EventCallable<any>
  | Event<any>
  | Effect<any, any, any>
  | ModelApi;

export type ModelApi = {
  [k: string]: ModelApiElement;
};

export interface Model<T extends Contract<any>, Api extends ModelApi> {
  "~kind": "model";
  "~contract": T;
  "~api": Api;
  "~fn": (api: ContractApi<T>) => Api;
  "~id": string;

  $instances: Store<Record<string, BaseInstance & ContractData<T>>>;
  create: EventCallable<CreateInstancePayload<T>>;
  delete: EventCallable<string>;

  lens: Lens<Model<T, Api>> & LensProps<Model<T, Api>>;

  static: (data: ContractData<T>) => Api;
}

export interface BaseInstance {
  "~refs": Record<string, Array<{ model: Model<any, any>; id: string }>>;
  "~children": Record<string, Record<string, unknown>>;
}
