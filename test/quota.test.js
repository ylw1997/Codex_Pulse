const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatStatusText,
  normalizeRateLimitResponse,
  parseSessionLine,
} = require("../src/quota");

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

test("formats status text in remaining and used modes", () => {
  const snapshot = normalizeRateLimitResponse({
    rateLimits: {
      primary: { usedPercent: 44, windowDurationMins: 300 },
      secondary: { usedPercent: 30, windowDurationMins: 10080 },
    },
  });

  assert.equal(formatStatusText(snapshot, "remaining"), "$(pulse) Codex 5h 56% · 7d 70%");
  assert.equal(formatStatusText(snapshot, "used"), "$(pulse) Codex 5h used 44% · 7d used 30%");
});
