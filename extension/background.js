// For local development
// const API_URL = "http://127.0.0.1:8000/analyze-fields";
const API_URL = "https://form-filler-pi.vercel.app//analyze-fields";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ANALYZE_FIELDS") {
        // Read user data from cache first
        chrome.storage.local.get("ff_user_data", (res) => {
            const userData = res.ff_user_data || null;

            fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fields: request.fields,
                    session_id: request.session_id || "formfiller_session",
                    user_data: userData
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
        });

        return true;
    }
});
