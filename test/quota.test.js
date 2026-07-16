const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatTooltip,
  formatStatusText,
  normalizeRateLimitResponse,
  parseSessionLine,
} = require("../src/quota");
const { resolveLanguage } = require("../src/i18n");

test("normalizes realtime app-server quota shape", () => {
  const snapshot = normalizeRateLimitResponse({
    rateLimitsByLimitId: {
      codex: {
        planType: "team",
        primary: { usedPercent: 44, windowDurationMins: 300, resetsAt: 1778738110 },
        secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: 1779169730 },
      },
    },
  });

  assert.equal(snapshot.source, "realtime");
  assert.equal(snapshot.planType, "team");
  assert.equal(snapshot.primary.remainingPercent, 56);
  assert.equal(snapshot.primary.label, "5h");
  assert.equal(snapshot.secondary.remainingPercent, 70);
  assert.equal(snapshot.secondary.label, "7d");
});

test("parses session token_count quota events", () => {
  const snapshot = parseSessionLine(JSON.stringify({
    timestamp: "2026-05-14T01:31:21.273Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        plan_type: "team",
        primary: { used_percent: 36, window_minutes: 300, resets_at: 1778738110 },
        secondary: { used_percent: 29, window_minutes: 10080, resets_at: 1779169730 },
      },
    },
  }));

  assert.equal(snapshot.source, "session");
  assert.equal(snapshot.observedAt.toISOString(), "2026-05-14T01:31:21.273Z");
  assert.equal(snapshot.primary.remainingPercent, 64);
  assert.equal(snapshot.secondary.remainingPercent, 71);
});

test("keeps latest unavailable session quota instead of falling back to stale windows", () => {
  const snapshot = parseSessionLine(JSON.stringify({
    timestamp: "2026-05-29T03:05:39.712Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: null,
        secondary: null,
        plan_type: "team",
      },
    },
  }));

  assert.equal(snapshot.source, "session");
  assert.equal(snapshot.planType, "team");
  assert.equal(snapshot.quotaUnavailable, true);
  assert.equal(formatStatusText(snapshot, "remaining", "zh-cn"), "$(warning) Codex quota");
  assert.match(formatTooltip(snapshot, "remaining", new Date("2026-05-29T03:14:38.858Z"), "zh-cn"), /额度窗口暂不可用/);
});

test("normalizes realtime response with null windows as unavailable quota", () => {
  const snapshot = normalizeRateLimitResponse({
    rateLimitsByLimitId: {
      codex: {
        planType: "team",
        primary: null,
        secondary: null,
      },
    },
  });

  assert.equal(snapshot.source, "realtime");
  assert.equal(snapshot.quotaUnavailable, true);
  assert.equal(formatStatusText(snapshot, "remaining", "en"), "$(warning) Codex quota");
  assert.match(formatTooltip(snapshot, "remaining", new Date("2026-05-29T03:14:38.858Z"), "en"), /Quota windows are unavailable/);
});

test("displays a realtime response with only one quota window", () => {
  const snapshot = normalizeRateLimitResponse({
    rateLimits: {
      planType: "team",
      primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1784689881 },
      secondary: null,
    },
  });

  assert.equal(snapshot.quotaUnavailable, undefined);
  assert.equal(snapshot.primary.label, "7d");
  assert.equal(snapshot.secondary, undefined);
  assert.equal(formatStatusText(snapshot, "remaining", "zh-cn"), "$(pulse) Codex 7d 65%");
  assert.match(formatTooltip(snapshot, "remaining", new Date("2026-07-16T01:00:00.000Z"), "zh-cn"), /- 7d: 65% 剩余 \/ 35% 已用/);
});

test("displays a session event with only one quota window", () => {
  const snapshot = parseSessionLine(JSON.stringify({
    timestamp: "2026-07-16T01:00:40.185Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        plan_type: "team",
        primary: { used_percent: 35, window_minutes: 10080, resets_at: 1784689881 },
        secondary: null,
      },
    },
  }));

  assert.equal(snapshot.quotaUnavailable, undefined);
  assert.equal(formatStatusText(snapshot, "used", "en"), "$(pulse) Codex 7d 35%");
});

test("formats status text without used or localized labels", () => {
  const snapshot = normalizeRateLimitResponse({
    rateLimits: {
      primary: { usedPercent: 44, windowDurationMins: 300 },
      secondary: { usedPercent: 30, windowDurationMins: 10080 },
    },
  });

  assert.equal(formatStatusText(snapshot, "remaining", "en"), "$(pulse) Codex 5h 56% · 7d 70%");
  assert.equal(formatStatusText(snapshot, "used", "en"), "$(pulse) Codex 5h 44% · 7d 30%");
  assert.equal(formatStatusText(snapshot, "used", "zh-cn"), "$(pulse) Codex 5h 44% · 7d 30%");
});

test("formats tooltip in English and Chinese based on VS Code language", () => {
  const snapshot = normalizeRateLimitResponse({
    rateLimits: {
      planType: "team",
      primary: { usedPercent: 44, windowDurationMins: 300 },
      secondary: { usedPercent: 30, windowDurationMins: 10080 },
    },
  });
  snapshot.diagnostics = ["Realtime: C:\\Users\\ylwgg\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe"];
  const checkedAt = new Date("2026-05-14T02:00:00.000Z");

  const english = formatTooltip(snapshot, "remaining", checkedAt, "en");
  assert.match(english, /- Source: Codex realtime\n- Plan: team\n- Updated:/);
  assert.match(english, /- 5h: 56% remaining \/ 44% used/);
  assert.match(english, /- Diagnostics path: C:\\Users\\ylwgg\\AppData\\Local\\OpenAI\\Codex\\bin\\codex\.exe/);
  assert.doesNotMatch(english, /Language:/);
  assert.doesNotMatch(english, /Observed:/);
  assert.doesNotMatch(english, /Last checked:/);

  const chinese = formatTooltip(snapshot, "remaining", checkedAt, "zh-cn");
  assert.match(chinese, /- 来源: Codex 实时接口\n- 计划: team\n- 更新时间:/);
  assert.match(chinese, /- 5h: 56% 剩余 \/ 44% 已用/);
  assert.match(chinese, /- 诊断路径: C:\\Users\\ylwgg\\AppData\\Local\\OpenAI\\Codex\\bin\\codex\.exe/);
  assert.doesNotMatch(chinese, /语言:/);
  assert.doesNotMatch(chinese, /观测时间:/);
  assert.doesNotMatch(chinese, /检查时间:/);
});

test("resolves VS Code language to supported locales", () => {
  assert.equal(resolveLanguage("zh-cn"), "zh");
  assert.equal(resolveLanguage("zh-tw"), "zh");
  assert.equal(resolveLanguage("en"), "en");
  assert.equal(resolveLanguage("fr"), "en");
});
