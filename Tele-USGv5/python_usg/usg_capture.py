import cv2
import asyncio
import websockets
import json
import logging
import time

logging.basicConfig(level=logging.INFO)

WS_HOST = "127.0.0.1"
WS_PORT = 9000

WIDTH = 1280
HEIGHT = 720
FPS = 20

cap = None
ACTIVE_CAMERA = None
STREAMING = False
VIEWERS = set()

# =========================
# CAMERA SCAN
# =========================
def _try_open(idx, backend):
    test = cv2.VideoCapture(idx, backend) if backend is not None else cv2.VideoCapture(idx)
    if test.isOpened():
        test.release()
        return True
    try:
        test.release()
    except:
        pass
    return False

def scan_cameras():
    return list(range(3))

def open_camera(index: int):
    global cap

    if cap:
        try:
            cap.release()
        except:
            pass
        cap = None
        time.sleep(0.2)

    # prefer DSHOW on Windows, fallback otherwise
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(index)

    if not cap.isOpened():
        logging.error(f"❌ Failed to open camera {index}")
        try:
            cap.release()
        except:
            pass
        cap = None
        return False

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    cap.set(cv2.CAP_PROP_FPS, FPS)

    logging.info(f"🎥 USG Camera ACTIVE → index {index}")
    return True

# =========================
# STREAM LOOP
# =========================
async def stream_loop():
    global cap
    while True:
        if (not STREAMING) or (not VIEWERS) or (cap is None):
            await asyncio.sleep(0.05)
            continue

        ret, frame = cap.read()
        if not ret:
            await asyncio.sleep(0.05)
            continue

        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if not ok:
            continue

        data = jpeg.tobytes()
        for ws in list(VIEWERS):
            try:
                await ws.send(data)
            except:
                VIEWERS.discard(ws)

        await asyncio.sleep(1 / FPS)

# =========================
# WEBSOCKET HANDLER
# =========================
async def ws_handler(websocket):
    global STREAMING, ACTIVE_CAMERA, cap

    VIEWERS.add(websocket)
    logging.info("🔌 USG Client connected")

    try:
        async for msg in websocket:
            if not isinstance(msg, str):
                continue

            try:
                data = json.loads(msg)
            except:
                continue

            action = data.get("action", "")

            # compat aliases (older JS)
            if action == "switch-camera":
                action = "preview-camera"
            elif action == "start":
                action = "preview-camera"
                data["index"] = data.get("index", ACTIVE_CAMERA if ACTIVE_CAMERA is not None else 0)
            elif action == "stop":
                action = "stop-share"

            if action == "list-cameras":
                cams = scan_cameras()
                await websocket.send(json.dumps({"action": "camera-list", "cameras": cams}))

            elif action == "preview-camera":
                if ACTIVE_CAMERA != idx:
                    open_camera(idx)
                    ACTIVE_CAMERA = idx
                STREAMING = True

            elif action == "start-share":
                idx = int(data.get("index", 0))
                cams = scan_cameras()
                if idx in cams:
                    ACTIVE_CAMERA = idx
                    if open_camera(idx):
                        STREAMING = True
                        logging.info(f"📡 USG Share started (camera {idx})")
                else:
                    logging.error(f"❌ Camera {idx} not available (available={cams})")

            elif action == "stop-share":
                STREAMING = False
                ACTIVE_CAMERA = None
                if cap:
                    try:
                        cap.release()
                    except:
                        pass
                    cap = None
                logging.info("🛑 USG stopped")

    finally:
        VIEWERS.discard(websocket)

# =========================
# MAIN
# =========================
async def main():
    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    logging.info(f"🩺 USG WS ready at ws://{WS_HOST}:{WS_PORT}")
    await asyncio.gather(server.wait_closed(), stream_loop())

if __name__ == "__main__":
    asyncio.run(main())
