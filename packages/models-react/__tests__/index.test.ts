import { describe, expect, it } from "vitest";

import * as modelsReact from "../lib";

describe("@effector-kit/models-react", () => {
  it("does not re-export core @effector-kit/models API", () => {
    expect(modelsReact).not.toHaveProperty("model");
    expect(modelsReact).not.toHaveProperty("contract");
    expect(modelsReact).not.toHaveProperty("define");
  });
});
