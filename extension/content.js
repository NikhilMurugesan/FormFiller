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
  let _promptPanelElement = null;
  let _lastFocusedEditable = null;
  let _isProcessing = false;
  let _debugMode = false;

  function debugLog(...args) {
    if (_debugMode) {
      console.log('[FormFiller Debug][Content]', ...args);
    }
  }

  function compactText(value, maxLen = 220) {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  }

  function pruneNulls(value) {
    if (Array.isArray(value)) {
      return value.map(pruneNulls).filter(item => item !== null && item !== undefined);
    }
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, raw] of Object.entries(value)) {
        const pruned = pruneNulls(raw);
        if (pruned === null || pruned === undefined) continue;
        if (typeof pruned === 'string' && !pruned.trim()) continue;
        if (Array.isArray(pruned) && pruned.length === 0) continue;
        if (typeof pruned === 'object' && !Array.isArray(pruned) && Object.keys(pruned).length === 0) continue;
        out[key] = pruned;
      }
      return Object.keys(out).length > 0 ? out : null;
    }
    return value;
  }

  function serializeField(field) {
    return pruneNulls({
      fieldId: field.id,
      fieldName: field.name,
      label: field.label || field.placeholder || field.name || field.id,
      placeholder: compactText(field.placeholder),
      ariaLabel: compactText(field.ariaLabel),
      fieldType: field.type,
      inputTag: field.inputTag || field.tagName,
      currentValue: field.currentValue,
      candidateOptions: field.candidateOptions || field.options || [],
      nearbyText: compactText(field.nearbyText || field.surroundingText),
      parentSectionText: compactText(field.parentSectionText, 320),
      sectionHeading: compactText(field.sectionHeading),
      autocomplete: field.autocomplete,
      required: !!field.required,
      visible: field.visible !== false,
      disabled: !!field.disabled,
      cssSelector: field.cssSelector,
      normalizedIntent: field.normalizedIntent || 'unknown',
      formId: field.formId,
      formName: field.formName,
      formAction: field.formAction,
      formMethod: field.formMethod,
      formIndex: field.formIndex,
    });
  }

  function buildPageContext(formType, totalFields) {
    return {
      domain: DomainIntelligence.getDomain(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      pageType: formType?.type || null,
      formCount: FieldDetector.countForms(),
      detectedFieldCount: totalFields,
    };
  }

  function buildPrimaryFormContext(fields, formType) {
    if (!fields || fields.length === 0) return null;
    const ranked = new Map();
    for (const field of fields) {
      const key = `${field.formId || 'no-form'}::${field.formIndex ?? 'x'}`;
      if (!ranked.has(key)) {
        ranked.set(key, { count: 0, sample: field });
      }
      ranked.get(key).count += 1;
    }
    const primary = [...ranked.values()].sort((a, b) => b.count - a.count)[0]?.sample;
    if (!primary) return null;

    return pruneNulls({
      formId: primary.formId,
      formName: primary.formName,
      formAction: primary.formAction,
      formMethod: primary.formMethod,
      formIndex: primary.formIndex,
      formType: formType?.type || null,
      sectionHeading: primary.sectionHeading || null,
      detectedFieldCount: fields.length,
    });
  }

  function serializeMapping(mapping) {
    const field = serializeField(mapping.field);
    return pruneNulls({
      fieldId: mapping.field.id,
      fieldName: mapping.field.name,
      fieldLabel: mapping.field.label || mapping.field.placeholder || mapping.field.name || mapping.field.id,
      fieldType: mapping.field.type,
      inputTag: mapping.field.inputTag || mapping.field.tagName,
      profileKey: mapping.match?.profileKey || null,
      value: mapping.value,
      confidence: mapping.match?.confidence || 0,
      matchSource: mapping.match?.matchSource || null,
      status: mapping.status,
      required: !!mapping.field.required,
      options: mapping.field.options || [],
      field,
      detectedIntent: mapping.field.normalizedIntent || 'unknown',
    });
  }

  function hasUsableValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function isEditableElement(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag !== 'input') return false;
    const type = (el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'submit', 'button', 'file', 'hidden', 'range', 'color', 'date'].includes(type);
  }

  function getPromptTargetElement() {
    if (isEditableElement(document.activeElement)) return document.activeElement;
    if (isEditableElement(_lastFocusedEditable)) return _lastFocusedEditable;
    return null;
  }

  function getEditableText(el) {
    if (!el) return '';
    return el.isContentEditable ? (el.innerText || '').trim() : String(el.value || '').trim();
  }

  function getEditableLabel(el) {
    if (!el) return '';
    return FieldDetector.findLabel(el) || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.tagName;
  }

  function replaceEditableText(el, value) {
    if (!el) return false;
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    el.focus();
    const nextValue = String(value ?? '');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, nextValue);
    else el.value = nextValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function getPagePromptSource() {
    const selection = window.getSelection ? String(window.getSelection()).trim() : '';
    const target = getPromptTargetElement();
    return {
      selectedText: selection || null,
      activeText: getEditableText(target) || null,
      editableLabel: getEditableLabel(target) || null,
      hasEditableTarget: !!target,
    };
  }

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
      <button class="ff-fab-action" data-action="optimize-prompt">
        <span class="ff-fab-icon">P</span> Optimize Prompt
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
        case 'optimize-prompt':
          await openPromptPanel();
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

  function ensurePromptPanel() {
    if (document.getElementById('ff-pro-prompt-styles')) return;
    const style = document.createElement('style');
    style.id = 'ff-pro-prompt-styles';
    style.textContent = `
      #ff-pro-prompt-panel {
        position: fixed;
        top: 24px;
        right: 24px;
        width: 420px;
        max-width: calc(100vw - 48px);
        max-height: calc(100vh - 48px);
        display: none;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: rgba(15, 12, 41, 0.96);
        border: 1px solid rgba(167, 139, 250, 0.35);
        border-radius: 18px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.38);
        z-index: 2147483647;
        color: #e2e8f0;
        font-family: 'Segoe UI', -apple-system, sans-serif;
      }
      #ff-pro-prompt-panel.visible { display: flex; }
      .ff-pro-prompt-row { display: flex; gap: 8px; }
      .ff-pro-prompt-row > * { flex: 1; }
      .ff-pro-prompt-panel h4 { margin: 0; font-size: 14px; }
      .ff-pro-prompt-panel input,
      .ff-pro-prompt-panel textarea {
        width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(15, 23, 42, 0.7);
        color: #f8fafc;
        padding: 10px 12px;
        font-size: 12px;
        font-family: inherit;
      }
      .ff-pro-prompt-panel textarea { resize: vertical; min-height: 88px; }
      .ff-pro-prompt-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .ff-pro-prompt-actions button {
        border: none;
        border-radius: 10px;
        padding: 9px 12px;
        font-size: 12px;
        cursor: pointer;
        background: rgba(255,255,255,0.06);
        color: #e2e8f0;
      }
      .ff-pro-prompt-actions .primary { background: linear-gradient(135deg, #7c3aed, #ec4899); color: #fff; }
      .ff-pro-prompt-meta { font-size: 11px; color: #94a3b8; }
      .ff-pro-prompt-output { min-height: 120px; }
      .ff-pro-prompt-scroll { overflow-y: auto; max-height: 180px; }
    `;
    document.head.appendChild(style);
  }

  function buildPromptPanel() {
    if (_promptPanelElement) return _promptPanelElement;
    ensurePromptPanel();
    _promptPanelElement = document.createElement('div');
    _promptPanelElement.id = 'ff-pro-prompt-panel';
    _promptPanelElement.className = 'ff-pro-prompt-panel';
    _promptPanelElement.innerHTML = `
      <div class="ff-pro-prompt-row">
        <h4>Prompt Optimizer</h4>
        <button type="button" id="ff-pro-prompt-close">Close</button>
      </div>
      <textarea id="ff-pro-prompt-source" placeholder="Write or capture the prompt to improve"></textarea>
      <textarea id="ff-pro-prompt-context" placeholder="Optional project context"></textarea>
      <input id="ff-pro-prompt-models" placeholder="ChatGPT, Claude, Gemini, Copilot">
      <div class="ff-pro-prompt-actions">
        <button type="button" id="ff-pro-prompt-capture">Use Selection</button>
        <button type="button" class="primary" id="ff-pro-prompt-optimize">Optimize</button>
        <button type="button" id="ff-pro-prompt-evaluate">Evaluate</button>
        <button type="button" id="ff-pro-prompt-insert">Insert</button>
        <button type="button" id="ff-pro-prompt-copy">Copy</button>
      </div>
      <div class="ff-pro-prompt-meta" id="ff-pro-prompt-meta">Ready</div>
      <textarea id="ff-pro-prompt-output" class="ff-pro-prompt-output" placeholder="Optimized prompt appears here"></textarea>
      <div class="ff-pro-prompt-meta ff-pro-prompt-scroll" id="ff-pro-prompt-feedback"></div>
    `;
    document.body.appendChild(_promptPanelElement);

    _promptPanelElement.querySelector('#ff-pro-prompt-close').addEventListener('click', closePromptPanel);
    _promptPanelElement.querySelector('#ff-pro-prompt-capture').addEventListener('click', () => {
      const source = getPagePromptSource();
      _promptPanelElement.querySelector('#ff-pro-prompt-source').value = source.selectedText || source.activeText || '';
      _promptPanelElement.querySelector('#ff-pro-prompt-meta').textContent = source.selectedText ? 'Loaded current selection' : 'Loaded active text field';
    });
    _promptPanelElement.querySelector('#ff-pro-prompt-copy').addEventListener('click', async () => {
      const text = _promptPanelElement.querySelector('#ff-pro-prompt-output').value.trim();
      if (!text) return showToast('No optimized prompt to copy', true);
      await navigator.clipboard.writeText(text);
      showToast('Prompt copied');
    });
    _promptPanelElement.querySelector('#ff-pro-prompt-insert').addEventListener('click', () => {
      const text = _promptPanelElement.querySelector('#ff-pro-prompt-output').value.trim();
      if (!text) return showToast('No optimized prompt to insert', true);
      const target = getPromptTargetElement();
      if (!target) return showToast('Focus a text box first', true);
      replaceEditableText(target, text);
      showToast('Inserted optimized prompt');
    });
    _promptPanelElement.querySelector('#ff-pro-prompt-optimize').addEventListener('click', runPromptOptimizeFromPage);
    _promptPanelElement.querySelector('#ff-pro-prompt-evaluate').addEventListener('click', runPromptEvaluateFromPage);
    return _promptPanelElement;
  }

  async function openPromptPanel() {
    const panel = buildPromptPanel();
    const source = getPagePromptSource();
    const sourceBox = panel.querySelector('#ff-pro-prompt-source');
    if (!sourceBox.value.trim()) {
      sourceBox.value = source.selectedText || source.activeText || '';
    }
    if (!panel.querySelector('#ff-pro-prompt-models').value.trim()) {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'GET_PROMPT_SETTINGS' });
        const models = response?.promptSettings?.defaultTargetModels || ['ChatGPT', 'Claude', 'Gemini', 'Copilot'];
        panel.querySelector('#ff-pro-prompt-models').value = models.join(', ');
      } catch (_) {
        panel.querySelector('#ff-pro-prompt-models').value = 'ChatGPT, Claude, Gemini, Copilot';
      }
    }
    panel.classList.add('visible');
  }

  function closePromptPanel() {
    if (_promptPanelElement) _promptPanelElement.classList.remove('visible');
  }

  async function runPromptOptimizeFromPage() {
    const panel = buildPromptPanel();
    const payload = {
      source_prompt: panel.querySelector('#ff-pro-prompt-source').value.trim(),
      project_context: panel.querySelector('#ff-pro-prompt-context').value.trim() || null,
      target_models: panel.querySelector('#ff-pro-prompt-models').value.split(',').map(item => item.trim()).filter(Boolean),
    };
    if (!payload.source_prompt) return showToast('Add prompt text first', true);

    panel.querySelector('#ff-pro-prompt-meta').textContent = 'Optimizing...';
    const response = await chrome.runtime.sendMessage({ action: 'OPTIMIZE_PROMPT', request: payload });
    if (response?.error) {
      panel.querySelector('#ff-pro-prompt-meta').textContent = response.error;
      return showToast(response.error, true);
    }
    panel.querySelector('#ff-pro-prompt-output').value = response.optimized_prompt || '';
    panel.querySelector('#ff-pro-prompt-feedback').textContent = [...(response.improvements || []), ...(response.warnings || [])].join(' • ');
    panel.querySelector('#ff-pro-prompt-meta').textContent = `Optimized in ${response.latency_sec || 0}s`;
    showToast('Prompt optimized');
  }

  async function runPromptEvaluateFromPage() {
    const panel = buildPromptPanel();
    const promptText = panel.querySelector('#ff-pro-prompt-output').value.trim() || panel.querySelector('#ff-pro-prompt-source').value.trim();
    if (!promptText) return showToast('Add prompt text first', true);

    panel.querySelector('#ff-pro-prompt-meta').textContent = 'Evaluating...';
    const response = await chrome.runtime.sendMessage({
      action: 'EVALUATE_PROMPT',
      request: {
        prompt: promptText,
        project_context: panel.querySelector('#ff-pro-prompt-context').value.trim() || null,
        target_models: panel.querySelector('#ff-pro-prompt-models').value.split(',').map(item => item.trim()).filter(Boolean),
      },
    });
    if (response?.error) {
      panel.querySelector('#ff-pro-prompt-meta').textContent = response.error;
      return showToast(response.error, true);
    }
    const scores = Object.entries(response.dimension_scores || {}).map(([key, value]) => `${key}: ${value}`).join(' • ');
    const recs = response.recommendations || [];
    panel.querySelector('#ff-pro-prompt-feedback').textContent = [scores, ...recs].filter(Boolean).join('\n');
    panel.querySelector('#ff-pro-prompt-meta').textContent = `Score ${response.overall_score || 0}`;
    if (!_promptPanelElement.querySelector('#ff-pro-prompt-output').value.trim() && response.rewritten_excerpt) {
      _promptPanelElement.querySelector('#ff-pro-prompt-output').value = response.rewritten_excerpt;
    }
    showToast('Prompt evaluated');
  }

  // ═══════════════════════════════════════════════════════════
  // SECTION 2: Core Autofill Pipeline
  // ═══════════════════════════════════════════════════════════

  /**
   * Full autofill pipeline: scan → safety filter → match → decision engine → inject
   */
  async function performAutofill(profileData, domainOverrides = {}, onlyEmpty = false) {
    // Step 1: Scan fields with retry for dynamic forms
    const fields = await FieldDetector.scanWithRetry(_filledFieldIds);

    if (fields.length === 0) {
      return { filled: [], skipped: [], blocked: [], failed: [], formType: null, decisionResults: null };
    }

    // Step 2: Classify form type
    const formType = FormTypeClassifier.classify(fields);
    console.log(`[FormFiller] Form type: ${formType.label} (${formType.confidence}%)`);

    // Step 3: Safety filter — remove sensitive fields
    const { safe, blocked } = SafetyFilter.filterFields(fields);

    // Step 4: Decision Engine — process checkboxes, dropdowns, radios
    const domain = DomainIntelligence.getDomain();
    let decisionResults = null;
    if (typeof DecisionEngine !== 'undefined') {
      const settings = {};
      try {
        const resp = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
        if (resp?.settings) Object.assign(settings, resp.settings);
      } catch (_) {}

      decisionResults = await DecisionEngine.processFields(safe, profileData, domain, settings);

      // Apply checkbox/dropdown/radio decisions
      const applied = DecisionEngine.applyAll(decisionResults);

      // Record successful fills into learned memory
      await DecisionEngine.recordSuccessfulFills(applied, domain, formType?.type);

      // Track filled IDs from decision engine
      for (const s of [...(applied.checkboxes?.selected || []), ...(applied.dropdowns?.selected || []), ...(applied.radios?.selected || [])]) {
        _filledFieldIds.add(s.field?.id || s.field?.fieldId);
      }

      // Filter out checkbox/dropdown/radio fields from normal pipeline
      var otherFields = decisionResults.otherFields || [];
    } else {
      var otherFields = safe;
    }

    // Step 5: Match remaining text/date/etc. fields to profile keys
    let mappings = MappingEngine.matchAllFields(otherFields, profileData, domainOverrides);

    // Step 6: Apply domain intelligence overrides
    mappings = DomainIntelligence.applyOverrides(mappings, domainOverrides, profileData);

    // Step 7: Inject values for text fields
    const injectionResult = InjectionEngine.injectAll(mappings, { onlyEmpty });

    // Track filled IDs
    for (const f of injectionResult.filled) {
      _filledFieldIds.add(f.id);
    }

    // Step 8: Start watching for user corrections on filled fields
    startCorrectionWatchers(domain, formType?.type);

    return {
      filled: injectionResult.filled,
      skipped: injectionResult.skipped,
      blocked: blocked.map(b => ({
        fieldId: b.field.id,
        fieldLabel: b.field.label || b.field.name || b.field.id,
        reason: b.reason,
        field: serializeField(b.field),
      })),
      failed: injectionResult.failed,
      formType,
      totalFields: fields.length,
      mappings,
      decisionResults,
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

    // Also run DecisionEngine preview for checkboxes/dropdowns
    const domain = DomainIntelligence.getDomain();
    let decisionPreview = null;
    if (typeof DecisionEngine !== 'undefined') {
      decisionPreview = await DecisionEngine.processFields(safe, profileData, domain, {});
    }

    return {
      fields,
      formType,
      safe,
      blocked,
      mappings,
      decisionPreview,
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
        if (typeof request.debug === 'boolean') {
          _debugMode = request.debug;
        }
        switch (request.action) {
          case 'SCAN_FORM': {
            const result = await performScan(
              request.profileData || {},
              request.domainMappings || {}
            );
            const pageContext = buildPageContext(result.formType, result.totalFields);
            const formContext = buildPrimaryFormContext(result.safe, result.formType);
            const response = {
              status: 'success',
              scanId: `scan_${Date.now()}`,
              pageContext,
              formContext,
              formType: result.formType,
              totalFields: result.totalFields,
              matchedCount: result.matchedCount,
              unmatchedCount: result.unmatchedCount,
              blockedCount: result.blockedCount,
              detectedFields: result.safe.map(serializeField),
              mappings: result.mappings.map(serializeMapping),
              blocked: result.blocked.map(b => ({
                fieldId: b.field.id,
                fieldLabel: b.field.label || b.field.name || b.field.id,
                reason: b.reason,
                field: serializeField(b.field),
              })),
              domain: pageContext.domain,
              url: pageContext.pageUrl,
              pageTitle: pageContext.pageTitle,
              debug: request.debug ? {
                pageContext,
                formContext,
                detectedFieldCount: result.safe.length,
              } : null,
            };
            _lastScanResults = response;
            debugLog('Scan response prepared', response);
            sendResponse(response);
            break;
          }

          case 'AUTOFILL_ALL': {
            const result = await performAutofill(
              request.profileData || {},
              request.domainMappings || {},
              false
            );
            const pageContext = buildPageContext(result.formType, result.totalFields);
            const formContext = buildPrimaryFormContext(result.mappings.map(m => m.field), result.formType);
            sendResponse({
              status: 'success',
              pageContext,
              formContext,
              filled: result.filled,
              skipped: result.skipped,
              blocked: result.blocked,
              failed: result.failed,
              formType: result.formType,
              totalFields: result.totalFields,
              detectedFields: result.mappings.map(m => serializeField(m.field)),
              mappings: result.mappings.map(serializeMapping),
            });
            break;
          }

          case 'AUTOFILL_EMPTY': {
            const result = await performAutofill(
              request.profileData || {},
              request.domainMappings || {},
              true
            );
            const pageContext = buildPageContext(result.formType, result.totalFields);
            const formContext = buildPrimaryFormContext(result.mappings.map(m => m.field), result.formType);
            sendResponse({
              status: 'success',
              pageContext,
              formContext,
              filled: result.filled,
              skipped: result.skipped,
              blocked: result.blocked,
              failed: result.failed,
              formType: result.formType,
              totalFields: result.totalFields,
              detectedFields: result.mappings.map(m => serializeField(m.field)),
              mappings: result.mappings.map(serializeMapping),
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

          case 'CLEAR_SINGLE': {
            const r = InjectionEngine.inject(request.fieldId, '', { force: true });
            if (r.success) _filledFieldIds.delete(request.fieldId);
            sendResponse({ status: r.success ? 'success' : 'error', reason: r.reason });
            break;
          }

          case 'APPLY_MAPPINGS': {
            // Apply a pre-computed array of mappings (Static + AI)
            const filledArr = [];
            const skippedArr = [];
            const failedArr = [];

            const safeFields = await FieldDetector.scanWithRetry(_filledFieldIds);
            const safeDOMFields = SafetyFilter.filterFields(safeFields).safe;

            for (const m of request.mappings) {
              const fieldLabel = m.fieldLabel || m.field?.label || m.field?.fieldLabel || m.fieldId;
              const hasValue = hasUsableValue(m.value);
              const targetDOM = safeDOMFields.find(f => f.id === m.fieldId);

              if (m.status === 'matched' && hasValue) {
                if (!targetDOM) {
                  failedArr.push({
                    id: m.fieldId,
                    fieldLabel,
                    reason: 'Element not found',
                    suggestedValue: m.value,
                  });
                  continue;
                }

                // Checkbox / Dropdown logic bypassing via DecisionEngine could be complex here.
                // For now, InjectionEngine handles basic radio/checkbox/select/text matching.
                const r = InjectionEngine.inject(m.fieldId, m.value, { force: true });
                if (r.success) {
                  _filledFieldIds.add(m.fieldId);
                  filledArr.push({ id: m.fieldId, fieldLabel, value: m.value });
                } else if (r.reason === 'Field not empty' || r.reason === 'Already filled') {
                  skippedArr.push({
                    id: m.fieldId,
                    fieldLabel,
                    reason: r.reason,
                    suggestedValue: m.value,
                    status: 'skipped',
                  });
                } else {
                  failedArr.push({
                    id: m.fieldId,
                    fieldLabel,
                    reason: r.reason,
                    suggestedValue: m.value,
                  });
                }
                continue;
              }

              let reason = m.skipReason || m.reason || 'Not selected for autofill';
              if (!hasValue && m.status === 'matched_no_value') reason = 'No stored value available';
              else if (!hasValue && m.status === 'unmatched') reason = 'No suggestion found';
              else if (m.status === 'uncertain') reason = m.reason || 'Marked for review';
              else if (m.backendStatus === 'skipped') reason = m.reason || 'Skipped by backend';

              skippedArr.push({
                id: m.fieldId,
                fieldLabel,
                reason,
                suggestedValue: hasValue ? m.value : null,
                status: m.backendStatus || m.status || 'skipped',
              });
            }

            // Start correction watchers
            const domain = DomainIntelligence.getDomain();
            startCorrectionWatchers(domain, null);

            sendResponse({
               status: 'success',
               filled: filledArr,
               skipped: skippedArr,
               blocked: [],
               failed: failedArr
            });
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

          case 'GET_ACTIVE_PROMPT_SOURCE': {
            const source = getPagePromptSource();
            sendResponse({
              status: 'success',
              ...source,
              pageTitle: document.title,
              url: window.location.href,
            });
            break;
          }

          case 'APPLY_ACTIVE_PROMPT_TEXT': {
            const target = getPromptTargetElement();
            if (!target) {
              sendResponse({ status: 'error', error: 'Focus a text box first' });
              break;
            }
            replaceEditableText(target, request.value || '');
            sendResponse({ status: 'success' });
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
  // SECTION 5: User Correction Watchers (Learning)
  // ═══════════════════════════════════════════════════════════

  let _correctionListeners = [];

  /**
   * Watch filled fields for user corrections.
   * When a user changes a field that was autofilled, record the
   * correction in LearnedMemory.
   */
  function startCorrectionWatchers(domain, pageType) {
    // Clean up previous watchers
    stopCorrectionWatchers();

    if (typeof LearnedMemory === 'undefined') return;

    const filledElements = document.querySelectorAll('[data-ff-filled="true"]');

    filledElements.forEach(el => {
      const handler = async () => {
        // Delay slightly so the value settles
        await new Promise(r => setTimeout(r, 200));

        const fieldInfo = {
          id:          el.id,
          name:        el.name || '',
          type:        el.type || el.tagName.toLowerCase(),
          label:       FieldDetector.findLabel(el) || '',
          placeholder: el.placeholder || '',
          ariaLabel:   el.getAttribute('aria-label') || '',
        };

        let newValue;
        if (el.type === 'checkbox') {
          newValue = el.checked;
        } else if (el.tagName.toLowerCase() === 'select') {
          const selOpt = el.options[el.selectedIndex];
          newValue = selOpt ? selOpt.text : el.value;
        } else {
          newValue = el.value;
        }

        console.log(`[FormFiller] User corrected: ${fieldInfo.id} = ${newValue}`);

        await LearnedMemory.record({
          domain,
          pageType,
          field: fieldInfo,
          value: newValue,
          valueSource: 'manual_correction',
          confidence: 80, // corrections get high initial confidence
        });
      };

      // Listen for change events (covers select, checkbox, radio)
      el.addEventListener('change', handler);
      // For text inputs, listen on blur (after user finishes editing)
      if (el.type !== 'checkbox' && el.type !== 'radio' && el.tagName.toLowerCase() !== 'select') {
        el.addEventListener('blur', handler);
      }

      _correctionListeners.push({ el, handler });
    });

    console.log(`[FormFiller] Watching ${filledElements.length} fields for user corrections`);
  }

  function stopCorrectionWatchers() {
    for (const { el, handler } of _correctionListeners) {
      el.removeEventListener('change', handler);
      el.removeEventListener('blur', handler);
    }
    _correctionListeners = [];
  }

  document.addEventListener('focusin', (event) => {
    if (isEditableElement(event.target)) {
      _lastFocusedEditable = event.target;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && _promptPanelElement?.classList.contains('visible')) {
      closePromptPanel();
    }
  });

  // ═══════════════════════════════════════════════════════════
  // SECTION 6: Initialize
  // ═══════════════════════════════════════════════════════════

  // Check settings and create FAB if enabled
  chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('[FormFiller] Could not contact background script');
      return;
    }
    _debugMode = response?.settings?.debugMode === true;
    if (response?.settings?.showFab !== false) {
      if (document.body) {
        createFAB();
      } else {
        document.addEventListener('DOMContentLoaded', createFAB);
      }
    }
  });

  // Watch for SPA navigation changes
  FieldDetector.watchForChanges(() => {
    _filledFieldIds.clear();
    _lastScanResults = null;
    stopCorrectionWatchers();
    console.log('[FormFiller] DOM change detected — reset state');
  });

  console.log('[FormFiller Pro] Content script initialized (v2.1 w/ learning)');

} // end guard
