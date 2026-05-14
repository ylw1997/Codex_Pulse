
<div align="center">

<img src="https://github.com/ylw1997/Codex_Pulse/blob/main/logo.png?raw=true" width="200" height="200" alt="TouchFish Logo">

Realtime-first Codex quota status for the VS Code status bar.

</div>





# Codex Pulse

Codex Pulse shows your current Codex quota windows directly in VS Code:

- 5-hour quota
- weekly quota
- plan type
- reset times
- data source: realtime app-server or session fallback
- diagnostics when realtime quota cannot be read

<div align="center">

<img width="2079" height="1503" alt="image" src="https://github.com/user-attachments/assets/2e757a15-ad6f-4280-a662-8e8521b42f0a" />


</div>


## Why

Existing quota status extensions can silently fall back to stale local session data. Codex Pulse makes the data source visible and tries realtime quota first, so an old value does not pretend to be fresh.

## How It Reads Quota

1. Starts the local Codex executable with `codex app-server --listen stdio://`.
2. Calls `account/rateLimits/read`.
3. Displays realtime quota when available.
4. Falls back to the newest `~/.codex/sessions/**/*.jsonl` quota event if realtime reading fails.

Codex Pulse does not read `auth.json`, API keys, or token files.

## Settings

- `codexPulse.codexCommand`: path to the Codex executable. Leave empty to auto-detect common locations.
- `codexPulse.codexHome`: path to the Codex home directory. Leave empty to use `~/.codex`.
- `codexPulse.refreshIntervalSeconds`: realtime refresh interval. Defaults to `60`.
- `codexPulse.displayMode`: `remaining` or `used`. Defaults to `remaining`.

On Windows, Codex Pulse auto-detects:

```text
C:\Users\<you>\AppData\Local\OpenAI\Codex\bin\codex.exe
```

## Commands

- `Codex Pulse: Refresh`
- `Codex Pulse: Show Diagnostics`

## Development

Run tests:

```bash
node --test test/*.test.js
```

Package with `vsce` when available:

```bash
vsce package
```

## License

MIT
