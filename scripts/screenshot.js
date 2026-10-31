const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const url = process.env.AEC_SCREENSHOT_URL || "http://127.0.0.1:8765";
const output = process.env.AEC_SCREENSHOT_OUT || path.join(__dirname, "..", "docs", "dashboard.png");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    backgroundColor: "#070a16",
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  try {
    await window.loadURL(url);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const image = await window.webContents.capturePage();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, image.toPNG());
    console.log(`Saved ${output}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});
