const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let win;
let serverProcess;

function killBackend() {
    if (serverProcess && !serverProcess.killed) {
        console.log("💀 Killing backend...");
        try {
            process.kill(serverProcess.pid);
        } catch (e) {
            console.log("Backend already dead.");
        }
    }
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    win.loadURL("http://localhost:3000/login");

    win.on("closed", () => {
        killBackend();
        win = null;
        app.quit();
    });
}

app.whenReady().then(() => {
    serverProcess = spawn("node", ["backend/server.js"], {
        cwd: __dirname,
    });

    console.log("Backend PID:", serverProcess.pid);

    serverProcess.stdout.on("data", (data) => {
        const msg = data.toString();
        console.log("[BACKEND]", msg);

        if (msg.includes("Server running") && !win) {
            createWindow();
        }
    });

    serverProcess.stderr.on("data", (data) => {
        console.error("[BACKEND ERROR]", data.toString());
    });

    serverProcess.on("close", () => {
        console.log("Backend closed.");
    });
});

app.on("window-all-closed", () => {
    killBackend();
    app.quit();
});

process.on("exit", killBackend);
process.on("SIGINT", killBackend);
process.on("SIGTERM", killBackend);
