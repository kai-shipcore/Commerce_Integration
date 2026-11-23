// Turns the Sync job's `result.workbench` (the container push to Coverland
// Workbench) and `result.workbenchSalesRates` (the sales rate push) into the
// messages shown when a Sync finishes. Pure, so the wording and thresholds are
// testable without a browser.

type Pick = (ko: string, en: string) => string;

export type WorkbenchPushNotice = {
  level: "success" | "info" | "warning" | "error";
  message: string;
  description?: string;
};

const MAX_ERROR_SHOWN = 240;

/** null when there is nothing worth saying, including a push that is simply not configured. */
export function workbenchPushNotice(value: unknown, pick: Pick): WorkbenchPushNotice | null {
  if (!value || typeof value !== "object") return null;
  const push = value as Record<string, unknown>;
  const count = (key: string) => (typeof push[key] === "number" ? (push[key] as number) : 0);
  const created = count("created");
  const updated = count("updated");
  const unchanged = count("unchanged");
  const failed = count("failed");
  const skipped = count("skipped");
  const missingSkus = count("missingSkuCount");
  // The usual reason containers fail: SKUs Workbench has no master product for.
  const missingNote = missingSkus > 0
    ? pick(` Workbench에 없는 SKU ${missingSkus.toLocaleString()}개.`, ` ${missingSkus.toLocaleString()} SKUs are not in Workbench.`)
    : "";
  const historyNote = pick(" 자세한 내용은 동기화 이력에서 확인하세요.", " See Sync History for details.");

  const counts = (): string => {
    const ko = [`신규 ${created}`, `변경 ${updated}`, `동일 ${unchanged}`];
    const en = [`${created} new`, `${updated} updated`, `${unchanged} unchanged`];
    if (failed > 0) { ko.push(`실패 ${failed}`); en.push(`${failed} failed`); }
    if (skipped > 0) { ko.push(`제외 ${skipped}`); en.push(`${skipped} not sent`); }
    return pick(ko.join(" · "), en.join(" · "));
  };

  switch (push.status) {
    case "succeeded":
      return created + updated > 0
        ? { level: "success", message: pick("Workbench 컨테이너 반영 완료", "Workbench containers updated"), description: counts() }
        : { level: "info", message: pick("Workbench: 바뀐 컨테이너 없음", "Workbench: no container changes"), description: counts() };
    case "partial":
      return {
        level: "warning",
        message: pick("Workbench 일부 컨테이너 실패", "Some Workbench containers failed"),
        description: `${counts()}.${missingNote}${historyNote}`,
      };
    case "failed": {
      // A failure that is not about containers (key, outage) says so in errors;
      // otherwise every container was rejected, usually for missing SKUs.
      const errors = Array.isArray(push.errors) ? push.errors : [];
      const first = typeof errors[0] === "string" ? errors[0] : "";
      const description = first
        ? (first.length > MAX_ERROR_SHOWN ? `${first.slice(0, MAX_ERROR_SHOWN)}…` : first)
        : `${counts()}.${missingNote}${historyNote}`;
      return { level: "error", message: pick("Workbench 전송 실패", "Workbench push failed"), description };
    }
    case "skipped": {
      const reason = typeof push.reason === "string" ? push.reason : "";
      // Not configured on this server: expected, not news.
      if (reason.includes("is not set")) return null;
      return { level: "warning", message: pick("Workbench 전송을 건너뛰었습니다", "Workbench push skipped"), description: reason || undefined };
    }
    default:
      return null;
  }
}

/** The sales rate push's message; null when there is nothing worth saying, including a push that is simply not configured. */
export function workbenchSalesRateNotice(value: unknown, pick: Pick): WorkbenchPushNotice | null {
  if (!value || typeof value !== "object") return null;
  const push = value as Record<string, unknown>;
  const count = (key: string) => (typeof push[key] === "number" ? (push[key] as number) : 0);
  const sent = count("sent");
  const changed = count("changed");
  const failed = count("failed");
  const notSent = count("unknownSkuCount") + count("draftSkuCount");
  const historyNote = pick(" 자세한 내용은 동기화 이력에서 확인하세요.", " See Sync History for details.");

  const counts = (): string => {
    const ko = [`전송 ${sent.toLocaleString()}`, `변경 ${changed.toLocaleString()}`];
    const en = [`${sent.toLocaleString()} sent`, `${changed.toLocaleString()} changed`];
    if (notSent > 0) {
      ko.push(`Workbench에 없거나 Draft인 SKU ${notSent.toLocaleString()}`);
      en.push(`${notSent.toLocaleString()} SKUs missing or draft in Workbench`);
    }
    if (failed > 0) { ko.push(`실패 ${failed.toLocaleString()}`); en.push(`${failed.toLocaleString()} failed`); }
    return pick(ko.join(" · "), en.join(" · "));
  };

  switch (push.status) {
    case "succeeded":
      return changed > 0
        ? { level: "success", message: pick("Workbench 판매율 반영 완료", "Workbench sales rates updated"), description: counts() }
        : { level: "info", message: pick("Workbench: 바뀐 판매율 없음", "Workbench: no sales rate changes"), description: counts() };
    case "partial":
      return {
        level: "warning",
        message: pick("Workbench 일부 판매율 실패", "Some Workbench sales rates failed"),
        description: `${counts()}.${historyNote}`,
      };
    case "failed": {
      const errors = Array.isArray(push.errors) ? push.errors : [];
      const first = typeof errors[0] === "string" ? errors[0] : "";
      const description = first
        ? (first.length > MAX_ERROR_SHOWN ? `${first.slice(0, MAX_ERROR_SHOWN)}…` : first)
        : `${counts()}.${historyNote}`;
      return { level: "error", message: pick("Workbench 판매율 전송 실패", "Workbench sales rate push failed"), description };
    }
    case "skipped": {
      const reason = typeof push.reason === "string" ? push.reason : "";
      // Not configured on this server: expected, not news.
      if (reason.includes("is not set")) return null;
      return { level: "warning", message: pick("Workbench 판매율 전송을 건너뛰었습니다", "Workbench sales rate push skipped"), description: reason || undefined };
    }
    default:
      return null;
  }
}
