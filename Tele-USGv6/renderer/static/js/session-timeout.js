// session-timeout.js - Session timeout with activity tracking
// Auto-logout after 30 minutes of inactivity

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_TIME_MS = 1 * 60 * 1000; // Show warning 5 minutes before

let timeoutId = null;
let warningId = null;
let warningModal = null;

// Initialize session timeout
export function initSessionTimeout(auth, signOut) {
    // Create warning modal
    createWarningModal();

    // Reset timer on user activity
    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
        document.addEventListener(event, resetTimer, { passive: true });
    });

    // Start the timer
    resetTimer();

    function resetTimer() {
        // Clear existing timers
        if (timeoutId) clearTimeout(timeoutId);
        if (warningId) clearTimeout(warningId);

        // Hide warning if shown
        hideWarning();

        // Set warning timer (5 min before timeout)
        warningId = setTimeout(() => {
            showWarning();
        }, SESSION_TIMEOUT_MS - WARNING_TIME_MS);

        // Set logout timer
        timeoutId = setTimeout(() => {
            performLogout(auth, signOut);
        }, SESSION_TIMEOUT_MS);
    }

    function showWarning() {
        if (warningModal) {
            warningModal.classList.remove('hidden');

            // Start countdown
            let remaining = Math.floor(WARNING_TIME_MS / 1000);
            const countdownEl = document.getElementById('sessionCountdown');

            const countdownInterval = setInterval(() => {
                remaining--;
                const minutes = Math.floor(remaining / 60);
                const seconds = remaining % 60;
                if (countdownEl) {
                    countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                }
                if (remaining <= 0) {
                    clearInterval(countdownInterval);
                }
            }, 1000);

            warningModal.countdownInterval = countdownInterval;
        }
    }

    function hideWarning() {
        if (warningModal) {
            warningModal.classList.add('hidden');
            if (warningModal.countdownInterval) {
                clearInterval(warningModal.countdownInterval);
            }
        }
    }

    async function performLogout(auth, signOut) {
        hideWarning();
        try {
            await signOut(auth);
        } catch (err) {
            console.error("Logout error:", err);
        }
        window.location.href = '/login?reason=timeout';
    }

    // Stay logged in button handler
    window.stayLoggedIn = () => {
        resetTimer();
    };

    return {
        reset: resetTimer,
        stop: () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (warningId) clearTimeout(warningId);
            hideWarning();
        }
    };
}

function createWarningModal() {
    warningModal = document.createElement('div');
    warningModal.id = 'sessionWarningModal';
    warningModal.className = 'session-warning-modal hidden';
    warningModal.innerHTML = `
        <div class="session-warning-content">
            <div class="session-warning-icon"><img src="/static/img/Warning.png" style="width: 60px; height: 60px;"></div>
            <h3>Sesi akan berakhir</h3>
            <p>Anda akan otomatis logout dalam <span id="sessionCountdown">5:00</span></p>
            <button onclick="stayLoggedIn()" class="session-stay-btn">Tetap Login</button>
        </div>
    `;
    document.body.appendChild(warningModal);

    // Add styles (matching app theme: white, grey, blue)
    const style = document.createElement('style');
    style.textContent = `
        .session-warning-modal {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100001;
        }
        .session-warning-modal.hidden {
            display: none;
        }
        .session-warning-content {
            background: white;
            padding: 50px 70px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        }
        .session-warning-icon {
            font-size: 60px;
            margin-bottom: 20px;
        }
        .session-warning-content h3 {
            color: #333;
            font-size: 24px;
            margin-bottom: 15px;
            font-family: 'Poppins', sans-serif;
            font-weight: 700;
        }
        .session-warning-content p {
            color: #666;
            font-size: 16px;
            margin-bottom: 30px;
            font-family: 'Poppins', sans-serif;
        }
        .session-warning-content #sessionCountdown {
            color: #E33434;
            font-weight: bold;
            font-size: 20px;
        }
        .session-stay-btn {
            background: #5969F2;
            border: none;
            padding: 14px 45px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            color: white;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: 'Poppins', sans-serif;
        }
        .session-stay-btn:hover {
            background: #4858e0;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(89, 105, 242, 0.3);
        }
    `;
    document.head.appendChild(style);
}
