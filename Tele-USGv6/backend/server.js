// ======================================
// Load Environment Variables
// ======================================
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

console.log("TeleUSG v6 Server Starting...");

const express = require("express");

const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

// ======================================
// 🔥 Firebase Admin
// ======================================
const admin = require("firebase-admin");

admin.initializeApp({
    credential: admin.credential.cert({
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    databaseURL: "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const rtdb = admin.database();

// ======================================
// Cloudinary Config (for server-side if needed)
// ======================================
const cloudinary = require("cloudinary").v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ======================================
// Ngrok Tunneling
// ======================================
const ngrok = require("@ngrok/ngrok");
let ngrokUrl = null;

// ======================================
// WebRTC Signaling State
// ======================================
const ROOMS = {};
let NEXT_ID = 0;

function startServer(port = 3000) {
    return new Promise((resolve, reject) => {
        const app = express();
        app.use(cors());
        app.use(express.json({ limit: '50mb' }));

        const rendererRoot = path.join(__dirname, "..", "renderer");
        const staticPath = path.join(rendererRoot, "static");

        app.use("/static", express.static(staticPath));

        // Serve local savedata files for preview
        // In packaged app: __dirname contains 'resources\app', savedata is in parent of resources
        // In dev mode: __dirname is TeleUSGv6/backend, savedata is ../savedata
        const isPackaged = __dirname.includes('resources\\app') || __dirname.includes('resources/app');
        const savedataPath = isPackaged
            ? path.join(__dirname, "..", "..", "..", "savedata")  // resources/app/backend -> ../../../savedata
            : path.join(__dirname, "..", "savedata");
        console.log(`📁 Savedata path: ${savedataPath} (packaged: ${isPackaged})`);
        app.use("/savedata", express.static(savedataPath));

        // ======================================
        // Routes
        // ======================================
        app.get("/", (req, res) => res.redirect("/login"));
        app.get("/login", (req, res) => res.sendFile(path.join(rendererRoot, "login.html")));
        app.get("/dashboard", (req, res) => res.sendFile(path.join(rendererRoot, "dashboard.html")));
        app.get("/meeting/:room_id", (req, res) => res.sendFile(path.join(rendererRoot, "meeting.html")));
        app.get("/register", (req, res) => res.sendFile(path.join(rendererRoot, "register.html")));
        app.get("/create", (req, res) => res.sendFile(path.join(rendererRoot, "create.html")));
        app.get("/join", (req, res) => res.sendFile(path.join(rendererRoot, "join.html")));
        app.get("/patients", (req, res) => res.sendFile(path.join(rendererRoot, "patients.html")));

        // ICE Servers from OpenRelay (metered.ca)
        app.get("/ice", async (req, res) => {
            try {
                const fetch = (await import("node-fetch")).default;
                const url = `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`;
                const response = await fetch(url);
                const iceServers = await response.json();
                res.json({ iceServers: Array.isArray(iceServers) ? iceServers : [] });
            } catch (err) {
                console.error("OpenRelay/Metered error:", err);
                res.json({ iceServers: [] });
            }
        });

        // Dynamic config for WebSocket URL
        app.get("/config", (req, res) => {
            const host = req.headers["x-forwarded-host"] || req.headers.host;
            const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
            const wsProto = proto === "https" ? "wss" : "ws";

            res.json({
                signaling_url: `${wsProto}://${host}/ws`,
                cloudinary: {
                    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
                    upload_preset: "teleusg_uploads"
                }
            });
        });

        // Get ngrok tunnel URL
        app.get("/ngrok-url", (req, res) => {
            res.json({ url: ngrokUrl });
        });

        // Cloudinary signature endpoint for secure uploads
        app.post("/api/cloudinary-signature", (req, res) => {
            const timestamp = Math.round(new Date().getTime() / 1000);
            const folder = req.body.folder || "teleusg";

            const signature = cloudinary.utils.api_sign_request(
                { timestamp, folder },
                process.env.CLOUDINARY_API_SECRET
            );

            res.json({
                signature,
                timestamp,
                api_key: process.env.CLOUDINARY_API_KEY,
                cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
                folder
            });
        });

        // Get room's cloud storage usage (sum of all media bytes) - 100MB per room
        app.get("/api/storage-usage", async (req, res) => {
            const { roomId } = req.query;

            if (!roomId) {
                return res.status(400).json({ error: "roomId is required" });
            }

            try {
                let totalBytes = 0;

                // Get screenshots from room-based path
                const screenshotsSnap = await rtdb.ref(`rooms/${roomId}/media/screenshots`).once('value');
                const screenshots = screenshotsSnap.val();
                if (screenshots) {
                    for (const key of Object.keys(screenshots)) {
                        totalBytes += screenshots[key].bytes || 0;
                    }
                }

                // Get recordings from room-based path
                const recordingsSnap = await rtdb.ref(`rooms/${roomId}/media/recordings`).once('value');
                const recordings = recordingsSnap.val();
                if (recordings) {
                    for (const key of Object.keys(recordings)) {
                        totalBytes += recordings[key].bytes || 0;
                    }
                }

                console.log(`📊 Storage usage for room ${roomId}: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
                res.json({ totalBytes, roomId });
            } catch (err) {
                console.error("Error fetching storage usage:", err);
                res.status(500).json({ error: "Failed to fetch storage usage" });
            }
        });

        // Participant cleanup endpoint (for beforeunload)
        app.delete("/api/participant/:roomId/:uid", async (req, res) => {
            const { roomId, uid } = req.params;
            try {
                await rtdb.ref(`meetings/${roomId}/participants/${uid}`).remove();
                res.json({ success: true });
            } catch (err) {
                console.error("Failed to remove participant:", err);
                res.status(500).json({ error: "Failed to remove participant" });
            }
        });

        // Cloudinary delete endpoint
        app.post("/api/cloudinary-delete", async (req, res) => {
            const { publicIds, resourceType = "image" } = req.body;

            if (!publicIds || !Array.isArray(publicIds) || publicIds.length === 0) {
                return res.status(400).json({ error: "publicIds array is required" });
            }

            try {
                const results = [];
                for (const publicId of publicIds) {
                    const result = await cloudinary.uploader.destroy(publicId, {
                        resource_type: resourceType
                    });
                    results.push({ publicId, result: result.result });
                }
                res.json({ success: true, results });
            } catch (err) {
                console.error("Cloudinary delete error:", err);
                res.status(500).json({ error: "Failed to delete from Cloudinary" });
            }
        });

        // Cloudinary folder delete endpoint (deletes room folder after media is deleted)
        app.post("/api/cloudinary-delete-folder", async (req, res) => {
            const { roomID } = req.body;

            if (!roomID) {
                return res.status(400).json({ error: "roomID is required" });
            }

            try {
                // Delete subfolders first (screenshots, recordings), then the room folder
                const foldersToDelete = [
                    `teleusg/${roomID}/screenshots`,
                    `teleusg/${roomID}/recordings`,
                    `teleusg/${roomID}`
                ];

                const results = [];
                for (const folder of foldersToDelete) {
                    try {
                        const result = await cloudinary.api.delete_folder(folder);
                        results.push({ folder, result: "deleted" });
                        console.log(`✅ Deleted Cloudinary folder: ${folder}`);
                    } catch (folderErr) {
                        // Folder might not exist or not be empty, that's okay
                        if (folderErr.error?.http_code !== 404) {
                            results.push({ folder, result: folderErr.message || "skipped" });
                        }
                    }
                }
                res.json({ success: true, results });
            } catch (err) {
                console.error("Cloudinary folder delete error:", err);
                res.status(500).json({ error: "Failed to delete folder from Cloudinary" });
            }
        });

        const server = http.createServer(app);
        const wss = new WebSocket.Server({ server, path: "/ws" });

        // ======================================
        // WebSocket Signaling
        // ======================================

        // Ping/pong heartbeat to keep connections alive
        const HEARTBEAT_INTERVAL = 30000; // 30 seconds
        const HEARTBEAT_TIMEOUT = 35000; // 35 seconds timeout

        function heartbeat() {
            this.isAlive = true;
        }

        // Ping all clients periodically
        const pingInterval = setInterval(() => {
            wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    console.log("Client timed out, terminating connection");
                    return ws.terminate();
                }
                ws.isAlive = false;
                ws.ping();
            });
        }, HEARTBEAT_INTERVAL);

        wss.on("close", () => {
            clearInterval(pingInterval);
        });

        wss.on("connection", (ws) => {
            ws.isAlive = true;
            ws.on("pong", heartbeat);

            NEXT_ID++;
            const clientId = String(NEXT_ID);
            let room = null;
            let userUid = null;

            console.log(`Client ${clientId} connected`);

            ws.on("message", async (msg) => {
                let data;
                try { data = JSON.parse(msg); }
                catch { return; }

                const action = data.action;

                // JOIN ROOM
                if (action === "join") {
                    room = data.room;
                    userUid = data.uid || null;

                    if (!ROOMS[room]) ROOMS[room] = {};
                    ROOMS[room][clientId] = ws;

                    ws.send(JSON.stringify({ action: "id", id: clientId }));

                    const peers = Object.keys(ROOMS[room]).filter(id => id !== clientId);
                    ws.send(JSON.stringify({ action: "peers", peers }));

                    // Broadcast peer join
                    for (const [cid, peerWs] of Object.entries(ROOMS[room])) {
                        if (cid !== clientId && peerWs.readyState === WebSocket.OPEN) {
                            peerWs.send(JSON.stringify({ action: "peer-join", id: clientId }));
                        }
                    }

                    // Save WebSocket client mapping (not user participants - those are handled by frontend)
                    await rtdb.ref(`meetings/${room}/clients/${clientId}`).set({
                        uid: userUid,
                        joinedAt: Date.now()
                    });

                    console.log(`Client ${clientId} joined room ${room}`);
                }

                // OFFER/ANSWER/CANDIDATE
                else if (["offer", "answer", "candidate"].includes(action)) {
                    const target = data.target;
                    if (ROOMS[room]?.[target]) {
                        ROOMS[room][target].send(JSON.stringify({
                            action: action,
                            from: clientId,
                            sdp: data.sdp,
                            type: data.type,
                            candidate: data.candidate
                        }));
                    }
                }

                // CAMERA/MIC STATE
                else if (["camera-state", "mic-state"].includes(action)) {
                    const target = data.target;
                    if (ROOMS[room]?.[target]) {
                        ROOMS[room][target].send(JSON.stringify({
                            action: action,
                            from: clientId,
                            state: data.state
                        }));
                    }
                }

                // USG SHARE STATE
                else if (action === "usg-state") {
                    // Broadcast USG sharing state to all peers in room
                    for (const [cid, peerWs] of Object.entries(ROOMS[room] || {})) {
                        if (cid !== clientId && peerWs.readyState === WebSocket.OPEN) {
                            peerWs.send(JSON.stringify({
                                action: "usg-state",
                                from: clientId,
                                sharing: data.sharing
                            }));
                        }
                    }
                }

                // SCREENSHOT/RECORDING REQUESTS AND RESULTS
                else if (["request-screenshot", "screenshot-result", "request-start-recording", "request-stop-recording", "recording-result", "recording-state", "recording-stopped", "recording-storage-choice"].includes(action)) {
                    const target = data.target;
                    if (ROOMS[room]?.[target]) {
                        ROOMS[room][target].send(JSON.stringify({
                            ...data,
                            from: clientId
                        }));
                    }
                }

                // LEAVE
                else if (action === "leave") {
                    ws.close();
                }
            });

            // DISCONNECT
            ws.on("close", async () => {
                console.log(`Client ${clientId} disconnected`);

                if (room && ROOMS[room]?.[clientId]) {
                    delete ROOMS[room][clientId];

                    for (const [cid, peerWs] of Object.entries(ROOMS[room])) {
                        if (peerWs.readyState === WebSocket.OPEN) {
                            peerWs.send(JSON.stringify({ action: "peer-leave", id: clientId }));
                        }
                    }

                    await rtdb.ref(`meetings/${room}/clients/${clientId}`).remove();

                    if (Object.keys(ROOMS[room]).length === 0) {
                        delete ROOMS[room];
                        console.log(`Room ${room} removed (empty)`);
                    }
                }
            });
        });

        server.listen(port, async () => {
            console.log(`✅ Server running http://localhost:${port}`);
            console.log(`WebSocket ws://localhost:${port}/ws`);

            // Start ngrok tunnel if authtoken is configured
            if (process.env.NGROK_AUTHTOKEN) {
                try {
                    console.log("🚀 Starting ngrok tunnel...");
                    const listener = await ngrok.forward({
                        addr: port,
                        authtoken: process.env.NGROK_AUTHTOKEN
                    });
                    ngrokUrl = listener.url();
                    console.log(`🌐 Ngrok URL: ${ngrokUrl}`);
                    console.log("📱 Use this URL to access from other devices!");
                } catch (err) {
                    console.error("❌ Ngrok failed to start:", err.message);
                }
            } else {
                console.log("ℹ️ Ngrok not configured (set NGROK_AUTHTOKEN in .env)");
            }

            resolve();
        });
    });
}

module.exports = { startServer };

if (require.main === module) startServer();
