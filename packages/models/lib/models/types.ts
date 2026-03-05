import type {
  Effect,
  Event,
  EventCallable,
  Store,
  StoreValue,
  StoreWritable,
} from "effector";
import type {
  ChildElement,
  Contract,
  EventElement,
  RefElement,
  ShapeElement,
  StoreElement,
} from "../contracts";
import type { Lens } from "../lens";

export type Instances<T extends Contract<any>> = Record<
  string,
  ContractData<T>
>;

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

type ShapeElementData<T extends ShapeElement> = T extends StoreElement
  ? T["~calculatedType"]
  : T extends ChildElement
    ? Record<string, ContractData<T["model"]["~contract"]>>
    : T extends RefElement
      ? ContractData<T["model"]["~contract"]> | null
      : never;

export type ContractData<T extends Contract<any>> = OmitNever<{
  [k in keyof T["shape"]]: ShapeElementData<T["shape"][k]>;
}>;

type ShapeElementApi<T extends ShapeElement> = T extends StoreElement
  ? StoreWritable<T["~calculatedType"]>
  : T extends EventElement
    ? EventCallable<T["~calculatedType"]>
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
  "~contract": T;
  "~api": Api;
  "~fn": (api: ContractApi<T>) => Api;
  "~id": string;

  $instances: Store<Record<string, BaseInstance & ContractData<T>>>;
  create: EventCallable<CreateInstancePayload<T>>;

  lens: Lens<Model<T, Api>>;
}

export interface BaseInstance {
  "~refs": Record<string, string[]>;
  "~children": Record<string, Record<string, unknown>>;
}
