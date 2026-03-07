const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, fork } = require("child_process");

let win;
let serverProcess;
let pythonUSGProcess;
let serverReady = false;

// Show window immediately with loading screen
function createWindow() {
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false, // Don't show until ready-to-show
        backgroundColor: "#1a1a2e", // Match loading page background
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Load the loading page immediately (it's a local file, instant)
    const loadingPath = path.join(__dirname, "renderer", "loading.html");
    win.loadFile(loadingPath);

    // Show window as soon as it's ready (with loading page)
    win.once("ready-to-show", () => {
        win.show();
    });

    win.on("closed", () => {
        killBackend();
        win = null;
        app.quit();
    });
}

// Navigate to login once server is ready
function navigateToApp() {
    if (win && serverReady) {
        win.loadURL("http://localhost:3000/login");
    }
}

function startPythonUSG() {
    if (pythonUSGProcess) return; // Already started
    console.log("🐍 Starting USG Python service...");

    let pythonPath = "python";
    let pythonScript = path.join(__dirname, "python_usg", "usg_capture.py");

    const isPackaged = app.isPackaged;
    if (isPackaged) {
        const portablePython = path.join(process.resourcesPath, "python_portable", "python.exe");
        const fs = require("fs");
        if (fs.existsSync(portablePython)) {
            pythonPath = portablePython;
            console.log("Using bundled Python:", pythonPath);
        } else {
            console.warn("Bundled Python not found, falling back to system Python");
        }
    }

    pythonUSGProcess = spawn(pythonPath, [pythonScript], {
        cwd: isPackaged ? path.dirname(pythonScript) : __dirname,
    });

    pythonUSGProcess.stdout.on("data", (data) => {
        console.log("[USG]", data.toString());
    });

    pythonUSGProcess.stderr.on("data", (data) => {
        console.error("[USG ERROR]", data.toString());
    });

    pythonUSGProcess.on("close", () => {
        console.log("USG Python stopped");
        pythonUSGProcess = null;
    });
}

function killBackend() {
    if (serverProcess && !serverProcess.killed) {
        console.log("💀 Killing backend...");
        try {
            process.kill(serverProcess.pid);
        } catch (e) {
            console.log("Backend already dead.");
        }
    }
    if (pythonUSGProcess && !pythonUSGProcess.killed) {
        try {
            process.kill(pythonUSGProcess.pid);
            console.log("🐍 Python USG killed");
        } catch { }
    }
}

// ========== IPC HANDLERS FOR LOCAL FILE STORAGE ==========

// Get savedata folder path for a room
ipcMain.handle('get-media-folder', (event, roomID, type) => {
    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : __dirname;

    const folder = path.join(appPath, 'savedata', roomID, type);
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
    }
    return folder;
});

// Save file locally
ipcMain.handle('save-local-file', async (event, { folder, filename, buffer }) => {
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
});

// Get list of local media files for a room
ipcMain.handle('get-local-media-list', async (event, roomID, type) => {
    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : __dirname;

    const folder = path.join(appPath, 'savedata', roomID, type);
    if (!fs.existsSync(folder)) return [];

    const files = fs.readdirSync(folder)
        // Filter out thumbnail files (they're not actual recordings)
        .filter(filename => !filename.endsWith('_thumb.jpg'));

    return files.map(filename => ({
        filename,
        path: path.join(folder, filename),
        timestamp: fs.statSync(path.join(folder, filename)).mtime.getTime()
    }));
});

// Delete local media folder for a room
ipcMain.handle('delete-local-folder', async (event, roomID) => {
    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : __dirname;

    const folder = path.join(appPath, 'savedata', roomID);
    if (fs.existsSync(folder)) {
        fs.rmSync(folder, { recursive: true, force: true });
        return true;
    }
    return false;
});

// Delete a specific local media file (for cloud-only saves)
ipcMain.handle('delete-local-file', async (event, roomID, mediaType, filename) => {
    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : __dirname;

    const filePath = path.join(appPath, 'savedata', roomID, mediaType, filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("✅ Deleted local file:", filePath);

        // Check if folder is empty and remove it
        const folderPath = path.join(appPath, 'savedata', roomID, mediaType);
        const remainingFiles = fs.readdirSync(folderPath);
        if (remainingFiles.length === 0) {
            fs.rmdirSync(folderPath);
            console.log("✅ Removed empty folder:", folderPath);
        }

        // Check if roomID folder is empty
        const roomFolder = path.join(appPath, 'savedata', roomID);
        const remainingSubfolders = fs.readdirSync(roomFolder);
        if (remainingSubfolders.length === 0) {
            fs.rmdirSync(roomFolder);
            console.log("✅ Removed empty room folder:", roomFolder);
        }

        return true;
    }
    return false;
});

// ========== PYTHON USG WEBSOCKET COMMUNICATION ==========

const WebSocket = require('ws');

// Send command to Python USG server
async function sendToPythonUSG(command) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:9000');
        let timeout;

        ws.on('open', () => {
            ws.send(JSON.stringify(command));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                clearTimeout(timeout);
                ws.close();
                resolve(response);
            } catch (e) {
                // Ignore binary data (video frames)
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        // Timeout after 10 seconds
        timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Python USG command timeout'));
        }, 10000);
    });
}

// Python screenshot
ipcMain.handle('python-screenshot', async (event, roomID) => {
    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : __dirname;

    const folder = path.join(appPath, 'savedata', roomID, 'screenshots');

    try {
        const response = await sendToPythonUSG({
            action: 'take-screenshot',
            folder: folder
        });
        return response;
    } catch (err) {
        console.error('Python screenshot error:', err);
        return { success: false, error: err.message };
    }
});

// Python start recording (with quality setting)
ipcMain.handle('python-start-recording', async (event, roomID, quality = 'original') => {
    const appPath = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : __dirname;

    const folder = path.join(appPath, 'savedata', roomID, 'recordings');

    try {
        const response = await sendToPythonUSG({
            action: 'start-recording',
            folder: folder,
            quality: quality  // Pass quality to Python (720p, 1080p, 480p, original)
        });
        return response;
    } catch (err) {
        console.error('Python start recording error:', err);
        return { success: false, error: err.message };
    }
});

// Python stop recording
ipcMain.handle('python-stop-recording', async (event) => {
    try {
        const response = await sendToPythonUSG({
            action: 'stop-recording'
        });
        return response;
    } catch (err) {
        console.error('Python stop recording error:', err);
        return { success: false, error: err.message };
    }
});

// Read file as data URL (for caliper image display)
ipcMain.handle('read-file-as-dataurl', async (event, filePath) => {
    try {
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
        const base64 = buffer.toString('base64');
        return `data:${mimeType};base64,${base64}`;
    } catch (err) {
        console.error('Read file as data URL error:', err);
        return null;
    }
});

// Save annotated image (overwrite original with caliper annotations)
ipcMain.handle('save-annotated-image', async (event, filePath, buffer) => {
    try {
        const uint8Array = new Uint8Array(buffer);
        fs.writeFileSync(filePath, uint8Array);
        console.log('Annotated image saved:', filePath);
        return { success: true };
    } catch (err) {
        console.error('Save annotated image error:', err);
        return { success: false, error: err.message };
    }
});

// ========== END IPC HANDLERS ==========

app.whenReady().then(() => {
    // Show window immediately with loading screen
    createWindow();

    // Start backend server
    const backendScript = path.join(__dirname, "backend", "server.js");
    serverProcess = fork(backendScript, [], {
        cwd: __dirname,
        silent: true,
        env: { ...process.env }
    });

    console.log("Backend PID:", serverProcess.pid);

    serverProcess.stdout.on("data", (data) => {
        const msg = data.toString();
        console.log("[BACKEND]", msg);

        if (msg.includes("Server running") && !serverReady) {
            serverReady = true;
            // Start Python USG in background (deferred)
            setTimeout(() => startPythonUSG(), 500);
            // Navigate to login
            navigateToApp();
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
