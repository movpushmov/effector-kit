import { contract, define } from "@effector-kit/models";
import { FieldError } from "./types";

const valueGeneric = define.generic<"Value">();
const metaGeneric = define.generic<"Meta">();

export const fieldContract = contract({
  $value: define.store(valueGeneric, null),
  $meta: define.store(metaGeneric, {}),
  $valid: define.store(define.static<boolean>(), true),
  $focused: define.store(define.static<boolean>(), true),

  $validationRules: define.store(define.generic)

  $outerError: define.store(define.static<FieldError>(), null),
  $innerError: define.store(define.static<FieldError>(), null),

  change: define.event(valueGeneric),
  changed: define.event(valueGeneric),

  changeMeta: define.event(metaGeneric),
  metaChanged: define.event(metaGeneric),

  changeError: define.event(define.static<FieldError>()),
  changeInnerError: define.event(define.static<FieldError>()),
  errorChanged: define.event(define.static<FieldError>()),

  reset: define.event(define.static<void>()),

  blur: define.event(define.static<void>()),
  blurred: define.event(define.static<void>()),

  focus: define.event(define.static<void>()),
  focused: define.event(define.static<void>()),
});
