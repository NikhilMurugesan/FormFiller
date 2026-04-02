// For local development
const API_URL = "http://127.0.0.1:8000/analyze-fields";
// For Vercel production: const API_URL = "https://your-vercel-domain.vercel.app/analyze-fields";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ANALYZE_FIELDS") {
        // Forward session_id — no raw chunks needed, backend does RAG retrieval
        fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fields: request.fields,
                session_id: request.session_id || "formfiller_session"
            })
        })
        .then(res => {
            if (!res.ok) throw new Error(`API Error: ${res.status}`);
            return res.json();
        })
        .then(data => sendResponse(data))
        .catch(err => {
            console.error("Background Fetch Error:", err);
            sendResponse({ error: err.message });
        });

        return true;
    }
});
