import cv2
import asyncio
import websockets
import logging

logging.basicConfig(level=logging.INFO)

WS_HOST = "127.0.0.1"
WS_PORT = 9000

CAMERA_INDEX = 1   
WIDTH = 1280
HEIGHT = 720
FPS = 20

VIEWERS = set()

async def ws_handler(websocket):
    global VIEWERS
    VIEWERS.add(websocket)
    logging.info(f"Viewer connected: {websocket.remote_address}")
    try:
        async for _ in websocket:
            pass
    except:
        pass
    finally:
        VIEWERS.remove(websocket)
        logging.info("Viewer disconnected")

async def stream_usg():
    global VIEWERS
    cap = cv2.VideoCapture(CAMERA_INDEX)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, FPS)

    if not cap.isOpened():
        logging.error("Tidak bisa membuka kamera USG")
        return

    logging.info("Kamera USG terbuka")

    while True:
        ret, frame = cap.read()
        if not ret:
            await asyncio.sleep(0.01)
            continue

        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ok:
            continue

        data = jpeg.tobytes()
        for ws in list(VIEWERS):
            try:
                await ws.send(data)
            except:
                VIEWERS.remove(ws)

        await asyncio.sleep(1 / FPS)

async def main():
    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    logging.info(f"USG Gateway ws://{WS_HOST}:{WS_PORT}")
    await asyncio.gather(server.wait_closed(), stream_usg())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("USG server stopped")
