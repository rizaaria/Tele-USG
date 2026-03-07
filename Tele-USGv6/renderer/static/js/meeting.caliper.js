// meeting.caliper.js - Caliper measurement tool for USG screenshots
import { showToast } from "./toast.js";
export function initCaliper() {
    // DOM Elements
    const modal = document.getElementById("caliperModal");
    const canvas = document.getElementById("caliperCanvas");
    const imageDisplay = document.getElementById("caliperImage");
    const closeBtn = document.getElementById("closeCaliperModal");
    const measureBtn = document.getElementById("caliperMeasure");
    const calibrateBtn = document.getElementById("caliperCalibrate");
    const undoBtn = document.getElementById("caliperUndo");
    const clearBtn = document.getElementById("caliperClear");
    const saveBtn = document.getElementById("caliperSave");
    const uploadBtn = document.getElementById("caliperUpload");
    const measurementsList = document.getElementById("caliperMeasurements");
    const scaleDisplay = document.getElementById("caliperScale");
    const calibrateInput = document.getElementById("calibrateInput");
    const confirmCalibrateBtn = document.getElementById("confirmCalibrate");
    const calibratePanel = document.getElementById("calibratePanel");

    if (!canvas || !modal) return null;

    const ctx = canvas.getContext("2d");

    // State
    let currentImage = null;
    let currentImageBlob = null;
    let scale = 0.2; // Default: 0.2 mm per pixel (approximate)
    let isCalibrated = false;
    let mode = "measure"; // "measure" or "calibrate"
    let isDrawing = false;
    let startPoint = null;
    let endPoint = null;
    let measurements = [];
    let calibrationLine = null;

    // Colors
    const MEASURE_COLOR = "#00ff00"; // Green for measurements
    const CALIBRATE_COLOR = "#ffff00"; // Yellow for calibration
    const ACTIVE_COLOR = "#ff0000"; // Red while drawing

    // Open modal with image
    function open(imageDataUrl, blob) {
        currentImage = new Image();
        currentImage.onload = () => {
            // Set canvas size to match image
            canvas.width = currentImage.width;
            canvas.height = currentImage.height;

            // Set image display
            imageDisplay.src = imageDataUrl;

            // Clear previous state
            measurements = [];
            calibrationLine = null;
            isCalibrated = false;
            mode = "measure";
            updateMeasurementsList();
            updateScaleDisplay();
            updateToolButtons();

            // Show modal
            modal.classList.remove("hidden");
        };
        currentImage.src = imageDataUrl;
        currentImageBlob = blob;
    }

    // Close modal
    function close() {
        modal.classList.add("hidden");
        currentImage = null;
        currentImageBlob = null;
        measurements = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Restore save button visibility for next use
        if (saveBtn) saveBtn.style.display = '';
    }

    // Update tool buttons state
    function updateToolButtons() {
        if (measureBtn) measureBtn.classList.toggle("active", mode === "measure");
        if (calibrateBtn) calibrateBtn.classList.toggle("active", mode === "calibrate");
        if (calibratePanel) calibratePanel.classList.toggle("hidden", mode !== "calibrate" || !calibrationLine);
    }

    // Update scale display
    function updateScaleDisplay() {
        if (scaleDisplay) {
            scaleDisplay.innerHTML = isCalibrated
                ? `${scale.toFixed(3)} mm/px <img src="/static/img/Succes.png" class="inline-icon" alt="">`
                : `${scale.toFixed(3)} mm/px (default)`;
        }
    }

    // Update measurements list
    function updateMeasurementsList() {
        if (!measurementsList) return;

        if (measurements.length === 0) {
            measurementsList.innerHTML = '<p class="no-measurements">Belum ada pengukuran</p>';
            return;
        }

        measurementsList.innerHTML = measurements.map((m, i) => {
            const distanceMm = m.pixels * scale;
            const direction = Math.abs(m.end.x - m.start.x) > Math.abs(m.end.y - m.start.y) ? "H" : "V";
            return `<div class="measurement-item">
                <span>${direction}${i + 1}: ${distanceMm.toFixed(2)} mm</span>
                <span class="measurement-pixels">(${m.pixels.toFixed(0)} px)</span>
            </div>`;
        }).join("");
    }

    // Calculate distance between two points
    function getDistance(p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Draw all lines on canvas
    function redrawCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw calibration line if exists
        if (calibrationLine) {
            drawLine(calibrationLine.start, calibrationLine.end, CALIBRATE_COLOR, "CAL");
        }

        // Draw all measurements
        measurements.forEach((m, i) => {
            const direction = Math.abs(m.end.x - m.start.x) > Math.abs(m.end.y - m.start.y) ? "H" : "V";
            drawLine(m.start, m.end, MEASURE_COLOR, `${direction}${i + 1}`);
        });
    }

    // Draw a single line with markers
    function drawLine(start, end, color, label) {
        // Line
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Endpoints markers
        drawMarker(start, color);
        drawMarker(end, color);

        // Label
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        ctx.fillStyle = color;
        ctx.font = "bold 14px Arial";
        ctx.fillText(label, midX + 5, midY - 5);
    }

    // Draw endpoint marker
    function drawMarker(point, color) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Get canvas coordinates from mouse event
    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    // Mouse event handlers
    canvas.addEventListener("mousedown", (e) => {
        isDrawing = true;
        startPoint = getCanvasCoords(e);
        endPoint = startPoint;
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!isDrawing) return;
        endPoint = getCanvasCoords(e);

        // Redraw with current line
        redrawCanvas();
        drawLine(startPoint, endPoint, ACTIVE_COLOR, "...");
    });

    canvas.addEventListener("mouseup", (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        endPoint = getCanvasCoords(e);

        const distance = getDistance(startPoint, endPoint);
        if (distance < 10) return; // Too short, ignore

        if (mode === "calibrate") {
            calibrationLine = { start: startPoint, end: endPoint, pixels: distance };
            calibratePanel?.classList.remove("hidden");
        } else {
            measurements.push({ start: startPoint, end: endPoint, pixels: distance });
            updateMeasurementsList();
        }

        redrawCanvas();
    });

    canvas.addEventListener("mouseleave", () => {
        if (isDrawing) {
            isDrawing = false;
            redrawCanvas();
        }
    });

    // Tool button handlers
    measureBtn?.addEventListener("click", () => {
        mode = "measure";
        updateToolButtons();
    });

    calibrateBtn?.addEventListener("click", () => {
        mode = "calibrate";
        updateToolButtons();
    });

    undoBtn?.addEventListener("click", () => {
        if (measurements.length > 0) {
            measurements.pop();
            updateMeasurementsList();
            redrawCanvas();
        }
    });

    clearBtn?.addEventListener("click", () => {
        measurements = [];
        calibrationLine = null;
        isCalibrated = false;
        calibratePanel?.classList.add("hidden");
        updateMeasurementsList();
        updateScaleDisplay();
        redrawCanvas();
    });

    // Calibration confirm
    confirmCalibrateBtn?.addEventListener("click", () => {
        const inputValue = parseFloat(calibrateInput?.value);
        if (isNaN(inputValue) || inputValue <= 0 || !calibrationLine) {
            showToast("Masukkan nilai yang valid (mm)", "warning");
            return;
        }

        scale = inputValue / calibrationLine.pixels;
        isCalibrated = true;
        mode = "measure";
        updateScaleDisplay();
        updateMeasurementsList(); // Recalculate with new scale
        updateToolButtons();
        calibratePanel?.classList.add("hidden");
    });

    // Close button

    // Save handlers (to be connected by meeting.record.js)
    let saveCallback = null;
    let uploadCallback = null;
    let cancelCallback = null;

    function setSaveCallback(cb) { saveCallback = cb; }
    function setUploadCallback(cb) { uploadCallback = cb; }

    // Create image with caliper annotations merged
    async function getAnnotatedImageBlob() {
        if (!currentImage) return currentImageBlob;

        // Create a new canvas to merge image + annotations
        const mergeCanvas = document.createElement("canvas");
        mergeCanvas.width = currentImage.width;
        mergeCanvas.height = currentImage.height;
        const mergeCtx = mergeCanvas.getContext("2d");

        // Draw original image
        mergeCtx.drawImage(currentImage, 0, 0);

        // Draw annotations (measurements only, not calibration line)
        measurements.forEach((m, i) => {
            const direction = Math.abs(m.end.x - m.start.x) > Math.abs(m.end.y - m.start.y) ? "H" : "V";
            const distanceMm = m.pixels * scale;
            const label = `${direction}${i + 1}: ${distanceMm.toFixed(1)}mm`;

            // Draw line
            mergeCtx.beginPath();
            mergeCtx.moveTo(m.start.x, m.start.y);
            mergeCtx.lineTo(m.end.x, m.end.y);
            mergeCtx.strokeStyle = MEASURE_COLOR;
            mergeCtx.lineWidth = 2;
            mergeCtx.stroke();

            // Draw endpoints
            [m.start, m.end].forEach(point => {
                mergeCtx.beginPath();
                mergeCtx.arc(point.x, point.y, 5, 0, Math.PI * 2);
                mergeCtx.fillStyle = MEASURE_COLOR;
                mergeCtx.fill();
                mergeCtx.strokeStyle = "#000";
                mergeCtx.lineWidth = 1;
                mergeCtx.stroke();
            });

            // Draw label with background
            const midX = (m.start.x + m.end.x) / 2;
            const midY = (m.start.y + m.end.y) / 2;
            mergeCtx.font = "bold 14px Arial";
            const textWidth = mergeCtx.measureText(label).width;

            // Background for text
            mergeCtx.fillStyle = "rgba(0,0,0,0.7)";
            mergeCtx.fillRect(midX + 3, midY - 16, textWidth + 6, 18);

            // Text
            mergeCtx.fillStyle = MEASURE_COLOR;
            mergeCtx.fillText(label, midX + 6, midY - 3);
        });

        // Convert to blob
        return new Promise((resolve) => {
            mergeCanvas.toBlob(resolve, "image/png");
        });
    }

    saveBtn?.addEventListener("click", async () => {
        if (saveCallback) {
            const annotatedBlob = await getAnnotatedImageBlob();
            try {
                await saveCallback(annotatedBlob, getMeasurementsData());
            } catch (err) {
                console.error("Save callback error:", err);
            }
            close();
        }
    });

    uploadBtn?.addEventListener("click", async () => {
        if (uploadCallback) {
            const annotatedBlob = await getAnnotatedImageBlob();
            try {
                await uploadCallback(annotatedBlob, getMeasurementsData());
            } catch (err) {
                console.error("Upload callback error:", err);
            }
            close();
        }
    });

    // Close button (X) - cancel without saving
    closeBtn?.addEventListener("click", () => {
        if (cancelCallback) {
            cancelCallback();
        }
        close();
    });

    // Get measurements data for export
    function getMeasurementsData() {
        return {
            scale: scale,
            isCalibrated: isCalibrated,
            measurements: measurements.map((m, i) => ({
                index: i + 1,
                direction: Math.abs(m.end.x - m.start.x) > Math.abs(m.end.y - m.start.y) ? "H" : "V",
                pixels: m.pixels,
                mm: m.pixels * scale
            }))
        };
    }

    // Open caliper with image from URL (for remote screenshots)
    async function openWithImageUrl(imageUrl, cloudSaveCallback, cancelCb) {
        try {
            // Fetch image from URL
            const response = await fetch(imageUrl);
            const blob = await response.blob();

            // Convert to data URL
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });

            // Set upload callback for cloud save (Upload button)
            setUploadCallback(async (annotatedBlob, measurementsData) => {
                if (cloudSaveCallback) {
                    await cloudSaveCallback(annotatedBlob);
                }
            });

            // No local save option for remote screenshots - clear save callback and hide button
            setSaveCallback(null);
            if (saveBtn) saveBtn.style.display = 'none';

            setCancelCallback(cancelCb);

            // Open caliper with the image
            open(dataUrl, blob);
        } catch (err) {
            console.error("Failed to open caliper with URL:", err);
            if (cancelCb) cancelCb();
        }
    }

    function setCancelCallback(cb) { cancelCallback = cb; }

    return {
        open,
        close,
        openWithImageUrl,
        setSaveCallback,
        setUploadCallback,
        setCancelCallback,
        getMeasurementsData,
        getAnnotatedImageBlob
    };
}
