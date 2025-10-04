# main.py
import asyncio
import logging
import os
import json
from aiohttp import web, WSMsgType
from pyngrok import ngrok

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("signaling")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ROOMS = {}
NEXT_ID = 0

async def index(request):
    idx = os.path.join(BASE_DIR, "templates", "index.html")
    with open(idx, "r", encoding="utf-8") as f:
        return web.Response(content_type="text/html", text=f.read())

app = web.Application()
app.router.add_get("/", index)
app.router.add_static("/static/", path=os.path.join(BASE_DIR, "static"), name="static")

async def websocket_handler(request):
    global NEXT_ID
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    NEXT_ID += 1
    client_id = str(NEXT_ID)
    room = None
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
                    room = data.get("room", "default")
                    if room not in ROOMS:
                        ROOMS[room] = {}
                    ROOMS[room][client_id] = ws

                    await ws.send_json({"action": "id", "id": client_id})
                    peers = [cid for cid in ROOMS[room] if cid != client_id]
                    await ws.send_json({"action": "peers", "peers": peers})

                    for cid, peer_ws in ROOMS[room].items():
                        if cid != client_id:
                            await peer_ws.send_json({"action": "peer-join", "id": client_id})

                    logger.info("Client %s joined room %s (peers=%s)", client_id, room, peers)

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

                elif action == "leave":
                    break

            elif msg.type == WSMsgType.ERROR:
                logger.error("WS error %s: %s", client_id, ws.exception())

    finally:
        if room and room in ROOMS and client_id in ROOMS[room]:
            del ROOMS[room][client_id]
            for cid, peer_ws in ROOMS[room].items():
                await peer_ws.send_json({"action": "peer-leave", "id": client_id})
            if not ROOMS[room]:
                del ROOMS[room]
        logger.info("Client %s disconnected", client_id)
        await ws.close()

    return ws

app.router.add_get("/ws", websocket_handler)

async def main():
    runner = web.AppRunner(app)
    await runner.setup()

    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    logger.info("Server started on http://0.0.0.0:8080")

    tunnel = ngrok.connect(addr=8080, proto="http")
    logger.info("Ngrok public URL: %s", tunnel.public_url)

    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down")
    finally:
        await runner.cleanup()
        ngrok.disconnect(tunnel.public_url)
        ngrok.kill()

if __name__ == "__main__":
    asyncio.run(main())
