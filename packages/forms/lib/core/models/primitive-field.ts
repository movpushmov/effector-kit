import { model } from "@effector-kit/models";
import { fieldContract } from "./field-contract";
import { combine, sample } from "effector";
import { readonly } from "../utils";

export const primitiveFieldModel = model({
  contract: fieldContract<{ Value: unknown; Meta: object }>(),
  fn({
    $outerError,
    $innerError,

    $focused,
    $meta,
    $valid,
    $value,

    change,
    changed,

    changeError,
    changeInnerError,
    errorChanged,

    changeMeta,
    metaChanged,

    blur,
    blurred,

    focus,
    focused,

    reset,
  }) {
    const $error = combine(
      $outerError,
      $innerError,
      (outer, inner) => inner ?? outer ?? null,
    );

    sample({ clock: change, target: $value });
    sample({ clock: $value, target: changed });

    sample({ clock: reset, target: $value.reinit });

    sample({ clock: changeError, target: $outerError });
    sample({ clock: changeInnerError, target: $innerError });
    sample({ clock: $error, target: errorChanged });

    sample({ clock: changeMeta, target: $meta });
    sample({ clock: $meta, target: metaChanged });

    sample({ clock: focus, fn: () => true, target: $focused });
    sample({ clock: $focused, filter: Boolean, target: focused });

    sample({ clock: blur, fn: () => false, target: $focused });
    sample({ clock: $focused, filter: (v) => !v, target: blurred });

    return {
      $error,
      $focused,
      $meta,
      $valid,
      $value,

      change,
      changed: readonly(changed),

      changeError,
      errorChanged: readonly(errorChanged),

      changeMeta,
      metaChanged: readonly(metaChanged),

      blur,
      blurred: readonly(blurred),

      focus,
      focused: readonly(focused),

      reset,
    };
  },
});
