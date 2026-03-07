// preload.js - Expose Electron APIs to renderer
const { contextBridge, ipcRenderer } = require('electron');

// Expose electronAPI to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Get folder path for local media storage
    getMediaFolder: (roomID, type) => ipcRenderer.invoke('get-media-folder', roomID, type),

    // Save file to local disk
    saveLocalFile: (data) => ipcRenderer.invoke('save-local-file', data),

    // Get list of local media files for a room
    getLocalMediaList: (roomID, type) => ipcRenderer.invoke('get-local-media-list', roomID, type),

    // Delete local media folder for a room
    deleteLocalFolder: (roomID) => ipcRenderer.invoke('delete-local-folder', roomID),

    // Delete a specific local media file (for cloud-only saves)
    deleteLocalFile: (roomID, mediaType, filename) => ipcRenderer.invoke('delete-local-file', roomID, mediaType, filename),

    // Python USG screenshot (saves PNG directly via OpenCV)
    pythonScreenshot: (roomID) => ipcRenderer.invoke('python-screenshot', roomID),

    // Python USG start recording (saves MP4 directly via OpenCV)
    pythonStartRecording: (roomID, quality) => ipcRenderer.invoke('python-start-recording', roomID, quality),

    // Python USG stop recording
    pythonStopRecording: () => ipcRenderer.invoke('python-stop-recording'),

    // Read file as data URL (for displaying images in caliper)
    readFileAsDataUrl: (filePath) => ipcRenderer.invoke('read-file-as-dataurl', filePath),

    // Save annotated image (overwrite original with caliper annotations)
    saveAnnotatedImage: (filePath, buffer) => ipcRenderer.invoke('save-annotated-image', filePath, buffer)
});

window.addEventListener("DOMContentLoaded", () => {
    console.log("TeleUSG v6 Preload loaded");
});
