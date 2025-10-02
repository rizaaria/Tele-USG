import asyncio
import logging
import os
import json
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiohttp import web
from pyngrok import ngrok

logging.basicConfig(level=logging.INFO)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

async def index(request):
    file_path = os.path.join(BASE_DIR, "templates", "index.html")
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    return web.Response(content_type="text/html", text=content)

app = web.Application()
app.router.add_get("/", index)

# serve static (css, js)
static_path = os.path.join(BASE_DIR, "static")
app.router.add_static("/static/", path=static_path, name="static")

pcs = set()

async def offer(request):
    params = await request.json()
    username = params.get("username")
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pcs.add(pc)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    response_data = {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type,
        "username": username,
    }
    return web.Response(
        content_type="application/json", text=json.dumps(response_data)
    )

app.router.add_post("/offer", offer)

async def on_shutdown(app):
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()

app.on_shutdown.append(on_shutdown)

async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    pc = RTCPeerConnection()
    pcs.add(pc)

    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            data = json.loads(msg.data)
            if data["type"] == "offer":
                offer = RTCSessionDescription(sdp=data["sdp"], type="offer")
                await pc.setRemoteDescription(offer)
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)

                await ws.send_json({
                    "type": pc.localDescription.type,
                    "sdp": pc.localDescription.sdp
                })

    return ws

app.router.add_get("/ws", websocket_handler)

async def main():
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()

    # Buka tunnel ngrok otomatis (pakai https)
    public_url = ngrok.connect(8080, "http")
    logging.info(f"Public URL: {public_url}")

    # biar server tetap hidup
    while True:
        await asyncio.sleep(3600)

if __name__ == "__main__":
    asyncio.run(main())
