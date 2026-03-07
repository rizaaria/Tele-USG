// meeting.qos.js - Quality of Service Metrics for WebRTC
export function initQoS(ctx) {
    const { state, elements } = ctx;

    // QoS elements
    const qosPanel = document.getElementById("qosPanel");
    const btnQoS = document.getElementById("btnQoS");
    const qosDelay = document.getElementById("qosDelay");
    const qosThroughput = document.getElementById("qosThroughput");
    const qosPacketLoss = document.getElementById("qosPacketLoss");
    const qosJitter = document.getElementById("qosJitter");
    const exportQoSBtn = document.getElementById("exportQoS");

    // State
    let isCollecting = false;
    let collectInterval = null;
    let metricsHistory = [];
    // Track bytes per SSRC to handle multiple video tracks (camera + USG)
    const trackState = {};

    // Toggle QoS panel visibility
    if (btnQoS && qosPanel) {
        btnQoS.addEventListener("click", () => {
            qosPanel.classList.toggle("hidden");
        });
    }

    // Collect metrics from WebRTC peer connection
    async function collectMetrics() {
        const pc = ctx.rtc?.pc;
        if (!pc) return null;

        try {
            const stats = await pc.getStats();
            const metrics = {
                timestamp: Date.now(),
                delay: null,
                throughput: null,
                packetsLost: null,
                packetLossPercent: null,
                jitter: null
            };

            // Accumulators for aggregating across multiple video tracks
            let totalThroughputKbps = 0;
            let totalPacketsLost = 0;
            let totalPacketsReceived = 0;
            let maxJitter = null;
            let hasVideoTrack = false;

            stats.forEach(report => {
                // Get delay (RTT) from candidate-pair
                if (report.type === "candidate-pair" && report.state === "succeeded") {
                    if (report.currentRoundTripTime !== undefined) {
                        metrics.delay = Math.round(report.currentRoundTripTime * 1000); // Convert to ms
                    }
                }

                // Get packet loss and jitter from inbound-rtp (video)
                if (report.type === "inbound-rtp" && report.kind === "video") {
                    hasVideoTrack = true;
                    const ssrc = report.ssrc;

                    // Packet loss - accumulate across tracks
                    if (report.packetsLost !== undefined && report.packetsReceived !== undefined) {
                        totalPacketsLost += report.packetsLost;
                        totalPacketsReceived += report.packetsReceived;
                    }

                    // Jitter - take the max across tracks (in seconds, convert to ms)
                    if (report.jitter !== undefined) {
                        const jitterMs = report.jitter * 1000;
                        if (maxJitter === null || jitterMs > maxJitter) {
                            maxJitter = jitterMs;
                        }
                    }

                    // Throughput calculation per SSRC
                    if (report.bytesReceived !== undefined && report.timestamp !== undefined) {
                        const now = report.timestamp;
                        const bytes = report.bytesReceived;

                        if (!trackState[ssrc]) {
                            trackState[ssrc] = { lastBytes: 0, lastTimestamp: 0 };
                        }

                        const ts = trackState[ssrc];
                        if (ts.lastTimestamp > 0 && now > ts.lastTimestamp) {
                            const timeDiff = (now - ts.lastTimestamp) / 1000; // seconds
                            const bytesDiff = bytes - ts.lastBytes;
                            if (bytesDiff >= 0) {
                                totalThroughputKbps += (bytesDiff * 8 / 1000 / timeDiff);
                            }
                        }

                        ts.lastBytes = bytes;
                        ts.lastTimestamp = now;
                    }
                }
            });

            // Apply aggregated values
            if (hasVideoTrack) {
                metrics.packetsLost = totalPacketsLost;
                const totalPackets = totalPacketsLost + totalPacketsReceived;
                metrics.packetLossPercent = totalPackets > 0
                    ? ((totalPacketsLost / totalPackets) * 100).toFixed(2)
                    : "0.00";
                metrics.jitter = maxJitter !== null ? maxJitter.toFixed(2) : null;
                metrics.throughput = totalThroughputKbps > 0 ? totalThroughputKbps.toFixed(2) : null;
            }

            return metrics;
        } catch (err) {
            console.error("Error collecting QoS metrics:", err);
            return null;
        }
    }

    // Update UI with current metrics
    function updateUI(metrics) {
        if (!metrics) return;

        if (qosDelay) qosDelay.textContent = metrics.delay !== null ? `${metrics.delay} ms` : "-- ms";
        if (qosThroughput) qosThroughput.textContent = metrics.throughput !== null ? `${metrics.throughput} kbps` : "-- kbps";
        if (qosPacketLoss) qosPacketLoss.textContent = metrics.packetLossPercent !== null ? `${metrics.packetLossPercent}%` : "-- %";
        if (qosJitter) qosJitter.textContent = metrics.jitter !== null ? `${metrics.jitter} ms` : "-- ms";
    }

    // Start collecting metrics
    function startCollecting() {
        if (isCollecting) return;
        isCollecting = true;
        metricsHistory = [];
        // Reset per-SSRC tracking state
        Object.keys(trackState).forEach(key => delete trackState[key]);

        console.log("📊 QoS metrics collection started");

        collectInterval = setInterval(async () => {
            const metrics = await collectMetrics();
            if (metrics) {
                metricsHistory.push(metrics);
                updateUI(metrics);
            }
        }, 1000); // Poll every 1 second
    }

    // Stop collecting metrics
    function stopCollecting() {
        if (!isCollecting) return;
        isCollecting = false;

        if (collectInterval) {
            clearInterval(collectInterval);
            collectInterval = null;
        }

        console.log("📊 QoS metrics collection stopped. Total samples:", metricsHistory.length);
    }

    // Export metrics to CSV
    function exportCSV() {
        if (metricsHistory.length === 0) {
            if (ctx.showToast) ctx.showToast("Tidak ada data QoS untuk di-export.", "warning");
            return;
        }

        // Build CSV content
        const headers = ["Timestamp", "Delay (ms)", "Throughput (kbps)", "Packets Lost", "Packet Loss (%)", "Jitter (ms)"];
        const rows = metricsHistory.map(m => [
            new Date(m.timestamp).toISOString(),
            m.delay ?? "",
            m.throughput ?? "",
            m.packetsLost ?? "",
            m.packetLossPercent ?? "",
            m.jitter ?? ""
        ]);

        let csv = headers.join(",") + "\n";
        rows.forEach(row => {
            csv += row.join(",") + "\n";
        });

        // Download file
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `qos_metrics_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log("📊 QoS metrics exported to CSV");
    }

    // Export button handler
    if (exportQoSBtn) {
        exportQoSBtn.addEventListener("click", exportCSV);
    }

    // Return public API
    return {
        startCollecting,
        stopCollecting,
        exportCSV,
        getHistory: () => metricsHistory
    };
}
