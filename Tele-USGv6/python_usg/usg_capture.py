import cv2
import asyncio
import websockets
import json
import logging
import time
import os
from datetime import datetime

logging.basicConfig(level=logging.INFO)

WS_HOST = "127.0.0.1"
WS_PORT = 9000

WIDTH = 1280
HEIGHT = 720
FPS = 20  # Target streaming FPS
RECORDING_FPS = 14  # Actual capture rate (calibrated: 10s record = 7s playback @ 20fps)

cap = None
ACTIVE_CAMERA = None
STREAMING = False
VIEWERS = set()

# Recording state
video_writer = None
is_recording = False
recording_path = None
recording_start_time = None

# =========================
# CAMERA SCAN
# =========================
def scan_cameras():
    """Scan for available cameras (indices 0-4)"""
    available = []
    for idx in range(5):
        test = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if test.isOpened():
            available.append(idx)
            test.release()
        else:
            try:
                test.release()
            except:
                pass
    logging.info(f"📷 Available cameras: {available}")
    return available if available else [0, 1, 2]  # fallback

def open_camera(index: int):
    global cap

    # Release existing camera with proper cleanup
    if cap:
        try:
            cap.release()
            logging.info(f"📷 Previous camera released before opening index {index}")
        except:
            pass
        cap = None
        time.sleep(0.2)  # Short delay for camera release

    # Try DSHOW first (better for physical cameras), then default (better for virtual cameras)
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        logging.info(f"🔄 DSHOW failed for camera {index}, trying default backend...")
        try:
            cap.release()
        except:
            pass
        time.sleep(0.1)
        cap = cv2.VideoCapture(index)

    if not cap.isOpened():
        logging.error(f"❌ Failed to open camera {index}")
        try:
            cap.release()
        except:
            pass
        cap = None
        return False

    # Request high resolution - camera will negotiate to its native/max resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    cap.set(cv2.CAP_PROP_FPS, FPS)
    
    # Log actual resolution obtained
    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    logging.info(f"🎥 USG Camera ACTIVE → index {index}, resolution {actual_w}x{actual_h}")
    return True

# =========================
# SCREENSHOT
# =========================
def take_screenshot(folder: str, filename: str = None):
    """Take a screenshot and save as PNG"""
    global cap
    
    if cap is None or not cap.isOpened():
        logging.error("❌ No camera available for screenshot")
        return None
    
    ret, frame = cap.read()
    if not ret or frame is None:
        logging.error("❌ Failed to capture frame for screenshot")
        return None
    
    # Create folder if not exists
    os.makedirs(folder, exist_ok=True)
    
    # Generate filename if not provided
    if not filename:
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"screenshot_{timestamp}.png"
    
    filepath = os.path.join(folder, filename)
    
    # Save as PNG with high quality
    success = cv2.imwrite(filepath, frame, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    
    if success:
        logging.info(f"📸 Screenshot saved: {filepath}")
        return filepath
    else:
        logging.error(f"❌ Failed to save screenshot: {filepath}")
        return None

# =========================
# RECORDING
# =========================

# Quality presets mapping
QUALITY_PRESETS = {
    '720p': (1280, 720),
    '1080p': (1920, 1080),
    '480p': (854, 480),
    'original': None  # Use camera's native resolution
}

recording_quality = 'original'  # Current recording quality setting

def start_recording(folder: str, filename: str = None, quality: str = 'original'):
    """Start recording to MP4 with quality setting"""
    global cap, video_writer, is_recording, recording_path, recording_start_time, recording_quality
    
    if is_recording:
        logging.warning("⚠️ Already recording")
        return {"success": False, "error": "Already recording"}
    
    if cap is None or not cap.isOpened():
        logging.error("❌ No camera available for recording")
        return {"success": False, "error": "No camera available"}
    
    # Set recording quality
    recording_quality = quality if quality in QUALITY_PRESETS else 'original'
    
    # Create folder if not exists
    os.makedirs(folder, exist_ok=True)
    
    # Generate filename if not provided
    if not filename:
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"recording_{timestamp}.mp4"
    
    recording_path = os.path.join(folder, filename)
    
    # Get output dimensions based on quality
    if recording_quality != 'original' and QUALITY_PRESETS.get(recording_quality):
        output_width, output_height = QUALITY_PRESETS[recording_quality]
    else:
        # Use camera's native resolution
        output_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        output_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Try different codecs for MP4 - ordered by browser compatibility
    # H264/avc1 = H.264 (best browser support)
    # mp4v = MPEG-4 Part 2 (poor browser support)
    # XVID = fallback for VLC playback
    codecs = [
        ('H264', '.mp4'),  # H.264 - best browser compatibility (requires OpenH264)
        ('avc1', '.mp4'),  # H.264 alternative
        ('X264', '.mp4'),  # x264 encoder
        ('mp4v', '.mp4'),  # MPEG-4 Part 2 (fallback, poor browser support)
        ('XVID', '.avi'),  # XVID (VLC fallback)
    ]
    
    for codec, ext in codecs:
        fourcc = cv2.VideoWriter_fourcc(*codec)
        # Adjust path extension if needed
        if ext != '.mp4':
            recording_path = recording_path.replace('.mp4', ext)
        
        video_writer = cv2.VideoWriter(
            recording_path,
            fourcc,
            RECORDING_FPS,  # Use recording-specific FPS
            (output_width, output_height)  # Use quality-based dimensions
        )
        
        if video_writer.isOpened():
            is_recording = True
            recording_start_time = time.time()
            
            # Generate thumbnail from first frame
            thumbnail_path = None
            ret, frame = cap.read()
            if ret and frame is not None:
                # Resize frame if quality requires it
                if recording_quality != 'original' and QUALITY_PRESETS.get(recording_quality):
                    frame = cv2.resize(frame, (output_width, output_height))
                
                # Save thumbnail as _thumb.jpg
                base_path = recording_path.rsplit('.', 1)[0]
                thumbnail_path = f"{base_path}_thumb.jpg"
                cv2.imwrite(thumbnail_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                logging.info(f"📷 Thumbnail saved: {thumbnail_path}")
                # Write this frame to video as well
                video_writer.write(frame)
            
            logging.info(f"🎥 Recording started ({codec}, {recording_quality}): {recording_path}")
            return {"success": True, "path": recording_path, "codec": codec, "thumbnail": thumbnail_path, "quality": recording_quality}
        else:
            video_writer.release()
            video_writer = None
    
    logging.error("❌ Failed to initialize video writer with any codec")
    return {"success": False, "error": "No compatible codec found"}

def stop_recording():
    """Stop recording and finalize the file"""
    global video_writer, is_recording, recording_path, recording_start_time
    
    if not is_recording or video_writer is None:
        logging.warning("⚠️ Not currently recording")
        return {"success": False, "error": "Not recording"}
    
    duration = time.time() - recording_start_time if recording_start_time else 0
    saved_path = recording_path
    
    try:
        video_writer.release()
    except Exception as e:
        logging.error(f"❌ Error releasing video writer: {e}")
    
    video_writer = None
    is_recording = False
    recording_path = None
    recording_start_time = None
    
    logging.info(f"🎥 Recording stopped: {saved_path} (duration: {duration:.1f}s)")
    return {"success": True, "path": saved_path, "duration": duration}

def write_frame_to_video(frame):
    """Write a frame to the video if recording (with quality resize)"""
    global video_writer, is_recording, recording_quality
    
    if is_recording and video_writer is not None and video_writer.isOpened():
        # Resize frame if quality requires it
        if recording_quality != 'original' and QUALITY_PRESETS.get(recording_quality):
            output_size = QUALITY_PRESETS[recording_quality]
            frame = cv2.resize(frame, output_size)
        video_writer.write(frame)

# =========================
# STREAM LOOP
# =========================
async def broadcast_frame(data):
    """Non-blocking broadcast to all viewers"""
    for ws in list(VIEWERS):
        try:
            await ws.send(data)
        except:
            VIEWERS.discard(ws)

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

        # Write frame to video if recording
        write_frame_to_video(frame)

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
            logging.info(f"📥 Received message: action={action}, data={data}")

            # Compatibility aliases
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
                idx = int(data.get("index", 0))
                if ACTIVE_CAMERA != idx:
                    open_camera(idx)
                    ACTIVE_CAMERA = idx
                STREAMING = True
                logging.info(f"�️ Preview camera {idx}")

            elif action == "start-share":
                idx = int(data.get("index", 0))
                cams = scan_cameras()
                if idx in cams or True:  # Allow any index
                    ACTIVE_CAMERA = idx
                    if open_camera(idx):
                        STREAMING = True
                        logging.info(f"📡 USG Share started (camera {idx})")
                else:
                    logging.error(f"❌ Camera {idx} not available (available={cams})")

            elif action == "stop-share":
                # Stop recording if active
                if is_recording:
                    stop_recording()
                
                STREAMING = False
                ACTIVE_CAMERA = None
                if cap:
                    try:
                        cap.release()
                    except:
                        pass
                    cap = None
                logging.info("🛑 USG stopped")

            # ===============================
            # SCREENSHOT & RECORDING COMMANDS
            # ===============================
            elif action == "take-screenshot":
                folder = data.get("folder", "./screenshots")
                filename = data.get("filename")
                result = take_screenshot(folder, filename)
                await websocket.send(json.dumps({
                    "action": "screenshot-result",
                    "success": result is not None,
                    "path": result
                }))

            elif action == "start-recording":
                folder = data.get("folder", "./recordings")
                filename = data.get("filename")
                quality = data.get("quality", "original")  # Quality: 720p, 1080p, 480p, original
                result = start_recording(folder, filename, quality)
                await websocket.send(json.dumps({
                    "action": "recording-started",
                    **result
                }))

            elif action == "stop-recording":
                result = stop_recording()
                await websocket.send(json.dumps({
                    "action": "recording-stopped",
                    **result
                }))

    finally:
        VIEWERS.discard(websocket)
        logging.info("🔌 USG Client disconnected")

# =========================
# MAIN
# =========================
async def main():
    server = await websockets.serve(ws_handler, WS_HOST, WS_PORT)
    logging.info(f"🩺 USG WebSocket ready at ws://{WS_HOST}:{WS_PORT}")
    await asyncio.gather(server.wait_closed(), stream_loop())

if __name__ == "__main__":
    asyncio.run(main())

