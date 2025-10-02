# main.py
import asyncio
import json
import logging
import os
import uuid
from aiohttp import web, WSMsgType

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("signaling")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# rooms: room_id -> dict(client_id -> websocket)
ROOMS = {}

async def index(request):
    file_path = os.path.join(BASE_DIR, "templates", "index.html")
    with open(file_path, "r", encoding="utf-8") as f:
        return web.Response(content_type="text/html", text=f.read())

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    client_id = str(uuid.uuid4())
    room_id = None
    logger.info("Client %s connected", client_id)

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    logger.warning("Invalid JSON from %s: %s", client_id, msg.data)
                    continue

                action = data.get("action")
                if action == "join":
                    # data: { action: "join", room: "roomname", name: "optional" }
                    room_id = data.get("room", "default")
                    if room_id not in ROOMS:
                        ROOMS[room_id] = {}
                    ROOMS[room_id][client_id] = ws
                    # tell this client its id (so client knows)
                    await ws.send_json({"action": "id", "id": client_id})
                    # notify others that new peer joined
                    for cid, peer in ROOMS[room_id].items():
                        if cid == client_id:
                            continue
                        await peer.send_json({"action": "peer-join", "id": client_id})
                    # also send list of existing peers to joining client
                    others = [cid for cid in ROOMS[room_id] if cid != client_id]
                    await ws.send_json({"action": "peers", "peers": others})
                    logger.info("Client %s joined room %s (peers: %s)", client_id, room_id, others)

                elif action in ("offer", "answer", "candidate"):
                    # relay to target
                    target = data.get("target")
                    if not room_id or room_id not in ROOMS:
                        logger.warning("No room for client %s", client_id)
                        continue
                    if target in ROOMS[room_id]:
                        payload = {
                            "action": action,
                            "from": client_id,
                            # the rest (sdp or candidate) forwarded as-is
                        }
                        # Attach sdp/candidate if present
                        if "sdp" in data:
                            payload["sdp"] = data["sdp"]
                            payload["type"] = data.get("type")
                        if "candidate" in data:
                            payload["candidate"] = data["candidate"]
                            payload["sdpMid"] = data.get("sdpMid")
                            payload["sdpMLineIndex"] = data.get("sdpMLineIndex")
                        await ROOMS[room_id][target].send_json(payload)
                    else:
                        logger.warning("Target %s not in room %s", target, room_id)

                elif action == "leave":
                    # client intentionally leaving
                    break

                else:
                    logger.debug("Unknown action from %s: %s", client_id, action)

            elif msg.type == WSMsgType.ERROR:
                logger.error('ws connection closed with exception %s', ws.exception())

    finally:
        # cleanup
        if room_id and room_id in ROOMS and client_id in ROOMS[room_id]:
            del ROOMS[room_id][client_id]
            # notify others
            for cid, peer in ROOMS[room_id].items():
                await peer.send_json({"action": "peer-leave", "id": client_id})
            if not ROOMS[room_id]:
                del ROOMS[room_id]
        logger.info("Client %s disconnected", client_id)
        await ws.close()

    return ws

def create_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/ws", websocket_handler)
    static_path = os.path.join(BASE_DIR, "static")
    app.router.add_static("/static/", path=static_path, name="static")
    return app

if __name__ == "__main__":
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8080)
