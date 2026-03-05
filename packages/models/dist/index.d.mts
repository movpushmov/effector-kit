import { Effect, Event, EventCallable, Store, StoreValue, StoreWritable } from "effector";

//#region lib/lens/types.d.ts
type WatchableUnitActions<T> = {
  clock(): Event<T>;
};
type TargetableUnitActions<T, Props = never> = WatchableUnitActions<T> & {
  target: [Props] extends [never] ? () => EventCallable<T> : (map: (props: Props) => T) => EventCallable<Props>;
};
type ModelLensElement<Element extends ModelApiElement, Props = never> = Element extends StoreWritable<infer Value> ? TargetableUnitActions<Value, Props> : Element extends Store<infer Value> ? WatchableUnitActions<Value> : Element extends EventCallable<infer Payload> ? TargetableUnitActions<Payload, Props> : Element extends Event<infer Payload> ? WatchableUnitActions<Payload> : Element extends Model<any, any> ? Lens<Element, Props> : never;
type ModelLensApi<InputModel extends Model<any, any>, Props> = { [k in keyof InputModel["~api"]]: ModelLensElement<InputModel["~api"][k], Props> };
type Lens<InputModel extends Model<any, any>, Props = never> = ModelLensApi<InputModel, Props> & {
  getSource(): StoreValue<InputModel["$instances"]>;
  where(predicate: [Props] extends [never] ? (data: ContractData<InputModel["~contract"]>) => boolean : (data: ContractData<InputModel["~contract"]>, props: Props) => boolean): Lens<InputModel, Props>;
  first(): Lens<InputModel, Props>;
  last(): Lens<InputModel, Props>;
};
//#endregion
//#region lib/models/types.d.ts
type Instances<T extends Contract<any>> = Record<string, ContractData<T>>;
type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };
type ShapeElementData<T extends ShapeElement> = T extends StoreElement ? T["~calculatedType"] : T extends ChildElement ? Record<string, ContractData<T["model"]["~contract"]>> : T extends RefElement ? ContractData<T["model"]["~contract"]> | null : never;
type ContractData<T extends Contract<any>> = OmitNever<{ [k in keyof T["shape"]]: ShapeElementData<T["shape"][k]> }>;
type ShapeElementApi<T extends ShapeElement> = T extends StoreElement ? StoreWritable<T["~calculatedType"]> : T extends EventElement ? EventCallable<T["~calculatedType"]> : T extends ChildElement<infer K> ? Record<string, ContractApi<K["~contract"]>> : T extends RefElement<infer K> ? ContractApi<K["~contract"]> | null : never;
type ContractApi<T extends Contract<any>> = OmitNever<{ [k in keyof T["shape"]]: ShapeElementApi<T["shape"][k]> }>;
type CreateInstancePayload<T extends Contract<any>> = {
  id: string;
  data: ContractData<T>;
};
type ModelApiElement = StoreWritable<any> | EventCallable<any> | Event<any> | Effect<any, any, any> | ModelApi;
type ModelApi = {
  [k: string]: ModelApiElement;
};
interface Model<T extends Contract<any>, Api extends ModelApi> {
  "~contract": T;
  "~api": Api;
  "~fn": (api: ContractApi<T>) => Api;
  "~id": string;
  $instances: Store<Record<string, BaseInstance & ContractData<T>>>;
  create: EventCallable<CreateInstancePayload<T>>;
  lens: Lens<Model<T, Api>>;
}
interface BaseInstance {
  "~refs": Record<string, string[]>;
  "~children": Record<string, Record<string, unknown>>;
}
//#endregion
//#region lib/models/models.d.ts
interface ModelOptions<T extends Contract<any>, Api extends ModelApi> {
  contract: T;
  fn: (api: ContractApi<T>) => Api;
  instances?: StoreWritable<Instances<T>>;
}
declare function model<T extends Contract<any>, Api extends ModelApi>({
  contract,
  fn,
  instances
}: ModelOptions<T, Api>): Model<T, Api>;
//#endregion
//#region lib/contracts/types.d.ts
type GenericsMap = Record<string, any>;
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
interface StoreElement {
  "~type": "store";
  defaultValue: this["~calculatedType"];
  "~generic": GenericElement;
  "~generics": GenericsMap;
  "~calculatedType": this["~generics"][NonNullable<this["~generic"]["~name"]>];
}
interface EventElement {
  "~type": "event";
  "~generic": GenericElement;
  "~generics": GenericsMap;
  "~calculatedType": this["~generics"][NonNullable<this["~generic"]["~name"]>];
}
type ChildElement<T extends Model<any, any> = any> = {
  "~type": "child";
  model: T;
};
type RefElement<T extends Model<any, any> = any> = {
  "~type": "ref";
  model: T;
};
type GenericElement = {
  "~type": "generic";
  "~name"?: string;
};
type StaticElement<T = any> = {
  "~type": "static";
  "~static"?: T;
};
type TypeElement = GenericElement | StaticElement<any>;
type ExtractTypeFromElement<T extends TypeElement, Generic = never> = T extends GenericElement ? Generic : T extends StaticElement<infer U> ? U : never;
type ShapeElement = StoreElement | EventElement;
interface Shape {
  [k: string]: ShapeElement;
}
type ExtractGenericsFromShape<T extends Shape> = UnionToIntersection<{ [k in keyof T]: [T[k]["~generic"]] extends [StaticElement<any>] ? never : [T[k]["~generic"]] extends [never] ? never : T[k]["~generic"] extends GenericElement ? { [name in NonNullable<T[k]["~generic"]["~name"]>]: unknown } : never }[keyof T]>;
interface Contract<T extends Shape, Generics extends ExtractGenericsFromShape<T> = ExtractGenericsFromShape<T>> {
  "~type": "contract";
  shape: { [k in keyof T]: T[k] & {
    "~generics"?: Generics;
  } };
}
//#endregion
//#region lib/contracts/contracts.d.ts
declare function contract$1<T extends Shape>(shape: T): <K extends ExtractGenericsFromShape<T>>() => Contract<T, K> & {
  "~generic"?: K;
};
//#endregion
//#region lib/define.d.ts
declare const define: {
  store<Type extends TypeElement>(_: Type, defaultValue: [ExtractTypeFromElement<Type>] extends [never] ? unknown : ExtractTypeFromElement<Type>): StoreElement & {
    "~generic": Type;
  };
  event<Type extends TypeElement>(_: Type): EventElement & {
    "~generic": Type;
  };
  child<T extends Model<any, any>>(model: T): ChildElement<T>;
  ref<T extends Model<any, any>>(model: T): RefElement<T>;
  generic<Name extends string>(): GenericElement & {
    "~name"?: Name;
  };
  static<T>(): StaticElement<T> & {
    static?: T;
  };
};
//#endregion
//#region lib/ref/types.d.ts
interface Ref<T extends Model<any, any>> {
  "~type": "ref";
  lens: Lens<T>;
}
//#endregion
//#region lib/ref/ref.d.ts
declare function ref<T extends Model<any, any>>(model: T): Ref<T>;
//#endregion
//#region lib/child/child.d.ts
declare function child<T extends Model<any, any>, ModelContract extends Contract<any> = (T extends Model<infer C, any> ? C : never)>(inputModel: T): T;
//#endregion
export { type ContractApi, type ContractData, type Lens, type Model, type ModelApi, type Ref, child, contract$1 as contract, define, model, ref };
//# sourceMappingURL=index.d.mts.map