import cv2
import asyncio
import websockets
import json
import logging
import time
import os
import numpy as np
from datetime import datetime

logging.basicConfig(level=logging.INFO)

# =========================
# AI MODEL SETUP
# =========================
try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True
    logging.info("🧠 PyTorch available")
except ImportError:
    TORCH_AVAILABLE = False
    logging.warning("⚠️ PyTorch not installed — AI enhancement disabled")

# DnCNN Architecture (17 layers, grayscale blind denoising)
if TORCH_AVAILABLE:
    class DnCNN(nn.Module):
        def __init__(self, channels=1, num_of_layers=17, features=64):
            super(DnCNN, self).__init__()
            layers = [nn.Conv2d(channels, features, kernel_size=3, padding=1, bias=False), nn.ReLU(inplace=True)]
            for _ in range(num_of_layers - 2):
                layers.extend([nn.Conv2d(features, features, kernel_size=3, padding=1, bias=False),
                               nn.BatchNorm2d(features), nn.ReLU(inplace=True)])
            layers.append(nn.Conv2d(features, channels, kernel_size=3, padding=1, bias=False))
            self.dncnn = nn.Sequential(*layers)

        def forward(self, x):
            noise = self.dncnn(x)
            return x - noise  # Residual learning

    # VRES Architecture (Video Resolution Enhancement - 5-frame temporal, 18 residual blocks)
    import math as _math

    class Conv_ReLU_Block(nn.Module):
        """Building block for VRES: Conv(64->64, 3x3) + ReLU"""
        def __init__(self):
            super(Conv_ReLU_Block, self).__init__()
            self.conv = nn.Conv2d(64, 64, 3, padding=1, bias=False)
            self.relu = nn.ReLU(inplace=True)

        def forward(self, x):
            return self.relu(self.conv(x))

    class VRES(nn.Module):
        """
        VRES - Video Resolution Enhancement System
        18 residual blocks, 5-frame temporal input for super-resolution
        """
        def __init__(self):
            super(VRES, self).__init__()
            self.name = 'VRES'
            self.conv_first = nn.Conv2d(5, 64, 3, padding=1, bias=False)
            self.conv_next = nn.Conv2d(64, 64, 3, padding=1, bias=False)
            self.conv_last = nn.Conv2d(64, 1, 3, padding=1, bias=False)
            self.residual_layer = self._make_layer(Conv_ReLU_Block, 18)
            self.relu = nn.ReLU(inplace=True)

            # Xavier initialization
            for m in self.modules():
                if isinstance(m, nn.Conv2d):
                    n = m.kernel_size[0] * m.kernel_size[1] * m.out_channels
                    m.weight.data.normal_(0, _math.sqrt(2. / n))

        def _make_layer(self, block, num_of_layer):
            layers = []
            for _ in range(num_of_layer):
                layers.append(block())
            return nn.Sequential(*layers)

        def forward(self, x):
            center = 2
            res = x[:, center, :, :].unsqueeze(1)
            out = self.relu(self.conv_first(x))
            out = self.residual_layer(out)
            out = self.conv_last(out)
            out = torch.add(out, res)
            return out

# AI state
AI_MODEL = None
AI_MODE = "none"  # "none" | "dncnn" | "vres"
AI_DEVICE = "cpu"
VRES_FRAME_BUFFER = []  # Buffer for VRES 5-frame temporal input
VRES_SCALE = 3  # Downscale factor for VRES

def get_model_dir():
    """Get the Model AI directory path (works in both dev and packaged mode)"""
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Primary: models/ folder inside python_usg/ (bundled with app)
    local_models = os.path.join(script_dir, "models")
    if os.path.isdir(local_models):
        return local_models

    # Fallback: ../../Model AI/ (dev mode only)
    base = os.path.dirname(os.path.dirname(script_dir))
    model_dir = os.path.join(base, "Model AI")
    return model_dir

def _remap_dncnn_keys(state_dict):
    """
    Remap DnCNN state_dict keys from KAIR format (model.X.weight)
    to internal format (dncnn.X.weight). Also handles bias mismatch.
    """
    model_keys = DnCNN(channels=1, num_of_layers=17).state_dict()
    remapped = {}

    for key, value in state_dict.items():
        if key in model_keys and model_keys[key].shape == value.shape:
            remapped[key] = value
        else:
            new_key = key.replace("model.", "dncnn.", 1)
            if new_key in model_keys and model_keys[new_key].shape == value.shape:
                remapped[new_key] = value

    return remapped


def load_ai_model(mode):
    """Load AI model by mode name"""
    global AI_MODEL, AI_MODE, VRES_FRAME_BUFFER

    if not TORCH_AVAILABLE:
        logging.error("❌ PyTorch not available")
        AI_MODE = "none"
        AI_MODEL = None
        return False

    if mode == "none" or not mode:
        AI_MODEL = None
        AI_MODE = "none"
        VRES_FRAME_BUFFER = []
        logging.info("🧠 AI model disabled")
        return True

    model_dir = get_model_dir()

    if mode not in ("dncnn", "vres"):
        logging.error(f"❌ Unknown AI mode: {mode}")
        AI_MODE = "none"
        AI_MODEL = None
        return False

    try:
        if mode == "dncnn":
            filepath = os.path.join(model_dir, "dncnn_gray_blind.pth")
            if not os.path.exists(filepath):
                logging.error(f"❌ Model file not found: {filepath}")
                AI_MODE = "none"
                AI_MODEL = None
                return False

            model = DnCNN(channels=1, num_of_layers=17)
            state_dict = torch.load(filepath, map_location=AI_DEVICE, weights_only=True)

            # Remap keys (KAIR format -> internal format)
            remapped = _remap_dncnn_keys(state_dict)
            if len(remapped) > 0:
                model_dict = model.state_dict()
                model_dict.update(remapped)
                model.load_state_dict(model_dict)
                logging.info(f"🧠 DnCNN: {len(remapped)} tensors mapped")
            else:
                # Try direct load as fallback
                model.load_state_dict(state_dict)

            model.eval()
            model.to(AI_DEVICE)
            AI_MODEL = model
            AI_MODE = mode
            logging.info(f"🧠 AI model loaded: DnCNN from {filepath}")
            return True

        elif mode == "vres":
            filepath = os.path.join(model_dir, "vres_best_model.pth")
            if not os.path.exists(filepath):
                logging.error(f"❌ Model file not found: {filepath}")
                AI_MODE = "none"
                AI_MODEL = None
                return False

            model = VRES()
            checkpoint = torch.load(filepath, map_location=AI_DEVICE, weights_only=False)

            # Handle different checkpoint formats
            if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                model.load_state_dict(checkpoint['model_state_dict'])
            elif isinstance(checkpoint, dict):
                model.load_state_dict(checkpoint)
            else:
                model = checkpoint

            model.eval()
            model.to(AI_DEVICE)
            AI_MODEL = model
            AI_MODE = mode
            VRES_FRAME_BUFFER = []  # Reset frame buffer
            logging.info(f"🧠 AI model loaded: VRES from {filepath}")
            return True

    except Exception as e:
        logging.error(f"❌ Failed to load AI model '{mode}': {e}")
        AI_MODEL = None
        AI_MODE = "none"
        return False

def apply_ai_enhancement(frame):
    """Apply AI enhancement to a frame. Returns enhanced frame or original on error."""
    global AI_MODEL, AI_MODE, VRES_FRAME_BUFFER

    if AI_MODEL is None or AI_MODE == "none" or not TORCH_AVAILABLE:
        return frame

    try:
        if AI_MODE == "dncnn":
            # DnCNN: grayscale denoising
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # Normalize to [0,1] and convert to tensor
            img_tensor = torch.from_numpy(gray.astype(np.float32) / 255.0)
            img_tensor = img_tensor.unsqueeze(0).unsqueeze(0).to(AI_DEVICE)  # [1,1,H,W]

            with torch.no_grad():
                output = AI_MODEL(img_tensor)

            # Convert back to numpy
            output = output.squeeze().cpu().clamp(0, 1).numpy()
            output = (output * 255).astype(np.uint8)
            # Merge back to BGR (3-channel grayscale)
            frame = cv2.cvtColor(output, cv2.COLOR_GRAY2BGR)

        elif AI_MODE == "vres":
            # VRES: 5-frame temporal grayscale super-resolution
            h, w = frame.shape[:2]
            scale = VRES_SCALE

            # Convert to grayscale
            if len(frame.shape) == 3:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            else:
                gray = frame

            # Downscale then upscale to create LR input, normalize to [-0.5, 0.5]
            lr_h, lr_w = h // scale, w // scale
            lr_frame = cv2.resize(gray, (lr_w, lr_h), interpolation=cv2.INTER_CUBIC)
            lr_upscaled = cv2.resize(lr_frame, (w, h), interpolation=cv2.INTER_CUBIC)
            lr_normalized = (lr_upscaled.astype(np.float32) / 255.0) - 0.5

            # Maintain 5-frame temporal buffer
            VRES_FRAME_BUFFER.append(lr_normalized)
            if len(VRES_FRAME_BUFFER) > 5:
                VRES_FRAME_BUFFER.pop(0)

            # Pad buffer if less than 5 frames
            while len(VRES_FRAME_BUFFER) < 5:
                VRES_FRAME_BUFFER.insert(0, VRES_FRAME_BUFFER[0])

            # Build 5-frame temporal input [1, 5, H, W]
            input_tensor = np.stack(VRES_FRAME_BUFFER, axis=0)
            input_tensor = torch.from_numpy(input_tensor).float()
            input_tensor = input_tensor.unsqueeze(0).to(AI_DEVICE)

            with torch.no_grad():
                output = AI_MODEL(input_tensor)

            # Post-process: denormalize
            output = output.squeeze().cpu().numpy()
            output = (output + 0.5) * 255.0
            output = np.clip(output, 0, 255).astype(np.uint8)

            # Convert back to BGR
            frame = cv2.cvtColor(output, cv2.COLOR_GRAY2BGR)

    except Exception as e:
        logging.warning(f"⚠️ AI enhancement failed, using original frame: {e}")

    return frame

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

        # Apply AI enhancement if active
        frame = apply_ai_enhancement(frame)

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

            elif action == "set-ai-model":
                mode = data.get("mode", "none")
                success = load_ai_model(mode)
                await websocket.send(json.dumps({
                    "action": "ai-model-set",
                    "success": success,
                    "mode": AI_MODE
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

