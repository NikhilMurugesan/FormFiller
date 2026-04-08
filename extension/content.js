/**
 * Content Script — FormFiller Pro
 * 
 * Injected into every page. Responsibilities:
 *  1. Floating Action Button (FAB) overlay on every page
 *  2. Message handling for popup ↔ content script communication
 *  3. Orchestrates scan → match → filter → inject pipeline
 *  4. MutationObserver for SPA page changes
 *  5. Supports multi-step forms with delayed rescan
 */

// ═══════════════════════════════════════════════════════════════
// Guard against double-injection
// ═══════════════════════════════════════════════════════════════
if (typeof window._ffProInitialized === 'undefined') {
  window._ffProInitialized = true;

  // ─── State ─────────────────────────────────────────────────
  let _filledFieldIds = new Set();
  let _lastScanResults = null;
  let _fabElement = null;
  let _fabMenuElement = null;
  let _isProcessing = false;

  // ═══════════════════════════════════════════════════════════
  // SECTION 1: Floating Action Button (FAB)
  // ═══════════════════════════════════════════════════════════
  function createFAB() {
    // Don't inject FAB on extension pages or non-http pages
    if (!window.location.protocol.startsWith('http')) return;
    if (_fabElement) return;

    // ─── FAB Styles ──────────────────────────────────────────
    const style = document.createElement('style');
    style.id = 'ff-pro-fab-styles';
    style.textContent = `
      #ff-pro-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background: linear-gradient(135deg, #7c3aed, #ec4899);
        color: #fff;
        border: none;
        cursor: pointer;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        box-shadow: 0 4px 20px rgba(124, 58, 237, 0.45), 0 2px 8px rgba(0,0,0,0.2);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        user-select: none;
        -webkit-user-select: none;
      }
      #ff-pro-fab:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 28px rgba(124, 58, 237, 0.6), 0 4px 12px rgba(0,0,0,0.3);
      }
      #ff-pro-fab:active {
        transform: scale(0.95);
      }
      #ff-pro-fab.processing {
        animation: ff-pulse 1.2s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes ff-pulse {
        0%, 100% { box-shadow: 0 4px 20px rgba(124, 58, 237, 0.45); }
        50% { box-shadow: 0 4px 30px rgba(236, 72, 153, 0.7); }
      }

      #ff-pro-fab-menu {
        position: fixed;
        bottom: 84px;
        right: 24px;
        z-index: 2147483646;
        display: none;
        flex-direction: column;
        gap: 6px;
        animation: ff-menu-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      #ff-pro-fab-menu.visible {
        display: flex;
      }
      @keyframes ff-menu-in {
        from { opacity: 0; transform: translateY(10px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .ff-fab-action {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        background: rgba(15, 12, 41, 0.95);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(167, 139, 250, 0.3);
        border-radius: 12px;
        color: #e2e8f0;
        font-size: 13px;
        font-family: 'Segoe UI', -apple-system, sans-serif;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
      .ff-fab-action:hover {
        background: rgba(124, 58, 237, 0.25);
        border-color: #a78bfa;
        transform: translateX(-4px);
      }
      .ff-fab-action .ff-fab-icon {
        font-size: 16px;
        width: 20px;
        text-align: center;
      }

      #ff-pro-toast {
        position: fixed;
        bottom: 84px;
        right: 84px;
        z-index: 2147483647;
        padding: 10px 18px;
        background: rgba(15, 12, 41, 0.95);
        backdrop-filter: blur(16px);
        border: 1px solid rgba(110, 231, 183, 0.4);
        border-radius: 12px;
        color: #6ee7b7;
        font-size: 13px;
        font-family: 'Segoe UI', -apple-system, sans-serif;
        font-weight: 500;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        opacity: 0;
        transform: translateY(8px);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
      }
      #ff-pro-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }
      #ff-pro-toast.error {
        border-color: rgba(248, 113, 113, 0.4);
        color: #fca5a5;
      }
    `;
    document.head.appendChild(style);

    // ─── FAB Button ──────────────────────────────────────────
    _fabElement = document.createElement('button');
    _fabElement.id = 'ff-pro-fab';
    _fabElement.innerHTML = '⚡';
    _fabElement.title = 'FormFiller Pro';
    document.body.appendChild(_fabElement);

    // ─── FAB Menu ────────────────────────────────────────────
    _fabMenuElement = document.createElement('div');
    _fabMenuElement.id = 'ff-pro-fab-menu';
    _fabMenuElement.innerHTML = `
      <button class="ff-fab-action" data-action="autofill-all">
        <span class="ff-fab-icon">⚡</span> Autofill All
      </button>
      <button class="ff-fab-action" data-action="fill-empty">
        <span class="ff-fab-icon">📝</span> Fill Empty Only
      </button>
      <button class="ff-fab-action" data-action="clear">
        <span class="ff-fab-icon">🗑️</span> Clear Filled
      </button>
      <button class="ff-fab-action" data-action="scan">
        <span class="ff-fab-icon">🔍</span> Scan Form
      </button>
    `;
    document.body.appendChild(_fabMenuElement);

    // ─── Toast ───────────────────────────────────────────────
    const toast = document.createElement('div');
    toast.id = 'ff-pro-toast';
    document.body.appendChild(toast);

    // ─── Event Handlers ──────────────────────────────────────
    _fabElement.addEventListener('click', (e) => {
      e.stopPropagation();
      _fabMenuElement.classList.toggle('visible');
    });

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!_fabMenuElement.contains(e.target) && e.target !== _fabElement) {
        _fabMenuElement.classList.remove('visible');
      }
    });

    // Menu action handlers
    _fabMenuElement.addEventListener('click', async (e) => {
      const btn = e.target.closest('.ff-fab-action');
      if (!btn) return;
      const action = btn.dataset.action;
      _fabMenuElement.classList.remove('visible');

      switch (action) {
        case 'autofill-all':
          await handleAutofillFromFab(false);
          break;
        case 'fill-empty':
          await handleAutofillFromFab(true);
          break;
        case 'clear':
          handleClearFromFab();
          break;
        case 'scan':
          await handleScanFromFab();
          break;
      }
    });
  }

  // ─── FAB Action Handlers ─────────────────────────────────
  async function handleAutofillFromFab(onlyEmpty) {
    if (_isProcessing) return;
    _isProcessing = true;
    _fabElement.classList.add('processing');
    _fabElement.innerHTML = '⏳';

    try {
      // Request profile data from background
      const response = await chrome.runtime.sendMessage({
        action: 'GET_ACTIVE_PROFILE',
      });

      if (!response || !response.profile) {
        showToast('No profile found. Open extension to set up.', true);
        return;
      }

      const result = await performAutofill(response.profile.data, response.domainMappings || {}, onlyEmpty);
      const filledCount = result.filled.length;
      const totalFields = result.filled.length + result.skipped.length + result.blocked.length + result.failed.length;
      showToast(`✨ ${filledCount} of ${totalFields} fields filled`);
    } catch (err) {
      console.error('[FormFiller FAB]', err);
      showToast('Error: ' + err.message, true);
    } finally {
      _isProcessing = false;
      _fabElement.classList.remove('processing');
      _fabElement.innerHTML = '⚡';
    }
  }

  function handleClearFromFab() {
    const count = InjectionEngine.clearFilled();
    _filledFieldIds.clear();
    showToast(`🗑️ Cleared ${count} fields`);
  }

  async function handleScanFromFab() {
    const fields = await FieldDetector.scanWithRetry();
    const safetyResult = SafetyFilter.filterFields(fields);
    const formType = FormTypeClassifier.classify(fields);
    showToast(`🔍 Found ${fields.length} fields • ${formType.icon} ${formType.label}`);
  }

  function showToast(msg, isError = false) {
    const toast = document.getElementById('ff-pro-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = isError ? 'visible error' : 'visible';
    setTimeout(() => { toast.className = ''; }, 3500);
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: Core Autofill Pipeline
  // ═══════════════════════════════════════════════════════════

  /**
   * Full autofill pipeline: scan → safety filter → match → inject
   */
  async function performAutofill(profileData, domainOverrides = {}, onlyEmpty = false) {
    // Step 1: Scan fields with retry for dynamic forms
    const fields = await FieldDetector.scanWithRetry(_filledFieldIds);

    if (fields.length === 0) {
      return { filled: [], skipped: [], blocked: [], failed: [], formType: null };
    }

    // Step 2: Classify form type
    const formType = FormTypeClassifier.classify(fields);
    console.log(`[FormFiller] Form type: ${formType.label} (${formType.confidence}%)`);

    // Step 3: Safety filter — remove sensitive fields
    const { safe, blocked } = SafetyFilter.filterFields(fields);

    // Step 4: Match fields to profile keys
    let mappings = MappingEngine.matchAllFields(safe, profileData, domainOverrides);

    // Step 5: Apply domain intelligence overrides
    mappings = DomainIntelligence.applyOverrides(mappings, domainOverrides, profileData);

    // Step 6: Inject values
    const injectionResult = InjectionEngine.injectAll(mappings, { onlyEmpty });

    // Track filled IDs
    for (const f of injectionResult.filled) {
      _filledFieldIds.add(f.id);
    }

    return {
      filled: injectionResult.filled,
      skipped: injectionResult.skipped,
      blocked: blocked.map(b => ({ id: b.field.id, reason: b.reason })),
      failed: injectionResult.failed,
      formType,
      totalFields: fields.length,
      mappings, // for preview panel
    };
  }

  /**
   * Scan-only pipeline — returns preview data without injecting.
   */
  async function performScan(profileData, domainOverrides = {}) {
    const fields = await FieldDetector.scanWithRetry(new Set());
    const formType = FormTypeClassifier.classify(fields);
    const { safe, blocked } = SafetyFilter.filterFields(fields);
    let mappings = MappingEngine.matchAllFields(safe, profileData, domainOverrides);
    mappings = DomainIntelligence.applyOverrides(mappings, domainOverrides, profileData);

    return {
      fields,
      formType,
      safe,
      blocked,
      mappings,
      totalFields: fields.length,
      matchedCount: mappings.filter(m => m.status === 'matched').length,
      unmatchedCount: mappings.filter(m => m.status === 'unmatched').length,
      blockedCount: blocked.length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 3: Message Handlers (Popup ↔ Content Script)
  // ═══════════════════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = async () => {
      try {
        switch (request.action) {
          case 'SCAN_FORM': {
            const result = await performScan(
              request.profileData || {},
              request.domainMappings || {}
            );
            // Serialize results — can't send DOM elements
            sendResponse({
              status: 'success',
              formType: result.formType,
              totalFields: result.totalFields,
              matchedCount: result.matchedCount,
              unmatchedCount: result.unmatchedCount,
              blockedCount: result.blockedCount,
              mappings: result.mappings.map(m => ({
                fieldId: m.field.id,
                fieldName: m.field.name,
                fieldLabel: m.field.label || m.field.placeholder || m.field.name || m.field.id,
                fieldType: m.field.type,
                profileKey: m.match?.profileKey || null,
                value: m.value,
                confidence: m.match?.confidence || 0,
                matchSource: m.match?.matchSource || null,
                status: m.status,
                required: m.field.required,
                options: m.field.options,
              })),
              blocked: result.blocked.map(b => ({
                fieldId: b.field.id,
                fieldLabel: b.field.label || b.field.name || b.field.id,
                reason: b.reason,
              })),
              domain: DomainIntelligence.getDomain(),
              url: window.location.href,
              pageTitle: document.title,
            });
            break;
          }

          case 'AUTOFILL_ALL': {
            const result = await performAutofill(
              request.profileData || {},
              request.domainMappings || {},
              false
            );
            sendResponse({
              status: 'success',
              filled: result.filled,
              skipped: result.skipped,
              blocked: result.blocked,
              failed: result.failed,
              formType: result.formType,
              totalFields: result.totalFields,
            });
            break;
          }

          case 'AUTOFILL_EMPTY': {
            const result = await performAutofill(
              request.profileData || {},
              request.domainMappings || {},
              true
            );
            sendResponse({
              status: 'success',
              filled: result.filled,
              skipped: result.skipped,
              blocked: result.blocked,
              failed: result.failed,
              formType: result.formType,
              totalFields: result.totalFields,
            });
            break;
          }

          case 'CLEAR_FILLED': {
            const count = InjectionEngine.clearFilled();
            _filledFieldIds.clear();
            sendResponse({ status: 'success', clearedCount: count });
            break;
          }

          case 'FILL_SINGLE': {
            const r = InjectionEngine.inject(request.fieldId, request.value, { force: true });
            if (r.success) _filledFieldIds.add(request.fieldId);
            sendResponse({ status: r.success ? 'success' : 'error', reason: r.reason });
            break;
          }

          case 'LEARN_MAPPING': {
            await DomainIntelligence.learnMapping(
              request.fieldIdentifier,
              request.profileKey,
              request.domain
            );
            sendResponse({ status: 'success' });
            break;
          }

          case 'GET_PAGE_INFO': {
            sendResponse({
              domain: DomainIntelligence.getDomain(),
              url: window.location.href,
              title: document.title,
              formCount: FieldDetector.countForms(),
            });
            break;
          }

          case 'TOGGLE_FAB': {
            if (_fabElement) {
              _fabElement.style.display = request.show ? 'flex' : 'none';
            }
            sendResponse({ status: 'success' });
            break;
          }

          // Legacy support for old START_AUTOFILL action
          case 'START_AUTOFILL': {
            const result = await performAutofill(
              request.profileData || {},
              request.domainMappings || {},
              false
            );
            sendResponse({
              status: 'success',
              latency: 0,
              cost: 0,
              filled: result.filled.length,
              total: result.totalFields,
            });
            break;
          }

          default:
            sendResponse({ status: 'error', error: 'Unknown action: ' + request.action });
        }
      } catch (err) {
        console.error('[FormFiller Content Script Error]', err);
        sendResponse({ status: 'error', error: err.message });
      }
    };

    handler();
    return true; // Keep message channel open for async response
  });

  // ═══════════════════════════════════════════════════════════
  // SECTION 4: Initialize
  // ═══════════════════════════════════════════════════════════

  // Check settings and create FAB if enabled
  chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (response) => {
    if (chrome.runtime.lastError) {
      // Extension context may be invalid, silently ignore
      console.log('[FormFiller] Could not contact background script');
      return;
    }
    if (response?.settings?.showFab !== false) {
      // Wait for body to be ready
      if (document.body) {
        createFAB();
      } else {
        document.addEventListener('DOMContentLoaded', createFAB);
      }
    }
  });

  // Watch for SPA navigation changes
  FieldDetector.watchForChanges(() => {
    // DOM changed significantly — could be SPA navigation
    _filledFieldIds.clear();
    _lastScanResults = null;
    console.log('[FormFiller] DOM change detected — reset state');
  });

  console.log('[FormFiller Pro] Content script initialized');

} // end guard
