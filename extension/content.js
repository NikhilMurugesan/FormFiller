// Guard against double-injection — Chrome may inject via manifest AND popup.js programmatically
if (typeof window._ffInitialized !== 'undefined') {
    // Already running — just re-attach the message listener safely
} else {
    window._ffInitialized = true;

const MAX_PASSES = 3;
const SESSION_ID = "formfiller_session";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_AUTOFILL") {
        (async () => {
            try {
                const result = await runAutofillSequence();
                sendResponse(result);
            } catch (err) {
                console.error("Content Script Error:", err);
                sendResponse({ status: "error", error: err.message });
            }
        })();
        return true;
    }
});

async function runAutofillSequence() {
    let totalLatency = 0;
    let totalCost = 0;
    let passCount = 0;
    let touchedFieldIds = new Set();

    const PRIORITY_TYPES = ['select-one', 'select-multiple', 'select', 'checkbox', 'radio'];

    while (passCount < MAX_PASSES) {
        passCount++;

        // Add 2.0s delay between passes to prevent triggering Google's API burst limit,
        // done on the client side so Vercel Serverless doesn't time out waiting.
        if (passCount > 1) {
            await new Promise(r => setTimeout(r, 2000));
        }

        let fieldsInfo = extractFields(touchedFieldIds);
        if (fieldsInfo.length === 0) {
            console.log(`Pass ${passCount}: No new fields. Done.`);
            break;
        }

        // Priority sort: selects/checkboxes first
        fieldsInfo.sort((a, b) => {
            return (PRIORITY_TYPES.includes(a.type) ? 0 : 1) - (PRIORITY_TYPES.includes(b.type) ? 0 : 1);
        });

        console.log(`Pass ${passCount} Fields:`, fieldsInfo);

        const mappedData = await chrome.runtime.sendMessage({
            type: "ANALYZE_FIELDS",
            fields: fieldsInfo,
            session_id: SESSION_ID
        });

        if (mappedData.error) throw new Error(mappedData.error);

        totalLatency += (mappedData.latency_sec || 0);
        totalCost += (mappedData.cost_usd || 0);

        const priorityMappings = mappedData.mappings.filter(m => {
            const el = document.getElementById(m.field_id);
            return el && PRIORITY_TYPES.includes(el.type);
        });
        const restMappings = mappedData.mappings.filter(m => {
            const el = document.getElementById(m.field_id);
            return !el || !PRIORITY_TYPES.includes(el.type);
        });

        injectData(priorityMappings, touchedFieldIds);
        await new Promise(r => setTimeout(r, 600));
        injectData(restMappings, touchedFieldIds);
        await new Promise(r => setTimeout(r, 400));
    }

    return {
        status: "success",
        latency: Number(totalLatency.toFixed(2)),
        cost: totalCost
    };
}

function extractFields(touchedFieldIds) {
    const inputs = document.querySelectorAll('input, select, textarea');
    const fields = [];
    let idCounter = 0;

    inputs.forEach((el) => {
        const isHidden = el.type === 'hidden' || el.style.display === 'none' ||
            (el.offsetParent === null && el.type !== 'checkbox' && el.type !== 'radio');

        if (isHidden || el.disabled || el.type === 'submit' || el.type === 'button') return;

        if (!el.id) el.id = `ai_autofill_${idCounter++}`;
        if (touchedFieldIds.has(el.id)) return;

        fields.push({
            id: el.id,
            name: el.name || null,
            placeholder: el.placeholder || null,
            type: el.type,
            label: findAssociatedLabel(el)
        });
    });

    return fields;
}

function findAssociatedLabel(el) {
    if (el.labels && el.labels.length > 0) return el.labels[0].innerText.trim();
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const sib = el.previousElementSibling;
    if (sib && sib.tagName.toLowerCase() === 'label') return sib.innerText.trim();
    return null;
}

function injectData(mappings, touchedFieldIds) {
    if (!Array.isArray(mappings)) return;
    mappings.forEach(mapping => {
        touchedFieldIds.add(mapping.field_id);
        if (mapping.value === null || mapping.value === undefined) return;

        const el = document.getElementById(mapping.field_id);
        if (!el) return;

        if (el.type === 'checkbox' || el.type === 'radio') {
            const v = String(mapping.value).toLowerCase();
            if (v === "true" || v === "yes" || v === "on" || v === el.value.toLowerCase()) {
                el.checked = true;
            }
        } else {
            el.value = mapping.value;
        }

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

} // end double-injection guard
