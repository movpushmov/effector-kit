import type { Model } from '../models';
import type {
  ExtractRefNames,
  Static,
  TSchema,
  UnsafeTCall,
} from '../type-schema';

export interface StoreElement<Schema extends TSchema> {
  '~kind': 'store';
  defaultValue: this['~type'];
  '~type': Static<Schema>;
}

export interface EventElement<Schema extends TSchema> {
  '~kind': 'event';
  '~type': Static<Schema>;
}

export type ChildElement<T extends Model<any, any> = any> = {
  '~kind': 'child';
  model: T;
};

export type RefElement<T extends Model<any, any> = any> = {
  '~kind': 'ref';
  model: T;
};

export type ShapeElement = StoreElement<TSchema> | EventElement<TSchema>;

export interface Shape {
  [k: string]: ShapeElement;
}

type ExtractRefNamesFromShape<T extends Shape> = {
  [K in keyof T]: T[K] extends StoreElement<infer Schema extends TSchema>
    ? ExtractRefNames<Schema>
    : T[K] extends EventElement<infer Schema extends TSchema>
      ? ExtractRefNames<Schema>
      : never;
}[keyof T];

export type ExtractGenericsFromShape<T extends Shape> = Record<
  ExtractRefNamesFromShape<T>,
  unknown
>;

export type CallShape<
  T extends Shape,
  Generics extends ExtractGenericsFromShape<T>,
> = {
  [k in keyof T]: T[k] extends StoreElement<infer Schema extends TSchema>
    ? StoreElement<UnsafeTCall<Schema, Generics>>
    : T[k] extends EventElement<infer Schema extends TSchema>
      ? EventElement<UnsafeTCall<Schema, Generics>>
      : T[k];
};

export interface Contract<
  T extends Shape,
  Generics extends ExtractGenericsFromShape<T> = ExtractGenericsFromShape<T>,
> {
  '~kind': 'contract';
  shape: CallShape<T, Generics>;

  withGeneric<NewGenerics extends ExtractGenericsFromShape<T>>(): Contract<
    T,
    NewGenerics
  >;
}
