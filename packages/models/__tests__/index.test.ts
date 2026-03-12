import { describe, expect, test } from "vitest";
import { model, contract, define } from "../lib";
import { allSettled, sample, fork, createEvent } from "effector";

const userModel = model({
  contract: contract({
    name: define.store(define.static<string>(), ""),
    age: define.store(define.static<number>(), 0),
    sex: define.store(define.static<"m" | "f" | null>(), null),

    nameChanged: define.event(define.static<string>()),
    ageChanged: define.event(define.static<number>()),
    sexChanged: define.event(define.static<"m" | "f" | null>()),
  })(),
  fn: ({ name, age, sex, nameChanged, ageChanged, sexChanged }) => {
    sample({
      clock: name,
      target: nameChanged,
    });

    sample({
      clock: age,
      target: ageChanged,
    });

    sample({
      clock: sex,
      target: sexChanged,
    });

    return {
      name,
      age,
      sex,

      nameChanged,
      ageChanged,
      sexChanged,
    };
  },
});

describe("instace storing", () => {
  test("when create event called instace is added in instaces store", async () => {
    const scope = fork();

    await allSettled(userModel.create, {
      scope,
      params: {
        id: "1",
        data: { name: "Edward", age: 21, sex: "m" },
      },
    });

    expect(scope.getState(userModel.$instances)).toStrictEqual({
      1: { name: "Edward", age: 21, sex: "m" },
    });
  });

  test("instance context is passed in runtime and moved between units", async () => {
    const scope = fork();

    const testCalled = createEvent<string>();

    await allSettled(userModel.create, {
      scope,
      params: {
        id: "1",
        data: { name: "Edward", age: 21, sex: "m" },
      },
    });

    sample({
      clock: testCalled,
      target: userModel.lens
        .where(({ id }) => id === "1")
        .first()
        .name.target(),
    });

    expect(scope.getState(userModel.$instances)).toStrictEqual({
      1: { name: "Edward", age: 21, sex: "m" },
    });

    await allSettled(testCalled, {
      scope,
      params: "Dima",
    });

    expect(scope.getState(userModel.$instances)).toStrictEqual({
      1: { name: "Dima", age: 21, sex: "m" },
    });
  });
});
