// ======================================
// Load Environment Variables
// ======================================
require("dotenv").config();

console.log("SERVER FILE LOADED");

const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

// ======================================
// 🔥 Firebase Admin — via .env (AMAN)
// ======================================
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    // ubah string \n menjadi newline asli
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  }),
  databaseURL: "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const rtdb = admin.database();

// ======================================
// WebRTC Signaling State
// ======================================
const ROOMS = {};
let NEXT_ID = 0;

function startServer(port = 3000) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(cors());

    const rendererRoot = path.join(__dirname, "..", "renderer");
    const staticPath = path.join(rendererRoot, "static");

    app.use("/static", express.static(staticPath));

    // Routing
    app.get("/", (req, res) => res.redirect("/login"));
    app.get("/login", (req, res) => res.sendFile(path.join(rendererRoot, "login.html")));
    app.get("/dashboard", (req, res) => res.sendFile(path.join(rendererRoot, "dashboard.html")));
    app.get("/meeting/:room_id", (req, res) => res.sendFile(path.join(rendererRoot, "meeting.html")));
    app.get("/register", (req, res) => res.sendFile(path.join(rendererRoot, "register.html")));
    app.get("/create", (req, res) => res.sendFile(path.join(rendererRoot, "create.html")));
    app.get("/join", (req, res) => res.sendFile(path.join(rendererRoot, "join.html")));
    app.get("/ice", async (req, res) => {
        try {
            const fetch = (await import("node-fetch")).default;

            const url = `https://global.xirsys.net/_turn/${process.env.XIRSYS_CHANNEL}`;

            const auth = Buffer.from(
              process.env.XIRSYS_USER + ":" + process.env.XIRSYS_SECRET
            ).toString("base64");

            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    "Authorization": "Basic " + auth,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({})
            });

            const data = await response.json();
            res.json({ iceServers: data.v?.iceServers || [] });

        } catch (err) {
            console.error("Xirsys error:", err);
            res.json({ iceServers: [] });
        }
    });
    app.get("/config", (req, res) => {
      // baca host & protocol dari request (bisa dari ngrok / lokal)
      const host = req.headers["x-forwarded-host"] || req.headers.host;   // contoh: "abcd-1234.ngrok-free.app"
      const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");

      // http  -> ws
      // https -> wss
      const wsProto = proto === "https" ? "wss" : "ws";

      res.json({
        signaling_url: `${wsProto}://${host}/ws`
      });
    });

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server, path: "/ws" });

    // WebSocket Signaling
    wss.on("connection", (ws) => {
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

        // ============== JOIN ROOM ==============
        if (action === "join") {
          room = data.room;
          userUid = data.uid || null;

          if (!ROOMS[room]) ROOMS[room] = {};
          ROOMS[room][clientId] = ws;

          ws.send(JSON.stringify({ action: "id", id: clientId }));

          const peers = Object.keys(ROOMS[room]).filter(id => id !== clientId);
          ws.send(JSON.stringify({ action: "peers", peers }));

          // broadcast peer join
          for (const [cid, peerWs] of Object.entries(ROOMS[room])) {
            if (cid !== clientId && peerWs.readyState === WebSocket.OPEN) {
              peerWs.send(JSON.stringify({
                action: "peer-join",
                id: clientId
              }));
            }
          }

          // 🔥 SIMPAN KE FIREBASE
          await rtdb.ref(`meetings/${room}/participants/${clientId}`).set({
            uid: userUid,
            joinedAt: Date.now()
          });
          // 🔥 FIX: Hapus participant yang bukan clientId (UID Firebase Auth, email, dsb)
          const participantsRef = rtdb.ref(`meetings/${room}/participants`);

          participantsRef.once("value", (snap) => {
            const data = snap.val() || {};

            Object.keys(data).forEach((key) => {
              // hanya angka yang valid: "1", "2"
              if (!/^[0-9]+$/.test(key)) {
                console.log(`🔥 Removing non-client participant key: ${key}`);
                participantsRef.child(key).remove();
              }
            });
          });

          console.log(`Client ${clientId} joined room ${room}`);
        }

        // ============== OFFER/ANSWER/CANDIDATE ==============
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

        // ============== CAMERA/MIC STATE ==============
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

        // ============== LEAVE ==============
        else if (action === "leave") {
          ws.close();
        }
      });

      // ============== DISCONNECT ==============
      ws.on("close", async () => {
        console.log(`Client ${clientId} disconnected`);

        if (room && ROOMS[room]?.[clientId]) {
          delete ROOMS[room][clientId];

          for (const [cid, peerWs] of Object.entries(ROOMS[room])) {
            if (peerWs.readyState === WebSocket.OPEN) {
              peerWs.send(JSON.stringify({
                action: "peer-leave",
                id: clientId
              }));
            }
          }

          // ↑ hapus dari Firebase
          await rtdb.ref(`meetings/${room}/participants/${clientId}`).remove();

          // jika room kosong → hapus room
          if (Object.keys(ROOMS[room]).length === 0) {
            delete ROOMS[room];
            await rtdb.ref(`meetings/${room}`).remove();
            console.log(`Room ${room} removed (empty)`);
          }
        }
      });
    });

    server.listen(port, () => {
      console.log(`✅ Server running http://localhost:${port}`);
      console.log(`WebSocket ws://localhost:${port}/ws`);
      resolve();
    });
  });
}

module.exports = { startServer };

if (require.main === module) startServer();
