export type PrimitiveJsonValue =
  | Date
  | null
  | undefined
  | boolean
  | string
  | number;

export type PrimitiveValue =
  | bigint
  | PrimitiveJsonValue
  | Blob
  | ArrayBuffer
  | File;

export type FieldError = string | null;
