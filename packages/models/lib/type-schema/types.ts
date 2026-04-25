export interface TSchema {}

export interface TStatic<T> extends TSchema {
  '~kind': 'typed';
  '~type': T;
}

export interface TNumber extends TStatic<number> {}
export interface TString extends TStatic<string> {}
export interface TBoolean extends TStatic<boolean> {}
export interface TNull extends TStatic<null> {}
export interface TVoid extends TStatic<void> {}

export interface TRef<Name extends string> extends TSchema {
  '~kind': 'ref';
  '~globals': Record<string, unknown>;
  '~type': this['~globals'][Name];
}

export interface TArray<Item extends TSchema> extends TSchema {
  '~kind': 'array';
  '~item': Item;
}

export interface TEnum<Values extends string[]> extends TSchema {
  '~kind': 'enum';
  '~values': Values;
}

export interface TRecord<
  Key extends string,
  Value extends TSchema,
> extends TSchema {
  '~kind': 'record';
  '~key': Key;
  '~value': Value;
}

export type TObject<Shape extends Record<string, TSchema>> = TSchema & {
  '~kind': 'object';
  '~shape': Shape;
};

export type TUnion<Variants extends TSchema[]> = TSchema & {
  '~kind': 'union';
  '~variants': Variants;
};

export type TIntersect<Variants extends TSchema[]> = TSchema & {
  '~kind': 'intersect';
  '~variants': Variants;
};

export type TFunction<
  Args extends TSchema[],
  Return extends TSchema,
> = TSchema & {
  '~kind': 'function';
  '~args': Args;
  '~return': Return;
};

export type ExtractRefNames<T extends TSchema> =
  T extends TRef<infer Name>
    ? Name
    : T extends TArray<infer Item>
      ? ExtractRefNames<Item>
      : T extends TRecord<infer _Key, infer Value>
        ? ExtractRefNames<Value>
        : T extends TObject<infer Shape>
          ? ExtractRefNames<Shape[keyof Shape]>
          : T extends TUnion<infer Variants>
            ? ExtractRefNames<Variants[number]>
            : T extends TIntersect<infer Variants>
              ? ExtractRefNames<Variants[number]>
              : T extends TFunction<infer Args, infer Return>
                ? ExtractRefNames<Args[number]> | ExtractRefNames<Return>
                : never;

export type UnsafeTCall<
  T extends TSchema,
  Globals extends Record<string, unknown>,
> =
  T extends TRef<infer _Name>
    ? T & { '~globals': Globals }
    : T extends TArray<infer Item>
      ? TArray<UnsafeTCall<Item, Globals>>
      : T extends TRecord<infer Key, infer Value>
        ? TRecord<Key, UnsafeTCall<Value, Globals>>
        : T extends TObject<infer Shape>
          ? TObject<{
              [K in keyof Shape]: UnsafeTCall<Shape[K], Globals>;
            }>
          : T extends TUnion<infer Variants>
            ? TUnion<
                Variants extends readonly TSchema[]
                  ? {
                      [K in keyof Variants]: UnsafeTCall<Variants[K], Globals>;
                    } extends readonly TSchema[]
                    ? {
                        [K in keyof Variants]: UnsafeTCall<
                          Variants[K],
                          Globals
                        >;
                      }
                    : never
                  : never
              >
            : T extends TIntersect<infer Variants>
              ? TIntersect<
                  Variants extends readonly TSchema[]
                    ? {
                        [K in keyof Variants]: UnsafeTCall<
                          Variants[K],
                          Globals
                        >;
                      } extends readonly TSchema[]
                      ? {
                          [K in keyof Variants]: UnsafeTCall<
                            Variants[K],
                            Globals
                          >;
                        }
                      : never
                    : never
                >
              : T extends TFunction<infer Args, infer Return>
                ? TFunction<
                    Args extends readonly TSchema[]
                      ? {
                          [K in keyof Args]: UnsafeTCall<Args[K], Globals>;
                        } extends readonly TSchema[]
                        ? {
                            [K in keyof Args]: UnsafeTCall<Args[K], Globals>;
                          }
                        : never
                      : never,
                    UnsafeTCall<Return, Globals>
                  >
                : T extends TStatic<any>
                  ? T
                  : T extends TEnum<any>
                    ? T
                    : never;

export type TCall<
  T extends TSchema,
  Globals extends Record<ExtractRefNames<T>, unknown>,
> = UnsafeTCall<T, Globals>;

type ExtractFnArgs<
  Args extends TSchema[],
  Result extends any[] = [],
> = Args extends [infer First extends TSchema, ...infer Rest extends TSchema[]]
  ? ExtractFnArgs<Rest, [...Result, Static<First>]>
  : Result;

export type Static<T extends TSchema> =
  T extends TStatic<infer U>
    ? U
    : T extends TRef<any>
      ? T['~type']
      : T extends TArray<infer Item>
        ? Static<Item>[]
        : T extends TRecord<infer Key, infer Value>
          ? Record<Key, Static<Value>>
          : T extends TObject<infer Shape>
            ? { [K in keyof Shape]: Static<Shape[K]> }
            : T extends TUnion<infer Variants>
              ? Static<Variants[number]>
              : T extends TIntersect<infer Variants>
                ? Static<Variants[number]>
                : T extends TFunction<infer Args, infer Return>
                  ? (...args: ExtractFnArgs<Args>) => Static<Return>
                  : T extends TEnum<infer Values>
                    ? Values[number]
                    : never;
