const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const {
  formatStatusText,
  formatTooltip,
  getDefaultCodexHome,
  readQuotaSnapshot,
} = require("./quota");

let statusBarItem;
let outputChannel;
let refreshTimer;
let fileWatcher;
let refreshInFlight;
let lastSnapshot;
let lastError;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel("Codex Pulse");
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = "Codex Pulse";
  statusBarItem.command = "codexPulse.refresh";
  statusBarItem.text = "$(sync~spin) Codex";
  statusBarItem.tooltip = "Codex Pulse is starting.";
  statusBarItem.show();

  context.subscriptions.push(
    statusBarItem,
    outputChannel,
    vscode.commands.registerCommand("codexPulse.refresh", () => refreshQuota(true)),
    vscode.commands.registerCommand("codexPulse.showDiagnostics", showDiagnostics),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexPulse")) {
        configureTimers(context);
        refreshQuota(true);
      }
    })
  );

  configureTimers(context);
  refreshQuota(false);
}

function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  if (fileWatcher) {
    fileWatcher.dispose();
  }
}

function configureTimers(context) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (fileWatcher) {
    fileWatcher.dispose();
    fileWatcher = undefined;
  }

  const config = getRuntimeConfig();
  const seconds = Math.max(15, Number(config.refreshIntervalSeconds) || 60);
  refreshTimer = setInterval(() => refreshQuota(false), seconds * 1000);

  const sessionsPath = path.join(getDefaultCodexHome(config.codexHome), "sessions");
  if (fs.existsSync(sessionsPath)) {
    fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(sessionsPath, "**/*.jsonl"),
      false,
      false,
      false
    );
    fileWatcher.onDidCreate(() => refreshQuota(false), null, context.subscriptions);
    fileWatcher.onDidChange(() => refreshQuota(false), null, context.subscriptions);
    context.subscriptions.push(fileWatcher);
  }
}

function getRuntimeConfig() {
  const config = vscode.workspace.getConfiguration("codexPulse");
  return {
    codexCommand: config.get("codexCommand", ""),
    codexHome: config.get("codexHome", ""),
    refreshIntervalSeconds: config.get("refreshIntervalSeconds", 60),
    displayMode: config.get("displayMode", "remaining"),
    realtimeTimeoutMs: 12000,
  };
}

async function refreshQuota(manual) {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  if (manual) {
    statusBarItem.text = "$(sync~spin) Codex";
  }

  refreshInFlight = doRefreshQuota();
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}

async function doRefreshQuota() {
  const config = getRuntimeConfig();
  try {
    const snapshot = await readQuotaSnapshot(config);
    lastSnapshot = snapshot;
    lastError = undefined;
    statusBarItem.text = formatStatusText(snapshot, config.displayMode);
    statusBarItem.tooltip = new vscode.MarkdownString([
      formatTooltip(snapshot, config.displayMode),
      "",
      `Last checked: ${new Date().toLocaleString()}`,
      "",
      "Click to refresh. Run **Codex Pulse: Show Diagnostics** for details.",
    ].join("\n"));
    statusBarItem.backgroundColor = snapshot.source === "realtime"
      ? undefined
      : new vscode.ThemeColor("statusBarItem.warningBackground");
    outputChannel.appendLine(`[${new Date().toISOString()}] ${snapshot.source}: ${statusBarItem.text}`);
  } catch (error) {
    lastError = error;
    statusBarItem.text = "$(warning) Codex";
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    statusBarItem.tooltip = `Codex Pulse failed: ${error.message}`;
    outputChannel.appendLine(`[${new Date().toISOString()}] ERROR ${error.stack || error.message}`);
  }
}

function showDiagnostics() {
  outputChannel.show(true);
  outputChannel.appendLine("---- Codex Pulse diagnostics ----");
  outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
  outputChannel.appendLine(`Config: ${JSON.stringify(getRuntimeConfig(), null, 2)}`);
  outputChannel.appendLine(`Last snapshot: ${lastSnapshot ? JSON.stringify(safeSnapshot(lastSnapshot), null, 2) : "none"}`);
  outputChannel.appendLine(`Last error: ${lastError ? lastError.message : "none"}`);
}

function safeSnapshot(snapshot) {
  return {
    source: snapshot.source,
    planType: snapshot.planType,
    primary: snapshot.primary,
    secondary: snapshot.secondary,
    observedAt: snapshot.observedAt,
    sessionFile: snapshot.sessionFile,
    diagnostics: snapshot.diagnostics,
  };
}

module.exports = { activate, deactivate };
