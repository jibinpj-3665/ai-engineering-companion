const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const net = require("net");
const { spawn, execFileSync } = require("child_process");

const DEV_SERVER = process.env.AEC_DEV_SERVER || "";
const isDev = Boolean(DEV_SERVER);
const APP_ID = "com.jibinpj.aiengineeringcompanion";

function remoteServer() {
  const raw = (process.env.AEC_REMOTE_URL || "").trim();
  if (!raw) return "";
  const parsed = new URL(raw);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("AEC_REMOTE_URL must be an http(s) URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("AEC_REMOTE_URL must not contain credentials.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !local) {
    throw new Error("AEC_REMOTE_URL must use HTTPS for a remote server.");
  }
  return parsed.toString().replace(/\/$/, "");
}

let REMOTE_URL = "";
let remoteError = "";
try {
  REMOTE_URL = remoteServer();
} catch (error) {
  remoteError = error instanceof Error ? error.message : String(error);
}

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendPort = 8765;
let quitting = false;
let logStream = null;

app.setAppUserModelId(APP_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function dataDirectory() {
  if (process.env.AIEC_DATA_DIR) return process.env.AIEC_DATA_DIR;
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || app.getPath("userData");
  return path.join(base, "AIEngineeringCompanion");
}

function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    if (!logStream) {
      const dir = path.join(dataDirectory(), "logs");
      fs.mkdirSync(dir, { recursive: true });
      logStream = fs.createWriteStream(path.join(dir, "electron.log"), { flags: "a" });
    }
    logStream.write(line);
  } catch {
    /* logging must never crash startup */
  }
  if (isDev) console.log(line.trim());
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 8765;
      server.close(() => resolve(port));
    });
  });
}

function backendExecutable() {
  return path.join(process.resourcesPath, "backend", "ai-engineering-companion-backend.exe");
}

function spawnBackend(port) {
  const executable = backendExecutable();
  if (!fs.existsSync(executable)) {
    throw new Error(`The packaged backend was not found at:\n${executable}\n\nRun "npm run build:backend" before packaging.`);
  }
  logLine(`Starting backend: ${executable} on port ${port}`);
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AEC_PORT: String(port),
      PYTHONUNBUFFERED: "1",
    },
  });
  child.stdout.on("data", (chunk) => logLine(`[backend] ${String(chunk).trimEnd()}`));
  child.stderr.on("data", (chunk) => logLine(`[backend:err] ${String(chunk).trimEnd()}`));
  child.on("exit", (code, signal) => logLine(`Backend exited code=${code} signal=${signal}`));
  return child;
}

function probeHealth(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1500 }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(response.statusCode === 200 && body.includes("ok")));
    });
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.on("error", () => resolve(false));
  });
}

async function waitForBackend(port, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (backendProcess && backendProcess.exitCode !== null) {
      throw new Error(`The local backend stopped unexpectedly (exit code ${backendProcess.exitCode}). See logs in ${path.join(dataDirectory(), "logs")}.`);
    }
    if (await probeHealth(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The local backend did not become ready in time. Antivirus software or a blocked port may be preventing startup.");
}

async function ensureBackend() {
  if (REMOTE_URL) {
    logLine(`Remote server mode: ${new URL(REMOTE_URL).origin} (no local backend started)`);
    return REMOTE_URL;
  }
  if (isDev) {
    backendPort = 8765;
    await waitForBackend(backendPort, 30000);
    return `http://127.0.0.1:${backendPort}`;
  }

  if (!app.isPackaged) {
    if (await probeHealth(8765)) {
      backendPort = 8765;
      logLine("Using an already-running development backend on port 8765");
      return `http://127.0.0.1:${backendPort}`;
    }
    const python = path.join(__dirname, "..", "backend", ".venv", "Scripts", "python.exe");
    const runner = path.join(__dirname, "..", "backend", "run.py");
    if (fs.existsSync(python) && fs.existsSync(runner)) {
      if (!fs.existsSync(path.join(__dirname, "..", "frontend", "dist", "index.html"))) {
        throw new Error("The frontend has not been built yet. Run \"npm run build:frontend\" first.");
      }
      backendPort = 8765;
      logLine("Starting development backend with the local Python environment");
      backendProcess = spawn(python, [runner], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AEC_PORT: String(backendPort), PYTHONUNBUFFERED: "1" },
      });
      backendProcess.stdout.on("data", (chunk) => logLine(`[backend] ${String(chunk).trimEnd()}`));
      backendProcess.stderr.on("data", (chunk) => logLine(`[backend:err] ${String(chunk).trimEnd()}`));
      backendProcess.on("exit", (code, signal) => logLine(`Backend exited code=${code} signal=${signal}`));
      await waitForBackend(backendPort, 40000);
      return `http://127.0.0.1:${backendPort}`;
    }
  }

  backendPort = await findFreePort();
  backendProcess = spawnBackend(backendPort);
  await waitForBackend(backendPort);
  return `http://127.0.0.1:${backendPort}`;
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 560,
    height: 360,
    frame: false,
    resizable: false,
    movable: true,
    show: true,
    backgroundColor: "#070a16",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashWindow.loadFile(path.join(__dirname, "..", "assets", "splash.html"));
  splashWindow.on("closed", () => { splashWindow = null; });
}

function showStartupError(message) {
  logLine(`Startup failure: ${message}`);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.loadFile(path.join(__dirname, "..", "assets", "splash.html"), { query: { error: message } });
  }
  dialog.showErrorBox("AI Engineering Companion could not start", message);
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: "#070a16",
    autoHideMenuBar: true,
    title: "AI Engineering Companion",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") shell.openExternal(target);
    } catch {
      /* ignore invalid urls */
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    let allowed = false;
    try {
      allowed = new URL(target).origin === new URL(url).origin;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      event.preventDefault();
      try {
        const parsed = new URL(target);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") shell.openExternal(target);
      } catch {
        /* ignore */
      }
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(url);
}

function stopBackend() {
  if (!backendProcess) return;
  const pid = backendProcess.pid;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      backendProcess.kill("SIGTERM");
    }
  } catch {
    try { backendProcess.kill(); } catch { /* already gone */ }
  }
  backendProcess = null;
}

function registerIpc() {
  ipcMain.handle("aec:info", () => ({
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    packaged: app.isPackaged,
    remote: Boolean(REMOTE_URL),
  }));
  ipcMain.handle("aec:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: "Choose a syllabus folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("aec:open-data", async () => {
    const dir = dataDirectory();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle("aec:open-external", async (_event, url) => {
    if (typeof url !== "string") return false;
    const parsed = new URL(url);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return false;
    await shell.openExternal(url);
    return true;
  });
}

app.on("before-quit", () => {
  quitting = true;
  stopBackend();
});

process.on("exit", stopBackend);

app.whenReady().then(async () => {
  if (!gotLock) return;
  registerIpc();
  if (!isDev) Menu.setApplicationMenu(null);
  createSplash();

  if (remoteError) {
    showStartupError(remoteError);
    return;
  }

  try {
    const baseUrl = await ensureBackend();
    const target = DEV_SERVER || baseUrl;
    logLine(`Loading interface: ${target}`);
    createMainWindow(target);
  } catch (error) {
    showStartupError(error instanceof Error ? error.message : String(error));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && !quitting) {
      ensureBackend()
        .then((baseUrl) => createMainWindow(DEV_SERVER || baseUrl))
        .catch((error) => showStartupError(error instanceof Error ? error.message : String(error)));
    }
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});
