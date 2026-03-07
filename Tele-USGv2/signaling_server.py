# signaling_server.py
import asyncio
import json
import logging
import os
from aiohttp import web, WSMsgType
from pyngrok import ngrok

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("signaling")

# ====== Global state ======
ROOMS = {}  # { room_id: { client_id: websocket } }
NEXT_ID = 0

# ====== WebSocket Handler ======
async def websocket_handler(request):
    global NEXT_ID
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    NEXT_ID += 1
    client_id = str(NEXT_ID)
    room = None
    logger.info(f"Client {client_id} connected")

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    logger.warning(f"Invalid JSON from {client_id}: {msg.data}")
                    continue

                action = data.get("action")

                # 🔹 JOIN ROOM
                if action == "join":
                    room = data.get("room", "default")
                    if room not in ROOMS:
                        ROOMS[room] = {}
                    ROOMS[room][client_id] = ws

                    # kirim ID ke client
                    await ws.send_json({"action": "id", "id": client_id})

                    # kirim daftar peer lain di room
                    peers = [cid for cid in ROOMS[room] if cid != client_id]
                    await ws.send_json({"action": "peers", "peers": peers})

                    # beri tahu peer lain bahwa client baru bergabung
                    for cid, peer_ws in ROOMS[room].items():
                        if cid != client_id:
                            await peer_ws.send_json({
                                "action": "peer-join",
                                "id": client_id
                            })
                    logger.info(f"Client {client_id} joined room {room}")

                # 🔹 OFFER / ANSWER / CANDIDATE
                elif action in ("offer", "answer", "candidate"):
                    target = data.get("target")
                    if not room or room not in ROOMS:
                        continue
                    if target in ROOMS[room]:
                        payload = {"action": action, "from": client_id}
                        if "sdp" in data:
                            payload["sdp"] = data["sdp"]
                            payload["type"] = data.get("type")
                        if "candidate" in data:
                            payload["candidate"] = data["candidate"]
                        await ROOMS[room][target].send_json(payload)

                 # 🔹 CAMERA STATE (ON/OFF)
                elif action == "camera-state":
                    state = data.get("state")
                    target = data.get("target")

                    if room and target in ROOMS.get(room, {}):
                        await ROOMS[room][target].send_json({
                            "action": "camera-state",
                            "from": client_id,
                            "state": state
                        })
                    logger.info(f"Camera state from {client_id} to {target}: {state}")

                elif action == "mic-state":
                    state = data.get("state")
                    target = data.get("target")
                    if room and target in ROOMS.get(room, {}):
                        await ROOMS[room][target].send_json({
                            "action": "mic-state",
                            "from": client_id,
                            "state": state
                        })
                    logger.info(f"Mic state from {client_id} to {target}: {state}")

                # 🔹 CHAT (opsional)
                elif action == "chat":
                    msg_text = data.get("message", "")
                    sender = data.get("nickname", f"User{client_id}")
                    for cid, peer_ws in ROOMS.get(room, {}).items():
                        await peer_ws.send_json({
                            "action": "chat",
                            "nickname": sender,
                            "message": msg_text
                        })

                # 🔹 LEAVE
                elif action == "leave":
                    break

            elif msg.type == WSMsgType.ERROR:
                logger.error(f"WebSocket error: {ws.exception()}")

    finally:
        # Hapus user dari room
        if room and client_id in ROOMS.get(room, {}):
            del ROOMS[room][client_id]
            for cid, peer_ws in ROOMS[room].items():
                await peer_ws.send_json({
                    "action": "peer-leave",
                    "id": client_id
                })
            if not ROOMS[room]:
                del ROOMS[room]
        await ws.close()
        logger.info(f"Client {client_id} disconnected")

    return ws


# ====== AIOHTTP App ======
async def index(request):
    return web.Response(text="WebRTC Signaling Server Active", content_type="text/plain")

app = web.Application()
app.router.add_get("/", index)
app.router.add_get("/ws", websocket_handler)


# ====== Main Entrypoint ======
async def main():
    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    logger.info("Local signaling server started on ws://127.0.0.1:8080/ws")

    # buka ngrok tunnel
    tunnel = ngrok.connect(8080, "http")
    logger.info("Ngrok public URL: %s", tunnel.public_url)

    try:
        while True:
            await asyncio.sleep(3600)
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        await runner.cleanup()
        ngrok.disconnect(tunnel.public_url)
        ngrok.kill()

if __name__ == "__main__":
    asyncio.run(main())
