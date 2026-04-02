const API_BASE = "http://127.0.0.1:8000";
const SESSION_ID = "formfiller_session";
const STORAGE_KEY = "ff_doc_meta"; // Only storing metadata now, NOT raw chunks

// --- On Load: Restore cached document metadata ---
document.addEventListener("DOMContentLoaded", async () => {
    // Check browser-cached metadata
    const meta = await getCachedMeta();
    if (meta) {
        // Also verify the backend still has the embeddings (e.g. after server restart)
        try {
            const res = await fetch(`${API_BASE}/document-status?session_id=${SESSION_ID}`);
            if (!res.ok) throw new Error(`Server ${res.status}`);
            const data = await res.json();
            if (data.cached) {
                showDocBadge(meta.filename, data.chunk_count);
                setUploadStatus("✅ Embeddings loaded from cache", "info");
            } else {
                // Backend lost cache (restart) — prompt re-upload
                setUploadStatus("⚠️ Server restarted — please re-upload", "error");
                await chrome.storage.local.remove(STORAGE_KEY);
            }
        } catch (_) {
            setUploadStatus("⚠️ Backend offline", "error");
        }
    }
});

// --- File Upload Handler ---
document.getElementById("docFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadStatus("⏳ Uploading and embedding chunks...", "loading");

    try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("session_id", SESSION_ID);

        const res = await fetch(`${API_BASE}/upload-document`, {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "Upload failed");
        }

        const data = await res.json();

        // Cache ONLY lightweight metadata — not raw chunks!
        await setCachedMeta({ filename: data.filename, session_id: SESSION_ID });

        showDocBadge(data.filename, data.chunk_count);
        setUploadStatus(`✅ ${data.chunk_count} chunks embedded & cached`, "info");

    } catch (err) {
        setUploadStatus(`❌ ${err.message}`, "error");
    }
});

// --- Autofill Button ---
document.getElementById("autofillBtn").addEventListener("click", async () => {
    const btn = document.getElementById("autofillBtn");
    btn.disabled = true;
    btn.textContent = "Analyzing Form...";
    setStatus("Extracting fields...", "loading");

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) {
            throw new Error("Cannot run on this page.");
        }

        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        } catch (_) {}
        await new Promise(r => setTimeout(r, 100));

        const response = await chrome.tabs.sendMessage(tab.id, { action: "START_AUTOFILL" });

        if (response && response.status === "success") {
            const costText = response.cost !== undefined ? ` • $${response.cost.toFixed(6)}` : "";
            const timeText = response.latency !== undefined ? ` (${response.latency}s${costText})` : "";
            setStatus(`✨ Done!${timeText}`, "success");
            btn.textContent = "✅ Filled";
        } else {
            throw new Error(response ? response.error : "No response from page");
        }

    } catch (error) {
        setStatus(`Error: ${error.message}`, "error");
        btn.disabled = false;
        btn.textContent = "🪄 Autofill Form";
    }
});

// --- Clear Cache Button ---
document.getElementById("clearBtn").addEventListener("click", async () => {
    setStatus("Clearing cache...", "loading");
    try {
        await chrome.storage.local.remove(STORAGE_KEY);
        await fetch(`${API_BASE}/clear-storage?session_id=${SESSION_ID}`, { method: "DELETE" });

        document.getElementById("docBadge").classList.remove("visible");
        document.getElementById("docFileInput").value = "";
        setUploadStatus("", "");
        setStatus("🗑 Cache cleared.", "info");

        const btn = document.getElementById("autofillBtn");
        btn.disabled = false;
        btn.textContent = "🪄 Autofill Form";

    } catch (err) {
        setStatus(`Clear failed: ${err.message}`, "error");
    }
});

// --- Helpers ---
function showDocBadge(filename, chunkCount) {
    document.getElementById("docName").textContent = filename;
    document.getElementById("docChunks").textContent = `${chunkCount} chunks`;
    document.getElementById("docBadge").classList.add("visible");
}

function setStatus(msg, cls) {
    const el = document.getElementById("status");
    el.textContent = msg;
    el.className = cls;
}

function setUploadStatus(msg, cls) {
    const el = document.getElementById("uploadStatus");
    el.textContent = msg;
    el.className = cls;
}

async function getCachedMeta() {
    return new Promise(resolve => {
        chrome.storage.local.get(STORAGE_KEY, r => resolve(r[STORAGE_KEY] || null));
    });
}

async function setCachedMeta(data) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
    });
}
