import type {
  ChildElement,
  Contract,
  EventElement,
  ExtractTypeFromElement,
  GenericElement,
  RefElement,
  StaticElement,
  StoreElement,
  TypeElement,
} from "./contracts";
import type { Model } from "./models";

export const define = {
  store<Type extends TypeElement>(
    _: Type,
    defaultValue: [ExtractTypeFromElement<Type>] extends [never]
      ? unknown
      : ExtractTypeFromElement<Type>,
  ): StoreElement & { "~generic": Type } {
    // @ts-expect-error
    return { "~type": "store", defaultValue };
  },

  event<Type extends TypeElement>(
    _: Type,
  ): EventElement & { "~generic": Type } {
    return { "~type": "event" } as EventElement;
  },

  child<T extends Model<any, any>>(model: T): ChildElement<T> {
    return { "~type": "child", model };
  },

  ref<T extends Model<any, any>>(model: T): RefElement<T> {
    return { "~type": "ref", model };
  },

  generic<Name extends string>(): GenericElement & { "~name"?: Name } {
    return { "~type": "generic" };
  },

  static<T>(): StaticElement<T> & { static?: T } {
    return { "~type": "static" };
  },
};
