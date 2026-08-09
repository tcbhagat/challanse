const allowedPackages = new Set([
  "@react-native/community-cli-plugin",
  "@react-native/metro-config",
  "@react-native/virtualized-lists",
  "image-size",
  "metro",
  "metro-config",
  "metro-transform-worker",
  "react-native",
  "react-native-worklets",
]);

const allowedAdvisories = new Set([1138808, 1138809]);

export function evaluateAudit(report) {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    return { ok: false, reason: "npm audit output has no vulnerability map" };
  }

  const blocking = Object.entries(vulnerabilities).filter(([, finding]) =>
    ["high", "critical"].includes(finding?.severity),
  );
  if (blocking.length === 0) {
    return { ok: true, exceptionUsed: false };
  }

  for (const [packageName, finding] of blocking) {
    if (!allowedPackages.has(packageName)) {
      return { ok: false, reason: `unapproved high-risk package: ${packageName}` };
    }

    for (const source of finding.via ?? []) {
      if (typeof source === "string") {
        if (!allowedPackages.has(source)) {
          return { ok: false, reason: `unapproved dependency path: ${source}` };
        }
        continue;
      }

      if (!allowedAdvisories.has(source?.source)) {
        return { ok: false, reason: `unapproved advisory: ${source?.source ?? "unknown"}` };
      }
    }
  }

  return { ok: true, exceptionUsed: true };
}
