import assert from "node:assert/strict";
import { getRequestId } from "./request-id.ts";

const generatedRequest = new Request("http://localhost/api/v1/events/demo");
const generatedId = getRequestId(generatedRequest);
assert.equal(getRequestId(generatedRequest), generatedId);
assert.match(generatedId, /^[0-9a-f-]{36}$/);

const suppliedRequest = new Request("http://localhost/api/v1/events/demo", {
  headers: { "x-request-id": "client-request-42" },
});
assert.equal(getRequestId(suppliedRequest), "client-request-42");
assert.equal(getRequestId(suppliedRequest), "client-request-42");

const invalidRequest = new Request("http://localhost/api/v1/events/demo", {
  headers: { "x-request-id": "not valid" },
});
const invalidId = getRequestId(invalidRequest);
assert.match(invalidId, /^[0-9a-f-]{36}$/);
assert.equal(getRequestId(invalidRequest), invalidId);

console.log("request-id stability passed");
