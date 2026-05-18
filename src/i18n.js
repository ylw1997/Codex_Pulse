function resolveLanguage(language) {
  const normalized = String(language || "en").toLowerCase();
  return normalized.startsWith("zh") ? "zh" : "en";
}

function getMessages(language) {
  return resolveLanguage(language) === "zh" ? zh : en;
}

const en = {
  languageName: "English",
  starting: "Codex Pulse is starting.",
  source: "Source",
  plan: "Plan",
  updatedAt: "Updated",
  language: "Language",
  realtimeSource: "Codex realtime",
  sessionSource: "Session fallback",
  diagnosticsPath: "Diagnostics path",
  quota: "Quota",
  used: "used",
  remaining: "remaining",
  resetsAt: "resets at",
  clickToRefresh: "Click to refresh. Run **Codex Pulse: Show Diagnostics** for details.",
  failed: "Codex Pulse failed",
  diagnosticsTitle: "---- Codex Pulse diagnostics ----",
  time: "Time",
  config: "Config",
  lastSnapshot: "Last snapshot",
  lastError: "Last error",
  none: "none",
};

const zh = {
  languageName: "中文",
  starting: "Codex Pulse 正在启动。",
  source: "来源",
  plan: "计划",
  updatedAt: "更新时间",
  language: "语言",
  realtimeSource: "Codex 实时接口",
  sessionSource: "本地 session 兜底",
  diagnosticsPath: "诊断路径",
  quota: "额度",
  used: "已用",
  remaining: "剩余",
  resetsAt: "重置时间",
  clickToRefresh: "点击刷新。运行 **Codex Pulse: 显示诊断信息** 查看详情。",
  failed: "Codex Pulse 读取失败",
  diagnosticsTitle: "---- Codex Pulse 诊断信息 ----",
  time: "时间",
  config: "配置",
  lastSnapshot: "最近快照",
  lastError: "最近错误",
  none: "无",
};

module.exports = {
  getMessages,
  resolveLanguage,
};
