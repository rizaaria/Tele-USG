// toast.js - Shared toast notification system for TeleUSG
// Usage: import { showToast } from "./toast.js";
// Types: "success", "error", "warning", "hint", "loading"

// Inject animation styles once
const _toastStyle = document.createElement("style");
_toastStyle.textContent = `
    @keyframes toast-slide-up {
        from { transform: translateX(-50%) translateY(100px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
    }
    @keyframes toast-slide-down {
        from { transform: translateX(-50%) translateY(0); opacity: 1; }
        to { transform: translateX(-50%) translateY(100px); opacity: 0; }
    }
`;
document.head.appendChild(_toastStyle);

const TOAST_ICONS = {
    success: '/static/img/Succes.png',
    error: '/static/img/Error.png',
    warning: '/static/img/Warning.png',
    hint: '/static/img/Lightbulp.png',
    loading: '/static/img/Loading.png',
};

const TOAST_COLORS = {
    success: "linear-gradient(135deg, #2ecc71, #27ae60)",
    error: "linear-gradient(135deg, #e74c3c, #c0392b)",
    warning: "linear-gradient(135deg, #f39c12, #e67e22)",
    hint: "linear-gradient(135deg, #3498db, #2980b9)",
    loading: "linear-gradient(135deg, #3498db, #2980b9)",
};

export function showToast(message, type = "success", duration = 3000) {
    const existing = document.querySelector(".toast-notification");
    if (existing) existing.remove();

    const icon = TOAST_ICONS[type] || TOAST_ICONS.success;
    const bg = TOAST_COLORS[type] || TOAST_COLORS.success;

    const toast = document.createElement("div");
    toast.className = "toast-notification";
    toast.innerHTML = `
        <div class="toast-icon"><img src="${icon}" class="toast-img"></div>
        <div class="toast-message">${message}</div>
    `;

    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bg};
        color: white;
        padding: 12px 24px;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 99999;
        animation: toast-slide-up 0.3s ease-out;
        font-family: 'Poppins', sans-serif;
        font-size: 14px;
        font-weight: 500;
        max-width: 90vw;
    `;

    document.body.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => {
            toast.style.animation = "toast-slide-down 0.3s ease-in forwards";
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    return toast;
}
