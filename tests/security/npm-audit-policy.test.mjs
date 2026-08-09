import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAudit } from "../../scripts/npm-audit-policy.mjs";

const knownChain = {
  vulnerabilities: {
    "image-size": {
      severity: "high",
      via: [{ source: 1138808 }, { source: 1138809 }],
    },
    metro: { severity: "high", via: ["image-size"] },
    "react-native": { severity: "high", via: ["@react-native/virtualized-lists"] },
  },
};

test("accepts only the known React Native advisory chain", () => {
  assert.deepEqual(evaluateAudit(knownChain), { ok: true, exceptionUsed: true });
});

test("rejects an additional high-risk package", () => {
  const report = structuredClone(knownChain);
  report.vulnerabilities.hostile = { severity: "critical", via: [] };
  assert.equal(evaluateAudit(report).ok, false);
});

test("rejects a changed advisory identifier", () => {
  const report = structuredClone(knownChain);
  report.vulnerabilities["image-size"].via = [{ source: 9999999 }];
  assert.equal(evaluateAudit(report).ok, false);
});

test("accepts an audit with no high or critical findings", () => {
  assert.deepEqual(evaluateAudit({ vulnerabilities: {} }), { ok: true, exceptionUsed: false });
});
