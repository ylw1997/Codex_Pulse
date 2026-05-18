const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodexAppServerClient } = require("./appServerClient");
const { getMessages } = require("./i18n");

const SESSION_TAIL_BYTES = 2 * 1024 * 1024;
const SESSION_SCAN_LIMIT = 120;

function getDefaultCodexHome(configuredHome) {
  if (configuredHome && configuredHome.trim()) {
    return expandHome(configuredHome.trim());
  }
  return path.join(os.homedir(), ".codex");
}

function resolveCodexCommand(configuredCommand) {
  if (configuredCommand && configuredCommand.trim()) {
    return expandHome(configuredCommand.trim());
  }

  const localAppCommand = path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin", "codex.exe");
  if (process.platform === "win32" && fs.existsSync(localAppCommand)) {
    return localAppCommand;
  }

  const macCommand = "/Applications/Codex.app/Contents/Resources/codex";
  if (process.platform === "darwin" && fs.existsSync(macCommand)) {
    return macCommand;
  }

  return "codex";
}

async function readQuotaSnapshot(config = {}) {
  const diagnostics = [];
  const command = resolveCodexCommand(config.codexCommand);
  const timeoutMs = Math.max(3000, Number(config.realtimeTimeoutMs || 12000));

  try {
    const client = new CodexAppServerClient(command);
    try {
      const response = await client.readRateLimits(timeoutMs);
      const snapshot = normalizeRateLimitResponse(response);
      snapshot.diagnostics = [`Realtime: ${command}`];
      return snapshot;
    } finally {
      client.dispose();
    }
  } catch (error) {
    diagnostics.push(`Realtime failed: ${error.message}`);
  }

  const sessionSnapshot = readLatestSessionSnapshot(getDefaultCodexHome(config.codexHome));
  if (sessionSnapshot) {
    sessionSnapshot.diagnostics = diagnostics.concat(sessionSnapshot.diagnostics || []);
    return sessionSnapshot;
  }

  const message = diagnostics.length
    ? `Unable to read Codex quota. ${diagnostics.join(" ")}`
    : "Unable to read Codex quota.";
  throw new Error(message);
}

function normalizeRateLimitResponse(response) {
  const limits = response?.rateLimitsByLimitId?.codex || response?.rateLimits;
  if (!limits?.primary || !limits?.secondary) {
    throw new Error("Codex app-server returned no codex rate limits.");
  }

  return {
    source: "realtime",
    planType: limits.planType || limits.plan_type || "unknown",
    primary: normalizeWindow(limits.primary),
    secondary: normalizeWindow(limits.secondary),
    credits: limits.credits,
    rateLimitReachedType: limits.rateLimitReachedType || limits.rate_limit_reached_type || null,
    observedAt: new Date(),
  };
}

function parseSessionLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }

  const limits = event?.payload?.rate_limits;
  if (!limits?.primary || !limits?.secondary) {
    return undefined;
  }

  return {
    source: "session",
    planType: limits.plan_type || limits.planType || "unknown",
    primary: normalizeWindow(limits.primary),
    secondary: normalizeWindow(limits.secondary),
    credits: limits.credits,
    rateLimitReachedType: limits.rate_limit_reached_type || limits.rateLimitReachedType || null,
    observedAt: new Date(Date.parse(event.timestamp) || Date.now()),
  };
}

function readLatestSessionSnapshot(codexHome) {
  const sessionsPath = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsPath)) {
    return undefined;
  }

  const files = listSessionFiles(sessionsPath)
    .map((filePath) => ({ filePath, mtimeMs: safeStat(filePath)?.mtimeMs || 0 }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, SESSION_SCAN_LIMIT);

  for (const file of files) {
    const snapshot = readSessionFileTail(file.filePath);
    if (snapshot) {
      snapshot.sessionFile = file.filePath;
      snapshot.diagnostics = [`Session fallback: ${file.filePath}`];
      return snapshot;
    }
  }

  return undefined;
}

function readSessionFileTail(filePath) {
  const stat = safeStat(filePath);
  if (!stat || stat.size <= 0) {
    return undefined;
  }

  const start = Math.max(0, stat.size - SESSION_TAIL_BYTES);
  const length = stat.size - start;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const snapshot = parseSessionLine(lines[index]);
      if (snapshot) {
        return snapshot;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return undefined;
}

function listSessionFiles(root) {
  const files = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function normalizeWindow(window) {
  const usedPercent = clampPercent(Number(window.usedPercent ?? window.used_percent ?? 0));
  const windowMinutes = Number(window.windowDurationMins ?? window.window_minutes ?? window.windowMinutes ?? 0);
  const resetEpoch = window.resetsAt ?? window.resets_at ?? window.reset_at;
  const resetAt = resetEpoch ? new Date(Number(resetEpoch) * 1000) : undefined;

  return {
    label: formatWindowLabel(windowMinutes),
    windowMinutes,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    resetAt,
  };
}

function formatStatusText(snapshot, displayMode = "remaining", language = "en") {
  if (displayMode === "used") {
    return `$(pulse) Codex ${snapshot.primary.label} ${Math.round(snapshot.primary.usedPercent)}% · ${snapshot.secondary.label} ${Math.round(snapshot.secondary.usedPercent)}%`;
  }

  return `$(pulse) Codex ${snapshot.primary.label} ${Math.round(snapshot.primary.remainingPercent)}% · ${snapshot.secondary.label} ${Math.round(snapshot.secondary.remainingPercent)}%`;
}

function formatTooltip(snapshot, displayMode = "remaining", checkedAt, language = "en") {
  const messages = getMessages(language);
  const modeLabel = displayMode === "used" ? "used" : "remaining";
  return [
    "**Codex Pulse**",
    "",
    `- ${messages.source}: ${snapshot.source === "realtime" ? messages.realtimeSource : messages.sessionSource}`,
    `- ${messages.plan}: ${snapshot.planType}`,
    `- ${messages.updatedAt}: ${formatDate(checkedAt || snapshot.observedAt)}`,
    "",
    `**${messages.quota}**`,
    "",
    formatWindowTooltip(snapshot.primary, modeLabel, messages),
    formatWindowTooltip(snapshot.secondary, modeLabel, messages),
    "",
    ...formatDiagnostics(snapshot.diagnostics, messages),
  ].filter((line) => line !== undefined).join("\n");
}

function formatWindowTooltip(window, modeLabel, messages) {
  const reset = window.resetAt ? formatDate(window.resetAt) : "unknown";
  if (modeLabel === "used") {
    return `- ${window.label}: ${Math.round(window.usedPercent)}% ${messages.used} / ${Math.round(window.remainingPercent)}% ${messages.remaining}, ${messages.resetsAt} ${reset}`;
  }

  return `- ${window.label}: ${Math.round(window.remainingPercent)}% ${messages.remaining} / ${Math.round(window.usedPercent)}% ${messages.used}, ${messages.resetsAt} ${reset}`;
}

function formatDiagnostics(diagnostics, messages) {
  if (!diagnostics?.length) {
    return [];
  }

  return diagnostics.map((item) => {
    const realtimePrefix = "Realtime: ";
    const sessionPrefix = "Session fallback: ";
    if (item.startsWith(realtimePrefix)) {
      return `- ${messages.diagnosticsPath}: ${item.slice(realtimePrefix.length)}`;
    }
    if (item.startsWith(sessionPrefix)) {
      return `- ${messages.diagnosticsPath}: ${item.slice(sessionPrefix.length)}`;
    }
    return `- ${item}`;
  });
}

function formatWindowLabel(windowMinutes) {
  if (windowMinutes === 300) {
    return "5h";
  }
  if (windowMinutes === 10080) {
    return "7d";
  }
  if (windowMinutes && windowMinutes % 60 === 0) {
    return `${windowMinutes / 60}h`;
  }
  return `${windowMinutes || "?"}m`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toLocaleString();
}

function clampPercent(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function expandHome(value) {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

module.exports = {
  formatStatusText,
  formatTooltip,
  getDefaultCodexHome,
  normalizeRateLimitResponse,
  parseSessionLine,
  readLatestSessionSnapshot,
  readQuotaSnapshot,
  resolveCodexCommand,
};
