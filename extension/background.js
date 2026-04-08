/**
 * Background Service Worker — FormFiller Pro (Manifest V3)
 * 
 * Responsibilities:
 *  - Keyboard shortcut handler (Alt+Shift+F)
 *  - Context menu ("Autofill with FormFiller")
 *  - Message routing between popup ↔ content script
 *  - Badge icon updates
 *  - Profile/settings access for content script FAB
 */

// ═══════════════════════════════════════════════════════════════
// SECTION 1: Storage Helpers (inline — service worker can't import)
// ═══════════════════════════════════════════════════════════════

function storageGet(key) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, r => resolve(r[key] ?? null));
  });
}

function storageSet(data) {
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2: Context Menu
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ff-autofill',
    title: '⚡ Autofill with FormFiller',
    contexts: ['page', 'editable'],
  });

  chrome.contextMenus.create({
    id: 'ff-scan',
    title: '🔍 Scan Form Fields',
    contexts: ['page'],
  });

  console.log('[FormFiller BG] Context menus registered');
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  // Ensure content script is injected
  await ensureContentScript(tab.id);

  if (info.menuItemId === 'ff-autofill') {
    const { profileData, domainMappings } = await getActiveProfileData(tab.url);
    chrome.tabs.sendMessage(tab.id, {
      action: 'AUTOFILL_ALL',
      profileData,
      domainMappings,
    });
  } else if (info.menuItemId === 'ff-scan') {
    const { profileData, domainMappings } = await getActiveProfileData(tab.url);
    chrome.tabs.sendMessage(tab.id, {
      action: 'SCAN_FORM',
      profileData,
      domainMappings,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: Keyboard Shortcut Handler
// ═══════════════════════════════════════════════════════════════

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'trigger-autofill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://')) return;

    await ensureContentScript(tab.id);
    const { profileData, domainMappings } = await getActiveProfileData(tab.url);

    chrome.tabs.sendMessage(tab.id, {
      action: 'AUTOFILL_ALL',
      profileData,
      domainMappings,
    }, (response) => {
      if (response?.status === 'success') {
        // Update badge with filled count
        const count = response.filled?.length || 0;
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId: tab.id });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: Message Router
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (request.action) {
        // ── Profile Data for Content Script / FAB ────────────
        case 'GET_ACTIVE_PROFILE': {
          const tab = sender.tab;
          const { profileData, domainMappings, profile } = await getActiveProfileData(tab?.url);
          sendResponse({ profile: { data: profileData, ...profile }, domainMappings });
          break;
        }

        // ── Settings for Content Script ──────────────────────
        case 'GET_SETTINGS': {
          const settings = await storageGet('ff_settings');
          sendResponse({ settings: settings || {} });
          break;
        }

        // ── AI Assist (proxy API call from content script) ───
        case 'ANALYZE_FIELDS': {
          // Legacy: forward to backend API
          const userData = await storageGet('ff_user_data');
          const settings = await storageGet('ff_settings');
          const apiUrl = (settings?.aiAssistUrl || 'https://form-filler-pi.vercel.app') + '/analyze-fields';

          try {
            const res = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: request.fields,
                session_id: request.session_id || 'formfiller_session',
                user_data: request.user_data || userData || null,
              }),
            });
            if (!res.ok) throw new Error(`API Error: ${res.status}`);
            const data = await res.json();
            sendResponse(data);
          } catch (err) {
            console.error('[FormFiller BG] API Error:', err);
            sendResponse({ error: err.message });
          }
          break;
        }

        // ── Badge Update ─────────────────────────────────────
        case 'UPDATE_BADGE': {
          const tabId = sender.tab?.id || request.tabId;
          if (tabId) {
            chrome.action.setBadgeText({ text: request.text || '', tabId });
            chrome.action.setBadgeBackgroundColor({ color: request.color || '#7c3aed', tabId });
          }
          sendResponse({ status: 'ok' });
          break;
        }

        default:
          sendResponse({ status: 'unknown_action' });
      }
    } catch (err) {
      console.error('[FormFiller BG] Message handler error:', err);
      sendResponse({ error: err.message });
    }
  };

  handler();
  return true; // Keep channel open for async
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Ensure content script + modules are injected in the given tab.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'modules/field-detector.js',
        'modules/mapping-engine.js',
        'modules/safety-filter.js',
        'modules/injection-engine.js',
        'modules/form-type-classifier.js',
        'modules/domain-intelligence.js',
        'content.js',
      ],
    });
  } catch (err) {
    // May fail on chrome:// pages or already injected — ignore
    console.log('[FormFiller BG] Script injection note:', err.message);
  }
}

/**
 * Get the active profile data and domain mappings for a URL.
 */
async function getActiveProfileData(url) {
  const profiles = await storageGet('ff_profiles') || [];
  const activeId = await storageGet('ff_active_profile_id') || 'personal_default';
  const profile = profiles.find(p => p.id === activeId) || profiles[0] || null;
  const profileData = profile?.data || {};

  let domainMappings = {};
  if (url) {
    try {
      const domain = new URL(url).hostname;
      const allMappings = await storageGet('ff_domain_mappings') || {};
      domainMappings = allMappings[domain] || {};
    } catch (_) {}
  }

  return { profileData, domainMappings, profile: { id: profile?.id, name: profile?.name, icon: profile?.icon } };
}

console.log('[FormFiller Pro] Background service worker initialized');
