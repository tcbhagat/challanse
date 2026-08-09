import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { evaluateAudit } from "./npm-audit-policy.mjs";

function readAudit() {
  if (process.argv[2]) {
    return JSON.parse(readFileSync(process.argv[2], "utf8"));
  }

  try {
    return JSON.parse(execFileSync("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch (error) {
    const output = error?.stdout?.toString();
    if (!output) throw error;
    return JSON.parse(output);
  }
}

try {
  const result = evaluateAudit(readAudit());
  if (!result.ok) {
    console.error(`Production dependency audit failed: ${result.reason}`);
    process.exit(1);
  }
  if (result.exceptionUsed) {
    console.warn("Web-only exception: known React Native Metro image-size advisories remain an Android release blocker.");
  } else {
    console.log("Production dependency audit passed with no high or critical findings.");
  }
} catch (error) {
  console.error(`Production dependency audit could not be evaluated: ${error.message}`);
  process.exit(1);
}
