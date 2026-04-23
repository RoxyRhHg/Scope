import assert from "node:assert/strict";

import { decodeSinaPayload } from "../src/core/textEncoding.js";
import { test } from "./harness.js";

test("decodeSinaPayload keeps Chinese stock names readable", () => {
  const source = '[{"code":"600519","name":"贵州茅台","trade":"1409.50"}]';
  const gbkBuffer = Buffer.from(source, "utf8");

  const decoded = decodeSinaPayload(gbkBuffer, "utf8");

  assert.equal(typeof decoded, "string");
  assert.equal(decoded.includes("贵州茅台"), true);
});
