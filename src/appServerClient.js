const { spawn } = require("node:child_process");

class CodexAppServerClient {
  constructor(command) {
    this.command = command;
    this.child = undefined;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  async start(timeoutMs) {
    if (this.child && !this.child.killed) {
      return;
    }

    this.child = spawn(this.command, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", () => {
      // Codex may emit non-fatal startup warnings. Keep stderr out of the UI.
    });
    this.child.on("exit", () => {
      this.child = undefined;
      this.rejectAll(new Error("Codex app-server stopped."));
    });

    await this.request("initialize", {
      clientInfo: {
        name: "codex-pulse",
        title: "Codex Pulse",
        version: "0.0.1",
      },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: [],
      },
    }, timeoutMs);
  }

  async readRateLimits(timeoutMs) {
    await this.start(timeoutMs);
    return this.request("account/rateLimits/read", undefined, timeoutMs);
  }

  request(method, params, timeoutMs) {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running."));
    }

    const id = this.nextId;
    this.nextId += 1;

    const message = { id, method };
    if (params !== undefined) {
      message.params = params;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          const pending = this.pending.get(id);
          this.pending.delete(id);
          pending?.reject(error);
        }
      });
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk.toString("utf8");

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        this.handleMessage(line);
      }
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id === undefined) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Codex app-server request failed."));
      return;
    }

    pending.resolve(message.result);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose() {
    this.rejectAll(new Error("Codex app-server disposed."));
    if (this.child) {
      this.child.kill();
      this.child = undefined;
    }
  }
}

module.exports = { CodexAppServerClient };
