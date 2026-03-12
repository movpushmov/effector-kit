import type { HKT } from "../hkt";
import type {
  ChildElement,
  EventElement,
  ExtractTypeFromElement,
  GenericElement,
  RefElement,
  StaticElement,
  StoreElement,
  TypeElement,
} from "./contracts";
import type { TypeElementHKT } from "./contracts/types";
import type { Model } from "./models";

export const define = {
  store<Type extends TypeElement>(
    _: Type,
    storeValue: [ExtractTypeFromElement<Type>] extends [never]
      ? unknown
      : ExtractTypeFromElement<Type>,
  ): HKT.WithParameter<StoreElement, TypeElementHKT, Type> {
    // @ts-expect-error
    return { "~kind": "store", defaultValue: storeValue };
  },

  event<Type extends TypeElement>(
    _: Type,
  ): HKT.WithParameter<EventElement, TypeElementHKT, Type> {
    // @ts-expect-error
    return { "~kind": "event" };
  },

  child<T extends Model<any, any>>(model: T): ChildElement<T> {
    return { "~kind": "child", model };
  },

  ref<T extends Model<any, any>>(model: T): RefElement<T> {
    return { "~kind": "ref", model };
  },

  generic<Name extends string>(): GenericElement & { "~name"?: Name } {
    return { "~kind": "generic" };
  },

  static<T>(): StaticElement<T> {
    return { "~kind": "static" };
  },
};
