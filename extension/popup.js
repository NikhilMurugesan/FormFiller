/**
 * Popup Controller — FormFiller Pro
 * 
 * Orchestrates the popup UI:
 *  - Tab navigation
 *  - Profile management (CRUD, switcher, editor, import/export)
 *  - Scan/Autofill/Preview/Clear actions via content script
 *  - Stats, progress, and field review rendering
 *  - Settings management
 *  - Document upload (preserved from original)
 *  - Toast notifications
 */

// ═══════════════════════════════════════════════════════════════
// SECTION 1: State & Initialization
// ═══════════════════════════════════════════════════════════════

let currentScanResults = null;
let editingProfileId = null;
let promptEvaluationState = null;
let currentEditingPromptId = null;
let currentEditingContextId = null;
const AI_REVIEW_CONFIDENCE_THRESHOLD = 88;
const AI_MATCH_CONFIDENCE_THRESHOLD = 80;
const AI_UNCERTAIN_CONFIDENCE_THRESHOLD = 55;

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

function normalizeSourceForUi(source) {
  if (!source) return 'ai';
  if (source === 'domain_mapping') return 'domain';
  if (source === 'cache' || source === 'learned') return 'learned';
  if (source === 'deterministic' || source === 'profile') return 'profile';
  return source;
}

function shouldSendFieldToBackend(mapping) {
  if (!mapping) return false;
  if (mapping.status === 'blocked' || mapping.fieldType === 'password') return false;
  if (mapping.status === 'unmatched' || mapping.status === 'matched_no_value') return true;
  return (mapping.confidence || 0) < AI_REVIEW_CONFIDENCE_THRESHOLD;
}

function hasDisplayValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function getFillOutcomeReason(mapping) {
  if (!mapping) return '';
  if (mapping.skipReason) return mapping.skipReason;
  if (mapping.failureReason) return mapping.failureReason;
  if (mapping.backendStatus === 'skipped') return mapping.reason || 'Skipped by backend';
  return '';
}

function mergeFillResponseIntoMappings(mappings, fillResponse) {
  if (!Array.isArray(mappings) || !fillResponse) return;

  const filledById = new Map((fillResponse.filled || []).map(entry => [entry.id, entry]));
  const skippedById = new Map((fillResponse.skipped || []).map(entry => [entry.id, entry]));
  const failedById = new Map((fillResponse.failed || []).map(entry => [entry.id, entry]));

  for (const mapping of mappings) {
    mapping.fillState = null;
    delete mapping.skipReason;
    delete mapping.failureReason;

    const filled = filledById.get(mapping.fieldId);
    const skipped = skippedById.get(mapping.fieldId);
    const failed = failedById.get(mapping.fieldId);

    if (filled) {
      mapping.fillState = 'filled';
      if (hasDisplayValue(filled.value)) mapping.value = filled.value;
      continue;
    }

    if (skipped) {
      mapping.fillState = 'skipped';
      mapping.skipReason = skipped.reason || '';
      if (hasDisplayValue(skipped.suggestedValue)) mapping.value = skipped.suggestedValue;
      continue;
    }

    if (failed) {
      mapping.fillState = 'failed';
      mapping.failureReason = failed.reason || '';
      if (hasDisplayValue(failed.suggestedValue)) mapping.value = failed.suggestedValue;
    }
  }
}

async function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function buildAnalyzeRequest(scanResponse, targetMappings, tab, profile, settings, learnedEntries, domainMappings, actionName) {
  const targetFieldIds = targetMappings.map(m => m.fieldId);
  const pageContext = scanResponse.pageContext || {};
  const formContext = scanResponse.formContext || {};

  const learnedForDomain = (learnedEntries || [])
    .filter(entry => entry.domain === pageContext.domain || entry.domain === '__global__')
    .slice(0, 50)
    .map(entry => pruneNulls({
      domain: entry.domain,
      page_type: entry.pageType || null,
      field_label: entry.fieldLabel || null,
      field_type: entry.fieldType || null,
      field_name: entry.fieldName || null,
      field_id: entry.fieldId || null,
      field_intent: entry.fieldIntent || null,
      value: entry.value,
      confidence: entry.confidence || 0,
      value_source: entry.valueSource || null,
      usage_count: entry.usageCount || 0,
      correction_count: entry.correctionCount || 0,
    }));

  const detectedFields = (scanResponse.detectedFields || [])
    .map(field => pruneNulls({
      field_id: field.fieldId,
      field_name: field.fieldName,
      label: field.label,
      placeholder: field.placeholder,
      aria_label: field.ariaLabel,
      field_type: field.fieldType,
      input_tag: field.inputTag,
      current_value: field.currentValue,
      candidate_options: (field.candidateOptions || []).map(opt => pruneNulls({
        value: opt.value,
        text: opt.text,
        checked: opt.checked,
        selected: opt.selected,
        disabled: opt.disabled,
      })),
      nearby_text: field.nearbyText,
      parent_section_text: field.parentSectionText,
      section_heading: field.sectionHeading,
      autocomplete: field.autocomplete,
      required: !!field.required,
      visible: field.visible !== false,
      disabled: !!field.disabled,
      css_selector: field.cssSelector,
      normalized_intent: field.normalizedIntent,
      form_id: field.formId,
      form_name: field.formName,
      form_action: field.formAction,
      form_method: field.formMethod,
      form_index: field.formIndex,
    }));

  return pruneNulls({
    contract_version: '2026-04-08',
    session_id: AIAssist.SESSION_ID,
    debug: settings?.debugMode === true,
    page: {
      domain: pageContext.domain || (tab.url ? new URL(tab.url).hostname : null),
      page_url: pageContext.pageUrl || tab.url || null,
      page_title: pageContext.pageTitle || tab.title || null,
      page_type: pageContext.pageType || scanResponse.formType?.type || null,
    },
    form: {
      form_id: formContext.formId || null,
      form_name: formContext.formName || null,
      form_action: formContext.formAction || null,
      form_method: formContext.formMethod || null,
      form_type: formContext.formType || scanResponse.formType?.type || null,
      section_heading: formContext.sectionHeading || null,
      detected_field_count: formContext.detectedFieldCount || scanResponse.totalFields || detectedFields.length,
    },
    profile: {
      profile_id: profile?.id || null,
      profile_name: profile?.name || null,
      data: profile?.data || {},
    },
    learned: {
      domain_mappings: domainMappings || {},
      entries: learnedForDomain,
    },
    user_action: {
      action: actionName,
      triggered_by: 'popup',
      only_empty: false,
    },
    target_field_ids: targetFieldIds,
    detected_fields: detectedFields,
  });
}

function applyAnalyzeResponseToMappings(scanResponse, analyzeResponse) {
  const suggestions = analyzeResponse?.suggestions || [];
  for (const suggestion of suggestions) {
    const target = scanResponse.mappings.find(m => m.fieldId === suggestion.field_id);
    if (!target) continue;

    target.detectedIntent = suggestion.detected_intent || target.detectedIntent || target.field?.normalizedIntent || 'unknown';
    target.reason = suggestion.reason || target.reason || '';
    target.matchSource = normalizeSourceForUi(suggestion.source);
    target.backendStatus = suggestion.status || 'failed';
    target.candidateAlternatives = suggestion.candidate_alternatives || [];
    target.confidence = suggestion.confidence || 0;

    if (suggestion.suggested_value !== null && suggestion.suggested_value !== undefined && suggestion.suggested_value !== '') {
      target.value = suggestion.suggested_value;
    }

    if (suggestion.status === 'matched') {
      target.status = 'matched';
    } else if (suggestion.status === 'uncertain') {
      target.status = 'uncertain';
    } else if (suggestion.status === 'failed') {
      target.status = target.status === 'matched' ? target.status : 'unmatched';
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize storage (seeds defaults on first run)
  await StorageManager.init();

  // Load all UI sections
  await loadProfileBadge();
  await loadPageInfo();
  await loadSettings();
  await loadProfilesList();
  await loadDocumentStatus();
  await loadDomainMappings();
  await loadLearnedMemory();
  await loadPromptWorkspace();

  // Set up event listeners
  setupTabNavigation();
  setupQuickActions();
  setupProfileActions();
  setupSettingsActions();
  setupDocumentUpload();
  setupProfileDropdown();
  setupLearnedMemoryActions();
  setupPromptActions();
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: Tab Navigation
// ═══════════════════════════════════════════════════════════════

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      // Update tab buttons
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update tab content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: Page Info
// ═══════════════════════════════════════════════════════════════

async function loadPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const domain = tab.url ? new URL(tab.url).hostname : 'Unknown';
    document.getElementById('pageInfoDomain').textContent = domain;
    document.getElementById('pageInfoTitle').textContent = tab.title?.substring(0, 40) || '';

    // Check if it's a supported page
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
      document.getElementById('pageInfoIcon').textContent = '⚠️';
      document.getElementById('pageInfoDomain').textContent = 'Extension pages not supported';
      document.getElementById('btnAutofillAll').disabled = true;
      return;
    }
  } catch (_) {
    document.getElementById('pageInfoDomain').textContent = 'Unable to detect page';
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: Profile Badge & Dropdown
// ═══════════════════════════════════════════════════════════════

async function loadProfileBadge() {
  const profile = await StorageManager.getActiveProfile();
  if (profile) {
    document.getElementById('badgeIcon').textContent = profile.icon || '👤';
    document.getElementById('badgeName').textContent = profile.name || 'Profile';
  }
}

function setupProfileDropdown() {
  const badge = document.getElementById('profileBadge');
  const dropdown = document.getElementById('profileDropdown');

  badge.addEventListener('click', async (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('visible');

    if (dropdown.classList.contains('visible')) {
      await renderProfileDropdown();
    }
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('visible');
  });
}

async function renderProfileDropdown() {
  const dropdown = document.getElementById('profileDropdown');
  const profiles = await StorageManager.getProfiles();
  const activeId = await StorageManager.getActiveProfileId();

  dropdown.innerHTML = profiles.map(p => `
    <div class="pd-item ${p.id === activeId ? 'active' : ''}" data-id="${p.id}">
      <span>${p.icon || '📋'}</span>
      <span style="flex:1">${p.name}</span>
      <span class="pd-check">${p.id === activeId ? '✓' : ''}</span>
    </div>
  `).join('');

  dropdown.querySelectorAll('.pd-item').forEach(item => {
    item.addEventListener('click', async () => {
      await StorageManager.setActiveProfile(item.dataset.id);
      await loadProfileBadge();
      dropdown.classList.remove('visible');
      showToast('Switched to ' + item.querySelector('span:nth-child(2)').textContent, 'info');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 5: Quick Actions (Scan / Fill / Clear / Preview)
// ═══════════════════════════════════════════════════════════════

function setupQuickActions() {
  document.getElementById('btnScan').addEventListener('click', handleScan);
  document.getElementById('btnAutofillAll').addEventListener('click', () => handleAutofill(false));
  document.getElementById('btnAIAutofill').addEventListener('click', handleAIAutofillV2);
  document.getElementById('btnFillEmpty').addEventListener('click', () => handleAutofill(true));
  document.getElementById('btnClear').addEventListener('click', handleClear);
  document.getElementById('btnPreview').addEventListener('click', handleScan); // Same as scan
}

async function handleScan() {
  setStatus('Scanning form fields...', 'loading');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');

    await ensureContentScript(tab.id);

    const profile = await StorageManager.getActiveProfile();
    const settings = await StorageManager.getSettings();
    const domain = new URL(tab.url).hostname;
    const domainMappings = await StorageManager.getDomainMappings(domain);

    const response = await sendToContentScript(tab.id, {
      action: 'SCAN_FORM',
      profileData: profile?.data || {},
      domainMappings,
      debug: settings.debugMode === true,
    });

    if (response.status !== 'success') throw new Error(response.error || 'Scan failed');

    currentScanResults = response;
    renderScanResults(response);
    setStatus(`Found ${response.totalFields} fields on this page`, 'success');
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
}

async function handleAIAutofill() {
  const btn = document.getElementById('btnAIAutofill');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="action-icon">⏳</span> AI Running...';
  
  try {
    const settings = await StorageManager.getSettings();
    if (!settings.aiAssistEnabled) {
      throw new Error('AI Assist is disabled in Settings tab.');
    }

    setStatus('Scanning and using AI for unmatched fields...', 'loading');

    // 1. Scan form
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');
    await ensureContentScript(tab.id);

    const profile = await StorageManager.getActiveProfile();
    const domain = new URL(tab.url).hostname;
    const domainMappings = await StorageManager.getDomainMappings(domain);

    const scanResponse = await sendToContentScript(tab.id, {
      action: 'SCAN_FORM',
      profileData: profile?.data || {},
      domainMappings,
    });

    if (scanResponse.status !== 'success') throw new Error(scanResponse.error || 'Scan failed');

    // 2. Run AI for unmatched fields
    const unmatchedFields = scanResponse.mappings.filter(m => m.status === 'unmatched' || m.confidence < 80);
    
    if (unmatchedFields.length > 0) {
      const fieldsPayload = unmatchedFields.map(m => ({
        id: m.fieldId,
        name: m.fieldName,
        label: m.fieldLabel,
        type: m.fieldType,
      }));

      const aiResponse = await AIAssist.analyzeFields(fieldsPayload, profile?.data || {}, settings.aiAssistUrl);
      
      if (!aiResponse.error && aiResponse.mappings) {
        for (const aiMap of aiResponse.mappings) {
          if (!aiMap.value) continue;
          const target = scanResponse.mappings.find(m => m.fieldId === aiMap.field_id);
          if (target) {
            target.value = aiMap.value;
            target.status = 'matched';
            target.confidence = aiMap.confidence || 85; 
            target.matchSource = aiMap.source || 'ai';
            target.reason = aiMap.reason || '';
          }
        }
      } else if (aiResponse.error) {
        throw new Error('AI Request failed: ' + aiResponse.error);
      }
    }

    // Update UI preview
    currentScanResults = scanResponse;
    renderScanResults(scanResponse);
    setStatus('Review AI suggestions and click Fill!', 'success');
    
    // Instead of autofilling all blindly, we instruct content.js to apply the mapped values
    const fillResponse = await sendToContentScript(tab.id, {
      action: 'APPLY_MAPPINGS',
      mappings: scanResponse.mappings, // Array containing static + AI choices
      profileData: profile?.data || {},
      domainMappings
    });

    if (fillResponse.status !== 'success') throw new Error(fillResponse.error || 'Fill failed');

    const filled = fillResponse.filled?.length || 0;
    const total = scanResponse.totalFields;

    mergeFillResponseIntoMappings(scanResponse.mappings, fillResponse);
    renderFillResults(fillResponse);
    renderFieldList(scanResponse.mappings, scanResponse.blocked);
    showProgress(filled, total);
    
    chrome.runtime.sendMessage({
      action: 'UPDATE_BADGE',
      tabId: tab.id,
      text: filled > 0 ? String(filled) : '',
      color: '#7c3aed',
    });

    setStatus(`✨ ${filled} fields filled with AI`, 'success');
    showToast(`${filled} fields filled!`, 'success');
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function handleAIAutofillV2() {
  const btn = document.getElementById('btnAIAutofill');
  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="action-icon">⏳</span> AI Running...';

  try {
    const settings = await StorageManager.getSettings();
    if (!settings.aiAssistEnabled) {
      throw new Error('AI Assist is disabled in Settings tab.');
    }

    setStatus('Scanning form and building backend request...', 'loading');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');
    await ensureContentScript(tab.id);

    const profile = await StorageManager.getActiveProfile();
    const learnedEntries = await StorageManager.getLearnedMemory();
    const domain = new URL(tab.url).hostname;
    const domainMappings = await StorageManager.getDomainMappings(domain);

    const scanResponse = await sendToContentScript(tab.id, {
      action: 'SCAN_FORM',
      profileData: profile?.data || {},
      domainMappings,
      debug: settings.debugMode === true,
    });

    if (scanResponse.status !== 'success') throw new Error(scanResponse.error || 'Scan failed');

    const aiTargets = scanResponse.mappings.filter(shouldSendFieldToBackend);
    if (aiTargets.length > 0) {
      const analyzeRequest = buildAnalyzeRequest(
        scanResponse,
        aiTargets,
        tab,
        profile,
        settings,
        learnedEntries,
        domainMappings,
        'bulk_ai_autofill'
      );

      const aiResponse = await sendToBackground({
        action: 'ANALYZE_FIELDS',
        request: analyzeRequest,
      });

      if (aiResponse?.error) {
        throw new Error('AI Request failed: ' + aiResponse.error);
      }

      applyAnalyzeResponseToMappings(scanResponse, aiResponse);
    }

    currentScanResults = scanResponse;
    renderScanResults(scanResponse);
    setStatus('Backend suggestions ready. High-confidence results will autofill; uncertain ones stay in review.', 'success');

    const fillResponse = await sendToContentScript(tab.id, {
      action: 'APPLY_MAPPINGS',
      mappings: scanResponse.mappings,
      profileData: profile?.data || {},
      domainMappings,
    });

    if (fillResponse.status !== 'success') throw new Error(fillResponse.error || 'Fill failed');

    const filled = fillResponse.filled?.length || 0;
    const total = scanResponse.totalFields;

    mergeFillResponseIntoMappings(scanResponse.mappings, fillResponse);
    renderFillResults(fillResponse);
    renderFieldList(scanResponse.mappings, scanResponse.blocked);
    showProgress(filled, total);

    chrome.runtime.sendMessage({
      action: 'UPDATE_BADGE',
      tabId: tab.id,
      text: filled > 0 ? String(filled) : '',
      color: '#7c3aed',
    });

    setStatus(`✨ ${filled} fields filled with backend suggestions`, 'success');
    showToast(`${filled} fields filled`, 'success');
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function handleAutofill(onlyEmpty) {
  const btn = document.getElementById('btnAutofillAll');
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="action-icon">⏳</span> Filling...';
  setStatus('Autofilling form...', 'loading');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');

    await ensureContentScript(tab.id);

    const profile = await StorageManager.getActiveProfile();
    const domain = new URL(tab.url).hostname;
    const domainMappings = await StorageManager.getDomainMappings(domain);

    const response = await sendToContentScript(tab.id, {
      action: onlyEmpty ? 'AUTOFILL_EMPTY' : 'AUTOFILL_ALL',
      profileData: profile?.data || {},
      domainMappings,
    });

    if (response.status !== 'success') throw new Error(response.error || 'Autofill failed');

    const filled = response.filled?.length || 0;
    const total = (response.filled?.length || 0) + (response.skipped?.length || 0) + 
                  (response.blocked?.length || 0) + (response.failed?.length || 0);

    if (response.mappings) {
      mergeFillResponseIntoMappings(response.mappings, response);
      currentScanResults = response;
      renderFieldList(response.mappings, response.blocked);
    }

    // Show stats
    renderFillResults(response);

    // Show progress
    showProgress(filled, total);

    // Update badge
    chrome.runtime.sendMessage({
      action: 'UPDATE_BADGE',
      tabId: tab.id,
      text: filled > 0 ? String(filled) : '',
      color: '#7c3aed',
    });

    const msg = filled === total
      ? `✨ All ${filled} fields filled!`
      : `✨ ${filled} of ${total} fields filled`;
    
    setStatus(msg, 'success');
    showToast(msg, 'success');
    btn.innerHTML = '<span class="action-icon">✅</span> Filled!';
    
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }, 2000);

  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function handleClear() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');

    const response = await sendToContentScript(tab.id, { action: 'CLEAR_FILLED' });

    if (response.status === 'success') {
      setStatus(`🗑️ Cleared ${response.clearedCount} fields`, 'info');
      showToast(`Cleared ${response.clearedCount} fields`, 'info');
      hideResults();
    }
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6: Render Scan / Fill Results
// ═══════════════════════════════════════════════════════════════

function renderScanResults(data) {
  // Stats bar
  const statsBar = document.getElementById('statsBar');
  statsBar.classList.remove('hidden');
  document.getElementById('statTotal').textContent = data.totalFields;
  document.getElementById('statMatched').textContent = data.matchedCount;
  document.getElementById('statSkipped').textContent = data.unmatchedCount;
  document.getElementById('statBlocked').textContent = data.blockedCount;

  // Form type badge
  if (data.formType) {
    const badge = document.getElementById('formTypeBadge');
    badge.style.display = 'inline-flex';
    document.getElementById('formTypeIcon').textContent = data.formType.icon;
    document.getElementById('formTypeLabel').textContent = data.formType.label;
  }

  // Field list
  renderFieldList(data.mappings, data.blocked);
}

function renderFillResults(data) {
  const total = (data.filled?.length || 0) + (data.skipped?.length || 0) + 
                (data.blocked?.length || 0) + (data.failed?.length || 0);
  
  const statsBar = document.getElementById('statsBar');
  statsBar.classList.remove('hidden');
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statMatched').textContent = data.filled?.length || 0;
  document.getElementById('statSkipped').textContent = data.skipped?.length || 0;
  document.getElementById('statBlocked').textContent = data.blocked?.length || 0;

  if (data.formType) {
    const badge = document.getElementById('formTypeBadge');
    badge.style.display = 'inline-flex';
    document.getElementById('formTypeIcon').textContent = data.formType.icon;
    document.getElementById('formTypeLabel').textContent = data.formType.label;
  }
}

function renderFieldListLegacy(mappings, blocked) {
  const card = document.getElementById('fieldReviewCard');
  card.classList.remove('hidden');

  const list = document.getElementById('fieldList');
  const fieldCount = document.getElementById('fieldCount');
  fieldCount.textContent = `${mappings?.length || 0} fields`;

  if (!mappings || mappings.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="es-icon">📭</div>No form fields detected</div>';
    return;
  }

  list.innerHTML = mappings.map(m => {
    const conf = m.confidence || 0;
    const confClass = conf >= AI_MATCH_CONFIDENCE_THRESHOLD ? 'high' : conf >= AI_UNCERTAIN_CONFIDENCE_THRESHOLD ? 'medium' : 'low';
    const statusClass = m.status === 'matched' ? confClass : m.status === 'uncertain' ? 'medium' : 'blocked';
    const valueStr = m.value !== undefined && m.value !== null ? String(m.value) : '';
    const displayValue = valueStr ? truncate(valueStr, 20) : '—';
    const descriptor = m.profileKey || m.detectedIntent || m.reason || 'unmatched';
    
    // Icon based on source
    let sourceIcon = '🤖';
    if (m.matchSource === 'profile') sourceIcon = '👤';
    else if (m.matchSource === 'learned') sourceIcon = '🧠';
    else if (m.matchSource === 'domain') sourceIcon = '🌐';
    else if (m.matchSource === 'ai') sourceIcon = '✨';
    else if (m.matchSource === 'decision') sourceIcon = '⚙️';

    if (m.matchSource === 'deterministic') sourceIcon = '👤';
    if (m.matchSource === 'cache') sourceIcon = '🧠';
    if (m.matchSource === 'rag') sourceIcon = '✨';

    return `
      <div class="field-row" style="flex-direction:column;align-items:stretch;gap:8px" data-field-id="${m.fieldId}">
        <div style="display:flex;align-items:center;width:100%;gap:8px;">
          <div class="fr-status ${statusClass}"></div>
          <div class="fr-info" style="flex:1">
            <div class="fr-name" title="${m.fieldLabel}">${truncate(m.fieldLabel, 28)}</div>
            <div class="fr-match" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
              <span title="Source">${sourceIcon}</span>
              ${m.status === 'matched'
                ? `<span>${escapeHtml(descriptor)}</span>`
                : m.status === 'uncertain'
                  ? `<span style="color:var(--warning)">Review: ${escapeHtml(descriptor)}</span>`
                  : `<span style="color:var(--error)">Unmatched</span>`}
            </div>
            ${m.reason ? `<div class="fr-match" style="font-size:10px;color:var(--text-muted);margin-top:2px;">${escapeHtml(truncate(m.reason, 70))}</div>` : ''}
          </div>
          ${(m.status === 'matched' || m.status === 'uncertain') ? `<div class="fr-value" style="flex:1;text-align:right;" title="${escapeHtml(valueStr)}">${escapeHtml(displayValue)}</div>` : ''}
          ${conf > 0 ? `<span class="fr-confidence ${confClass}" style="margin:0;">${conf}%</span>` : ''}
        </div>
        <div class="fr-actions" style="display:flex;gap:4px;align-self:flex-end;">
          <button class="btn btn-primary btn-sm fr-fill" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">Fill</button>
          <button class="btn btn-secondary btn-sm fr-ai" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">AI Predict</button>
          <button class="btn btn-ghost btn-sm fr-edit" data-id="${m.fieldId}" data-val="${escapeHtml(valueStr)}" style="font-size:10px;padding:2px 6px;">Edit</button>
          <button class="btn btn-ghost btn-sm fr-clear" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">Clear</button>
        </div>
      </div>
    `;
  }).join('');

  // Blocked fields
  const blockedSection = document.getElementById('blockedSection');
  const blockedList = document.getElementById('blockedList');
  if (blocked && blocked.length > 0) {
    blockedSection.classList.remove('hidden');
    blockedList.innerHTML = blocked.map(b => `
      <div class="blocked-row">
        <span class="lock-icon">🔒</span>
        <span style="flex:1">${b.fieldLabel || b.fieldId}</span>
        <span style="font-size:10px;color:var(--text-muted)">${b.reason}</span>
      </div>
    `).join('');
  } else {
    blockedSection.classList.add('hidden');
  }

  // Row button handlers
  list.querySelectorAll('.fr-fill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const target = mappings.find(m => m.fieldId === fieldId);
      if (!target || !target.value) return showToast('No value to fill', 'warning');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await sendToContentScript(tab.id, { action: 'FILL_SINGLE', fieldId, value: target.value });
        showToast('Filled', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  list.querySelectorAll('.fr-clear').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await sendToContentScript(tab.id, { action: 'CLEAR_SINGLE', fieldId });
        showToast('Cleared', 'info');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  list.querySelectorAll('.fr-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const currentVal = btn.dataset.val;
      const newVal = prompt(`Edit value for this field:`, currentVal);
      if (newVal !== null) {
        // Update local state so a future Autofill All uses it
        const target = mappings.find(m => m.fieldId === fieldId);
        if (target) { target.value = newVal; target.status = 'matched'; }
        // Render update & fill
        renderFieldList(mappings, blocked);
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await sendToContentScript(tab.id, { action: 'FILL_SINGLE', fieldId, value: newVal });
          showToast('Updated', 'success');
        } catch (err) {}
      }
    });
  });

  list.querySelectorAll('.fr-ai').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const target = mappings.find(m => m.fieldId === fieldId);
      if (!target || !currentScanResults) return;
      
      btn.textContent = '⏳';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No active tab');
        const profile = await StorageManager.getActiveProfile();
        const settings = await StorageManager.getSettings();
        const learnedEntries = await StorageManager.getLearnedMemory();
        const domain = new URL(tab.url).hostname;
        const domainMappings = await StorageManager.getDomainMappings(domain);
        const analyzeRequest = buildAnalyzeRequest(
          currentScanResults,
          [target],
          tab,
          profile,
          settings,
          learnedEntries,
          domainMappings,
          'single_field_review'
        );
        const aiResponse = await sendToBackground({
          action: 'ANALYZE_FIELDS',
          request: analyzeRequest,
        });

        if (aiResponse?.error) {
          throw new Error(aiResponse.error);
        }

        applyAnalyzeResponseToMappings(currentScanResults, aiResponse);
        renderFieldList(mappings, blocked);

        if (target.status === 'matched' && target.value !== null && target.value !== undefined && target.value !== '') {
          await sendToContentScript(tab.id, { action: 'FILL_SINGLE', fieldId, value: target.value });
          showToast('Backend suggestion filled', 'success');
        } else if (target.status === 'uncertain') {
          showToast('Suggestion marked for review', 'warning');
        } else {
          showToast('No confident suggestion found', 'warning');
          btn.textContent = 'AI Predict';
        }
        return;
      } catch (err) {
        showToast(err.message, 'error');
        btn.textContent = 'AI Predict';
      }
    });
  });
}

function renderFieldList(mappings, blocked) {
  const card = document.getElementById('fieldReviewCard');
  card.classList.remove('hidden');

  const list = document.getElementById('fieldList');
  const fieldCount = document.getElementById('fieldCount');
  fieldCount.textContent = `${mappings?.length || 0} fields`;

  if (!mappings || mappings.length === 0) {
    list.innerHTML = '<div class="empty-state">No form fields detected</div>';
    return;
  }

  list.innerHTML = mappings.map(m => {
    const conf = m.confidence || 0;
    const confClass = conf >= AI_MATCH_CONFIDENCE_THRESHOLD ? 'high' : conf >= AI_UNCERTAIN_CONFIDENCE_THRESHOLD ? 'medium' : 'low';
    const outcomeReason = getFillOutcomeReason(m);
    const statusClass = m.fillState === 'failed'
      ? 'low'
      : m.fillState === 'skipped' || m.backendStatus === 'skipped'
        ? 'medium'
        : m.status === 'matched'
          ? confClass
          : m.status === 'uncertain'
            ? 'medium'
            : 'blocked';
    const valueStr = m.value !== undefined && m.value !== null ? String(m.value) : '';
    const hasValue = hasDisplayValue(m.value);
    const displayValue = hasValue ? truncate(valueStr, 20) : '-';
    const descriptor = m.profileKey || m.detectedIntent || m.reason || 'unmatched';
    const sourceReason = m.reason && m.reason !== outcomeReason ? m.reason : '';

    let sourceIcon = '?';
    if (m.matchSource === 'profile' || m.matchSource === 'deterministic') sourceIcon = 'P';
    else if (m.matchSource === 'learned' || m.matchSource === 'cache') sourceIcon = 'L';
    else if (m.matchSource === 'domain') sourceIcon = 'D';
    else if (m.matchSource === 'ai' || m.matchSource === 'rag') sourceIcon = 'AI';
    else if (m.matchSource === 'decision') sourceIcon = 'M';

    const stateLabel = m.fillState === 'skipped' || m.backendStatus === 'skipped'
      ? `<span style="color:var(--warning)">Skipped</span>`
      : m.fillState === 'failed'
        ? `<span style="color:var(--error)">Failed</span>`
        : m.status === 'matched'
          ? `<span>${escapeHtml(descriptor)}</span>`
          : m.status === 'uncertain'
            ? `<span style="color:var(--warning)">Review: ${escapeHtml(descriptor)}</span>`
            : `<span style="color:var(--error)">Unmatched</span>`;

    const extraMeta = [
      sourceReason ? `<div class="fr-match" style="font-size:10px;color:var(--text-muted);margin-top:2px;">${escapeHtml(truncate(sourceReason, 70))}</div>` : '',
      outcomeReason ? `<div class="fr-match" style="font-size:10px;color:var(--warning);margin-top:2px;">Skip reason: ${escapeHtml(truncate(outcomeReason, 70))}</div>` : '',
      hasValue && (m.fillState === 'skipped' || m.backendStatus === 'skipped' || m.fillState === 'failed' || m.status === 'unmatched')
        ? `<div class="fr-match" style="font-size:10px;color:var(--accent-purple);margin-top:2px;">Suggestion: ${escapeHtml(truncate(valueStr, 70))}</div>`
        : '',
    ].join('');

    return `
      <div class="field-row" style="flex-direction:column;align-items:stretch;gap:8px" data-field-id="${m.fieldId}">
        <div style="display:flex;align-items:center;width:100%;gap:8px;">
          <div class="fr-status ${statusClass}"></div>
          <div class="fr-info" style="flex:1">
            <div class="fr-name" title="${m.fieldLabel}">${truncate(m.fieldLabel, 28)}</div>
            <div class="fr-match" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
              <span title="Source">${escapeHtml(sourceIcon)}</span>
              ${stateLabel}
            </div>
            ${extraMeta}
          </div>
          ${hasValue ? `<div class="fr-value" style="flex:1;text-align:right;" title="${escapeHtml(valueStr)}">${escapeHtml(displayValue)}</div>` : ''}
          ${conf > 0 ? `<span class="fr-confidence ${confClass}" style="margin:0;">${conf}%</span>` : ''}
        </div>
        <div class="fr-actions" style="display:flex;gap:4px;align-self:flex-end;">
          <button class="btn btn-primary btn-sm fr-fill" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">Fill</button>
          <button class="btn btn-secondary btn-sm fr-ai" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">AI Predict</button>
          ${hasValue ? `<button class="btn btn-ghost btn-sm fr-copy" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">Copy</button>` : ''}
          <button class="btn btn-ghost btn-sm fr-edit" data-id="${m.fieldId}" data-val="${escapeHtml(valueStr)}" style="font-size:10px;padding:2px 6px;">Edit</button>
          <button class="btn btn-ghost btn-sm fr-clear" data-id="${m.fieldId}" style="font-size:10px;padding:2px 6px;">Clear</button>
        </div>
      </div>
    `;
  }).join('');

  const blockedSection = document.getElementById('blockedSection');
  const blockedList = document.getElementById('blockedList');
  if (blocked && blocked.length > 0) {
    blockedSection.classList.remove('hidden');
    blockedList.innerHTML = blocked.map(b => `
      <div class="blocked-row">
        <span class="lock-icon">Lock</span>
        <span style="flex:1">${b.fieldLabel || b.fieldId}</span>
        <span style="font-size:10px;color:var(--text-muted)">${b.reason}</span>
      </div>
    `).join('');
  } else {
    blockedSection.classList.add('hidden');
  }

  list.querySelectorAll('.fr-fill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const target = mappings.find(m => m.fieldId === fieldId);
      if (!target || !hasDisplayValue(target.value)) return showToast('No value to fill', 'warning');
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await sendToContentScript(tab.id, { action: 'FILL_SINGLE', fieldId, value: target.value });
        showToast('Filled', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  list.querySelectorAll('.fr-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const target = mappings.find(m => m.fieldId === fieldId);
      if (!target || !hasDisplayValue(target.value)) return showToast('No suggestion to copy', 'warning');
      try {
        await navigator.clipboard.writeText(String(target.value));
        showToast('Suggestion copied', 'success');
      } catch (_) {
        showToast('Copy failed', 'error');
      }
    });
  });

  list.querySelectorAll('.fr-clear').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await sendToContentScript(tab.id, { action: 'CLEAR_SINGLE', fieldId });
        showToast('Cleared', 'info');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  list.querySelectorAll('.fr-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const currentVal = btn.dataset.val;
      const newVal = prompt(`Edit value for this field:`, currentVal);
      if (newVal !== null) {
        const target = mappings.find(m => m.fieldId === fieldId);
        if (target) {
          target.value = newVal;
          target.status = 'matched';
          target.fillState = null;
          delete target.skipReason;
          delete target.failureReason;
        }
        renderFieldList(mappings, blocked);
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await sendToContentScript(tab.id, { action: 'FILL_SINGLE', fieldId, value: newVal });
          showToast('Updated', 'success');
        } catch (_) {}
      }
    });
  });

  list.querySelectorAll('.fr-ai').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.id;
      const target = mappings.find(m => m.fieldId === fieldId);
      if (!target || !currentScanResults) return;

      btn.textContent = '...';
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No active tab');
        const profile = await StorageManager.getActiveProfile();
        const settings = await StorageManager.getSettings();
        const learnedEntries = await StorageManager.getLearnedMemory();
        const domain = new URL(tab.url).hostname;
        const domainMappings = await StorageManager.getDomainMappings(domain);
        const analyzeRequest = buildAnalyzeRequest(
          currentScanResults,
          [target],
          tab,
          profile,
          settings,
          learnedEntries,
          domainMappings,
          'single_field_review'
        );
        const aiResponse = await sendToBackground({
          action: 'ANALYZE_FIELDS',
          request: analyzeRequest,
        });

        if (aiResponse?.error) throw new Error(aiResponse.error);

        applyAnalyzeResponseToMappings(currentScanResults, aiResponse);
        renderFieldList(mappings, blocked);

        if (target.status === 'matched' && hasDisplayValue(target.value)) {
          await sendToContentScript(tab.id, { action: 'FILL_SINGLE', fieldId, value: target.value });
          showToast('Backend suggestion filled', 'success');
        } else if (target.status === 'uncertain') {
          showToast('Suggestion marked for review', 'warning');
        } else {
          showToast('No confident suggestion found', 'warning');
          btn.textContent = 'AI Predict';
        }
        return;
      } catch (err) {
        showToast(err.message, 'error');
        btn.textContent = 'AI Predict';
      }
    });
  });
}

function showProgress(filled, total) {
  const container = document.getElementById('progressContainer');
  container.classList.remove('hidden');

  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
  document.getElementById('progressFill').style.width = percent + '%';
  document.getElementById('progressText').textContent = `${filled} of ${total} fields filled`;
  document.getElementById('progressPercent').textContent = percent + '%';
}

function hideResults() {
  document.getElementById('statsBar').classList.add('hidden');
  document.getElementById('progressContainer').classList.add('hidden');
  document.getElementById('fieldReviewCard').classList.add('hidden');
  document.getElementById('formTypeBadge').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: Profile Management
// ═══════════════════════════════════════════════════════════════

async function loadProfilesList() {
  const profiles = await StorageManager.getProfiles();
  const activeId = await StorageManager.getActiveProfileId();
  const container = document.getElementById('profileCardsList');

  container.innerHTML = profiles.map(p => {
    const fieldCount = Object.values(p.data || {}).filter(v => v && v.toString().trim()).length;
    return `
      <div class="profile-card ${p.id === activeId ? 'active' : ''}" data-id="${p.id}">
        <div class="pc-icon">${p.icon || '📋'}</div>
        <div class="pc-info">
          <div class="pc-name">${p.name}</div>
          <div class="pc-meta">${fieldCount} fields • ${p.id === activeId ? '✅ Active' : 'Inactive'}</div>
        </div>
        <div class="pc-actions">
          <button class="pc-action-btn edit" data-id="${p.id}" title="Edit">✏️</button>
          <button class="pc-action-btn duplicate" data-id="${p.id}" title="Duplicate">📋</button>
          <button class="pc-action-btn delete" data-id="${p.id}" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  // Click profile card to set active
  container.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.pc-action-btn')) return; // Don't activate when clicking action buttons
      await StorageManager.setActiveProfile(card.dataset.id);
      await loadProfileBadge();
      await loadProfilesList();
      showToast('Profile activated', 'info');
    });
  });

  // Action button handlers
  container.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openProfileEditor(btn.dataset.id);
    });
  });

  container.querySelectorAll('.duplicate').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await StorageManager.duplicateProfile(btn.dataset.id);
      await loadProfilesList();
      showToast('Profile duplicated', 'success');
    });
  });

  container.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const profiles = await StorageManager.getProfiles();
      if (profiles.length <= 1) {
        showToast('Cannot delete last profile', 'warning');
        return;
      }
      if (confirm('Delete this profile?')) {
        await StorageManager.deleteProfile(btn.dataset.id);
        await loadProfileBadge();
        await loadProfilesList();
        showToast('Profile deleted', 'info');
      }
    });
  });
}

function setupProfileActions() {
  document.getElementById('btnAddProfile').addEventListener('click', async () => {
    const name = prompt('Profile name:');
    if (!name) return;
    const icons = ['👤', '💼', '📄', '🏠', '🎓', '🎯', '🚀'];
    const icon = icons[Math.floor(Math.random() * icons.length)];
    await StorageManager.createProfile(name, icon);
    await loadProfilesList();
    showToast('Profile created', 'success');
  });

  document.getElementById('btnExportProfiles').addEventListener('click', async () => {
    const profiles = await StorageManager.getProfiles();
    const json = StorageManager.exportProfiles(profiles);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'formfiller_profiles.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Profiles exported', 'success');
  });

  document.getElementById('btnImportProfiles').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
  });

  document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await StorageManager.importProfiles(text);
      await loadProfilesList();
      await loadProfileBadge();
      showToast('Profiles imported', 'success');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  });

  document.getElementById('btnCloseEditor').addEventListener('click', closeProfileEditor);
  document.getElementById('btnCancelEdit').addEventListener('click', closeProfileEditor);
  document.getElementById('btnSaveProfile').addEventListener('click', saveProfileFromEditor);
}

// ─── Profile Editor ──────────────────────────────────────────

const EDITOR_FIELDS = [
  { key: 'full_name',   label: 'Full Name' },
  { key: 'first_name',  label: 'First Name' },
  { key: 'last_name',   label: 'Last Name' },
  { key: 'email',       label: 'Email', type: 'email' },
  { key: 'phone',       label: 'Phone' },
  { key: 'address',     label: 'Address', fullWidth: true },
  { key: 'city',        label: 'City' },
  { key: 'state',       label: 'State' },
  { key: 'zip',         label: 'ZIP/Postal' },
  { key: 'country',     label: 'Country' },
  { key: 'current_company', label: 'Company' },
  { key: 'current_title',   label: 'Job Title' },
  { key: 'linkedin',    label: 'LinkedIn', fullWidth: true },
  { key: 'portfolio',   label: 'Portfolio' },
  { key: 'github',      label: 'GitHub' },
  { key: 'website',     label: 'Website' },
  { key: 'highest_degree', label: 'Degree' },
  { key: 'school',      label: 'School' },
  { key: 'major',       label: 'Major' },
  { key: 'graduation_year', label: 'Grad Year' },
  { key: 'years_of_experience', label: 'Experience (years)' },
  { key: 'gender',      label: 'Gender' },
  { key: 'dob',         label: 'Date of Birth' },
  { key: 'skills',      label: 'Skills', fullWidth: true, textarea: true },
  { key: 'summary',     label: 'Summary', fullWidth: true, textarea: true },
];

async function openProfileEditor(profileId) {
  editingProfileId = profileId;
  const profile = await StorageManager.getProfileById(profileId);
  if (!profile) return;

  document.getElementById('editorTitle').textContent = `Edit: ${profile.name}`;
  const grid = document.getElementById('editorGrid');

  grid.innerHTML = EDITOR_FIELDS.map(f => {
    const value = profile.data[f.key] || '';
    const cls = f.fullWidth ? 'editor-field full-width' : 'editor-field';

    if (f.textarea) {
      return `
        <div class="${cls}">
          <label>${f.label}</label>
          <textarea data-key="${f.key}" rows="2">${value}</textarea>
        </div>
      `;
    }

    return `
      <div class="${cls}">
        <label>${f.label}</label>
        <input type="${f.type || 'text'}" data-key="${f.key}" value="${escapeHtml(value)}">
      </div>
    `;
  }).join('');

  document.getElementById('profileEditor').classList.add('visible');
}

function closeProfileEditor() {
  document.getElementById('profileEditor').classList.remove('visible');
  editingProfileId = null;
}

async function saveProfileFromEditor() {
  if (!editingProfileId) return;

  const profile = await StorageManager.getProfileById(editingProfileId);
  if (!profile) return;

  const grid = document.getElementById('editorGrid');
  grid.querySelectorAll('input, textarea').forEach(el => {
    const key = el.dataset.key;
    if (key) {
      profile.data[key] = el.value;
    }
  });

  await StorageManager.saveProfile(profile);
  await loadProfilesList();
  await loadProfileBadge();
  closeProfileEditor();
  showToast('Profile saved', 'success');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8: Settings
// ═══════════════════════════════════════════════════════════════

async function loadSettings() {
  const settings = await StorageManager.getSettings();

  document.getElementById('settingFab').checked = settings.showFab !== false;
  document.getElementById('settingFillEmpty').checked = settings.fillOnlyEmpty === true;
  document.getElementById('settingAiAssist').checked = settings.aiAssistEnabled === true;
  document.getElementById('settingDebug').checked = settings.debugMode === true;
  document.getElementById('settingAiUrl').value = settings.aiAssistUrl || AIAssist.DEFAULT_API_URL;

  // Show/hide AI URL setting
  document.getElementById('aiUrlSetting').classList.toggle('hidden', !settings.aiAssistEnabled);
}

function setupSettingsActions() {
  const settingHandlers = {
    'settingFab':       'showFab',
    'settingFillEmpty': 'fillOnlyEmpty',
    'settingAiAssist':  'aiAssistEnabled',
    'settingDebug':     'debugMode',
  };

  for (const [elId, settingKey] of Object.entries(settingHandlers)) {
    document.getElementById(elId).addEventListener('change', async (e) => {
      await StorageManager.updateSettings({ [settingKey]: e.target.checked });

      // Toggle AI URL visibility
      if (settingKey === 'aiAssistEnabled') {
        document.getElementById('aiUrlSetting').classList.toggle('hidden', !e.target.checked);
      }
    });
  }

  // AI URL input with debounce
  let urlTimer;
  document.getElementById('settingAiUrl').addEventListener('input', (e) => {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(async () => {
      await StorageManager.updateSettings({ aiAssistUrl: e.target.value });
    }, 500);
  });

  // Clear domain mappings
  document.getElementById('btnClearDomainMaps').addEventListener('click', async () => {
    if (confirm('Clear all saved domain mappings?')) {
      await StorageManager.updateSettings({}); // placeholder
      // Actually need to clear domain mappings storage
      await chrome.storage.local.set({ ff_domain_mappings: {} });
      await loadDomainMappings();
      showToast('Domain mappings cleared', 'info');
    }
  });

  // Reset all
  document.getElementById('btnResetAll').addEventListener('click', async () => {
    if (confirm('This will delete ALL profiles, settings, and mappings. Are you sure?')) {
      await StorageManager.resetAll();
      await loadProfileBadge();
      await loadProfilesList();
      await loadSettings();
      await loadDomainMappings();
      hideResults();
      showToast('Extension reset complete', 'info');
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 9: Domain Mappings Viewer
// ═══════════════════════════════════════════════════════════════

async function loadDomainMappings() {
  const mappings = await StorageManager.getAllDomainMappings();
  const container = document.getElementById('domainMappingsList');
  const domains = Object.keys(mappings);

  if (domains.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🗺️</div>
        No domain-specific mappings saved yet.
      </div>
    `;
    return;
  }

  container.innerHTML = domains.map(domain => {
    const fields = Object.entries(mappings[domain]);
    return `
      <div class="domain-item">
        <div class="di-domain">${domain}</div>
        <div class="di-fields">${fields.map(([f, k]) => `${f} → ${k}`).join(', ')}</div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 10.5: Learned Memory Viewer
// ═══════════════════════════════════════════════════════════════

async function loadLearnedMemory() {
  try {
    const stats = await StorageManager.getLearnedMemoryStats();
    const statsEl = document.getElementById('learnedMemoryStats');
    const listEl = document.getElementById('learnedMemoryList');

    if (stats.totalEntries === 0) {
      statsEl.textContent = 'No learned entries yet';
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🧠</div>
          No learned selections yet. Use the extension to autofill forms and it will learn your preferences.
        </div>
      `;
      return;
    }

    statsEl.innerHTML = `📊 <strong>${stats.totalEntries}</strong> entries • <strong>${stats.domainCount}</strong> domains • <strong>${stats.globalCount}</strong> global`;

    // Load all entries grouped by domain
    const entries = await StorageManager.getLearnedMemory();
    const byDomain = {};
    for (const e of entries) {
      if (!byDomain[e.domain]) byDomain[e.domain] = [];
      byDomain[e.domain].push(e);
    }

    const domains = Object.keys(byDomain).filter(d => d !== '__global__').sort();
    const globals = byDomain['__global__'] || [];

    let html = '';
    for (const domain of domains) {
      const items = byDomain[domain];
      html += `
        <div class="domain-item">
          <div class="di-domain" style="display:flex;justify-content:space-between;align-items:center;">
            <span>${domain}</span>
            <button class="btn btn-ghost btn-sm clear-domain-memory" data-domain="${domain}" style="font-size:9px;padding:2px 6px;">Clear</button>
          </div>
          <div class="di-fields">${items.map(e => {
            const conf = e.confidence || 0;
            const confColor = conf >= 70 ? 'var(--success)' : conf >= 50 ? 'var(--warning)' : 'var(--error)';
            return `<span style="color:var(--text-muted)">${e.fieldIntent || e.fieldLabel}</span> → <span style="color:var(--accent-purple)">${truncate(String(e.value), 20)}</span> <span style="color:${confColor};font-size:9px">${conf}%</span>`;
          }).join(' • ')}</div>
        </div>
      `;
    }

    if (globals.length > 0) {
      html += `
        <div class="domain-item">
          <div class="di-domain">🌍 Global Preferences</div>
          <div class="di-fields">${globals.map(e => {
            return `${e.fieldIntent} → ${truncate(String(e.value), 20)} (${e.confidence}%)`;
          }).join(' • ')}</div>
        </div>
      `;
    }

    listEl.innerHTML = html;

    // Per-domain clear buttons
    listEl.querySelectorAll('.clear-domain-memory').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const domain = btn.dataset.domain;
        if (confirm(`Clear all learned memory for ${domain}?`)) {
          await StorageManager.clearLearnedDomain(domain);
          await loadLearnedMemory();
          showToast(`Cleared memory for ${domain}`, 'info');
        }
      });
    });
  } catch (err) {
    console.error('[Popup] Failed to load learned memory:', err);
  }
}

function setupLearnedMemoryActions() {
  // Clear all learned memory
  document.getElementById('btnClearLearnedMemory').addEventListener('click', async () => {
    if (confirm('Clear ALL learned memory? This removes checkbox/dropdown preferences for all sites.')) {
      await StorageManager.clearLearnedMemory();
      await loadLearnedMemory();
      showToast('All learned memory cleared', 'info');
    }
  });

  // Export learned memory
  document.getElementById('btnExportMemory').addEventListener('click', async () => {
    const json = await StorageManager.exportLearnedMemory();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'formfiller_learned_memory.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Learned memory exported', 'success');
  });

  // Import learned memory
  document.getElementById('btnImportMemory').addEventListener('click', () => {
    document.getElementById('importMemoryInput').click();
  });

  document.getElementById('importMemoryInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await StorageManager.importLearnedMemory(text);
      await loadLearnedMemory();
      showToast('Learned memory imported', 'success');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 10: Prompt Assistant

function parseCommaSeparated(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getPromptFormData() {
  return {
    title: document.getElementById('promptTitleInput').value.trim(),
    sourcePrompt: document.getElementById('promptSourceInput').value.trim(),
    projectContext: document.getElementById('promptContextInput').value.trim(),
    tone: document.getElementById('promptToneInput').value.trim(),
    outputFormat: document.getElementById('promptFormatInput').value.trim(),
    targetModels: parseCommaSeparated(document.getElementById('promptModelsInput').value),
    tags: parseCommaSeparated(document.getElementById('promptTagsInput').value),
  };
}

async function loadPromptWorkspace() {
  const promptSettings = await StorageManager.getPromptSettings();
  const modelsInput = document.getElementById('promptModelsInput');
  if (modelsInput && !modelsInput.value) {
    modelsInput.value = (promptSettings.defaultTargetModels || []).join(', ');
  }
  await Promise.all([
    renderPromptLibrary(),
    renderPromptContexts(),
    updatePromptBackendBadge(),
  ]);
}

async function updatePromptBackendBadge() {
  const badge = document.getElementById('promptBackendBadge');
  const settings = await StorageManager.getSettings();
  const available = await AIAssist.isAvailable(settings.aiAssistUrl);
  badge.textContent = available ? 'Backend Ready' : 'Backend Offline';
  badge.style.color = available ? 'var(--success)' : 'var(--warning)';
}

function setupPromptActions() {
  document.getElementById('btnUsePagePrompt').addEventListener('click', handleUsePagePrompt);
  document.getElementById('btnOptimizePrompt').addEventListener('click', handleOptimizePrompt);
  document.getElementById('btnEvaluatePrompt').addEventListener('click', handleEvaluatePrompt);
  document.getElementById('btnCopyOptimizedPrompt').addEventListener('click', handleCopyOptimizedPrompt);
  document.getElementById('btnApplyPromptToPage').addEventListener('click', handleApplyPromptToPage);
  document.getElementById('btnSavePrompt').addEventListener('click', handleSavePrompt);
  document.getElementById('btnSaveContext').addEventListener('click', handleSaveContext);
  document.getElementById('btnClearContextEditor').addEventListener('click', clearContextEditor);
  document.getElementById('contextSelect').addEventListener('change', handleContextSelect);
  document.getElementById('btnExportPromptLibrary').addEventListener('click', handleExportPromptLibrary);
  document.getElementById('btnImportPromptLibrary').addEventListener('click', () => {
    document.getElementById('importPromptLibraryInput').click();
  });
  document.getElementById('btnExportContexts').addEventListener('click', handleExportContexts);
  document.getElementById('btnImportContexts').addEventListener('click', () => {
    document.getElementById('importContextsInput').click();
  });
  document.getElementById('promptSearchInput').addEventListener('input', renderPromptLibrary);
  document.getElementById('importPromptLibraryInput').addEventListener('change', handleImportPromptLibrary);
  document.getElementById('importContextsInput').addEventListener('change', handleImportContexts);
}

async function handleUsePagePrompt() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    await ensureContentScript(tab.id);
    const response = await sendToContentScript(tab.id, { action: 'GET_ACTIVE_PROMPT_SOURCE' });
    if (response?.status !== 'success') throw new Error(response?.error || 'Could not read page text');

    if (response.selectedText) {
      document.getElementById('promptSourceInput').value = response.selectedText;
    } else if (response.activeText) {
      document.getElementById('promptSourceInput').value = response.activeText;
    } else {
      throw new Error('Select text or focus a text box first');
    }

    const contextNotes = [];
    if (response.pageTitle) contextNotes.push(`Page: ${response.pageTitle}`);
    if (response.url) contextNotes.push(`URL: ${response.url}`);
    if (response.editableLabel) contextNotes.push(`Field: ${response.editableLabel}`);
    if (contextNotes.length) {
      const existing = document.getElementById('promptContextInput').value.trim();
      document.getElementById('promptContextInput').value = [existing, ...contextNotes].filter(Boolean).join('\n');
    }
    showToast('Loaded text from page', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleOptimizePrompt() {
  const form = getPromptFormData();
  if (!form.sourcePrompt) {
    showToast('Add a source prompt first', 'warning');
    return;
  }

  const settings = await StorageManager.getSettings();
  const promptSettings = await StorageManager.getPromptSettings();
  setStatus('Optimizing prompt...', 'loading');
  const payload = {
    source_prompt: form.sourcePrompt,
    project_context: form.projectContext || null,
    goal: form.title || null,
    tone: form.tone || null,
    output_format: form.outputFormat || null,
    target_models: form.targetModels,
    preserve_intent: promptSettings.preserveIntent !== false,
  };

  const selectedContextId = document.getElementById('contextSelect').value;
  if (selectedContextId) {
    const context = await StorageManager.getPromptContextById(selectedContextId);
    if (context?.content) {
      payload.extra_context = [{
        context_id: context.id,
        title: context.title,
        content: context.content,
        tags: context.tags || [],
      }];
    }
  }

  const response = await AIAssist.optimizePrompt(payload, settings.aiAssistUrl);
  if (response.error) {
    setStatus('Error: ' + response.error, 'error');
    showToast(response.error, 'error');
    return;
  }

  if (!document.getElementById('promptTitleInput').value.trim() && response.title) {
    document.getElementById('promptTitleInput').value = response.title;
  }
  document.getElementById('optimizedPromptOutput').value = response.optimized_prompt || '';
  renderPromptInsights({ improvements: response.improvements || [], warnings: response.warnings || [] });
  document.getElementById('promptEvaluationPanel').innerHTML =
    `<div class="prompt-eval-panel"><div class="prompt-item-body">${escapeHtml(response.summary || 'Optimized prompt ready.')}</div></div>`;
  document.getElementById('promptResultMetrics').textContent =
    `${response.latency_sec || 0}s • $${Number(response.cost_usd || 0).toFixed(6)}`;
  promptEvaluationState = null;
  setStatus('Optimized prompt ready', 'success');
}

async function handleEvaluatePrompt() {
  const form = getPromptFormData();
  const promptText = document.getElementById('optimizedPromptOutput').value.trim() || form.sourcePrompt;
  if (!promptText) {
    showToast('Add a prompt to evaluate first', 'warning');
    return;
  }

  const settings = await StorageManager.getSettings();
  setStatus('Evaluating prompt...', 'loading');
  const payload = {
    prompt: promptText,
    project_context: form.projectContext || null,
    intended_outcome: form.title || null,
    target_models: form.targetModels,
  };

  const selectedContextId = document.getElementById('contextSelect').value;
  if (selectedContextId) {
    const context = await StorageManager.getPromptContextById(selectedContextId);
    if (context?.content) {
      payload.extra_context = [{
        context_id: context.id,
        title: context.title,
        content: context.content,
        tags: context.tags || [],
      }];
    }
  }

  const response = await AIAssist.evaluatePrompt(payload, settings.aiAssistUrl);
  if (response.error) {
    setStatus('Error: ' + response.error, 'error');
    showToast(response.error, 'error');
    return;
  }

  promptEvaluationState = response;
  renderPromptEvaluation(response);
  setStatus('Prompt evaluation ready', 'success');
}

function renderPromptEvaluation(response) {
  const scores = response.dimension_scores || {};
  const rows = Object.entries(scores).map(([key, value]) => `
    <div class="score-row">
      <span>${escapeHtml(key.replace(/_/g, ' '))}</span>
      <div class="score-bar"><div class="score-bar-fill" style="width:${Math.max(0, Math.min(100, value))}%"></div></div>
      <span>${Math.max(0, Math.min(100, value))}</span>
    </div>
  `).join('');

  document.getElementById('promptEvaluationPanel').innerHTML = `
    <div class="prompt-eval-panel">
      <div class="prompt-score">
        <span>Overall score</span>
        <span class="prompt-score-value">${response.overall_score || 0}</span>
      </div>
      <div class="score-grid">${rows}</div>
    </div>
  `;
  renderPromptInsights({
    strengths: response.strengths || [],
    weaknesses: response.weaknesses || [],
    recommendations: response.recommendations || [],
  });
  document.getElementById('promptResultMetrics').textContent =
    `${response.latency_sec || 0}s • $${Number(response.cost_usd || 0).toFixed(6)}`;
  if (response.rewritten_excerpt && !document.getElementById('optimizedPromptOutput').value.trim()) {
    document.getElementById('optimizedPromptOutput').value = response.rewritten_excerpt;
  }
}

function renderPromptInsights({ improvements = [], warnings = [], strengths = [], weaknesses = [], recommendations = [] }) {
  const sections = [
    { title: 'Improvements', items: improvements },
    { title: 'Warnings', items: warnings },
    { title: 'Strengths', items: strengths },
    { title: 'Weaknesses', items: weaknesses },
    { title: 'Recommendations', items: recommendations },
  ].filter(section => Array.isArray(section.items) && section.items.length > 0);

  const container = document.getElementById('promptInsights');
  if (sections.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = sections.map(section => `
    <div class="insight-block">
      <div class="insight-title">${escapeHtml(section.title)}</div>
      <div class="insight-list">
        ${section.items.map(item => `<div>${escapeHtml(String(item))}</div>`).join('')}
      </div>
    </div>
  `).join('');
}

async function handleCopyOptimizedPrompt() {
  const text = document.getElementById('optimizedPromptOutput').value.trim();
  if (!text) return showToast('No optimized prompt to copy', 'warning');
  await navigator.clipboard.writeText(text);
  showToast('Prompt copied', 'success');
}

async function handleApplyPromptToPage() {
  const text = document.getElementById('optimizedPromptOutput').value.trim();
  if (!text) return showToast('No optimized prompt to insert', 'warning');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    await ensureContentScript(tab.id);
    const response = await sendToContentScript(tab.id, { action: 'APPLY_ACTIVE_PROMPT_TEXT', value: text });
    if (response?.status !== 'success') throw new Error(response?.error || 'Could not insert text');
    showToast('Inserted into page', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSavePrompt() {
  const form = getPromptFormData();
  const optimizedPrompt = document.getElementById('optimizedPromptOutput').value.trim();
  if (!form.sourcePrompt && !optimizedPrompt) return showToast('Nothing to save', 'warning');

  const saved = await StorageManager.savePrompt({
    id: currentEditingPromptId,
    title: form.title || 'Untitled Prompt',
    description: promptEvaluationState?.recommendations?.[0] || '',
    promptText: form.sourcePrompt,
    optimizedPrompt,
    projectContext: form.projectContext,
    tags: form.tags,
    targetModels: form.targetModels,
    source: optimizedPrompt ? 'optimized' : 'manual',
  });
  currentEditingPromptId = saved.id;
  await renderPromptLibrary();
  showToast('Prompt saved', 'success');
}

async function renderPromptLibrary() {
  const query = document.getElementById('promptSearchInput')?.value || '';
  const prompts = await StorageManager.searchPromptLibrary(query);
  const container = document.getElementById('promptLibraryList');
  const meta = document.getElementById('promptLibraryMeta');
  meta.textContent = `${prompts.length} prompt${prompts.length === 1 ? '' : 's'}`;

  if (prompts.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">L</div>No saved prompts yet.</div>`;
    return;
  }

  container.innerHTML = prompts.map(prompt => `
    <div class="prompt-item">
      <div class="prompt-item-header">
        <div>
          <div class="prompt-item-title">${escapeHtml(prompt.title || 'Untitled Prompt')}</div>
          <div class="prompt-item-meta">${escapeHtml((prompt.targetModels || []).join(', ') || 'General')}</div>
        </div>
        <button class="pc-action-btn" data-action="delete" data-id="${prompt.id}">X</button>
      </div>
      <div class="chip-row">
        ${(prompt.tags || []).map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')}
      </div>
      <div class="prompt-item-body">${escapeHtml(truncate(prompt.optimizedPrompt || prompt.promptText || '', 220))}</div>
      <div class="prompt-item-actions">
        <button class="btn btn-ghost btn-sm" data-action="load" data-id="${prompt.id}">Load</button>
        <button class="btn btn-ghost btn-sm" data-action="copy" data-id="${prompt.id}">Copy</button>
        <button class="btn btn-ghost btn-sm" data-action="share" data-id="${prompt.id}">Share</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-action="load"]').forEach(btn => btn.addEventListener('click', () => loadPromptIntoEditor(btn.dataset.id)));
  container.querySelectorAll('[data-action="copy"]').forEach(btn => btn.addEventListener('click', async () => {
    const prompt = await StorageManager.getPromptById(btn.dataset.id);
    const text = prompt?.optimizedPrompt || prompt?.promptText || '';
    if (!text) return showToast('Prompt is empty', 'warning');
    await navigator.clipboard.writeText(text);
    showToast('Prompt copied', 'success');
  }));
  container.querySelectorAll('[data-action="share"]').forEach(btn => btn.addEventListener('click', async () => {
    const prompt = await StorageManager.getPromptById(btn.dataset.id);
    if (!prompt) return;
    await navigator.clipboard.writeText(JSON.stringify(prompt, null, 2));
    showToast('Prompt JSON copied for sharing', 'success');
  }));
  container.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => {
    await StorageManager.deletePrompt(btn.dataset.id);
    if (currentEditingPromptId === btn.dataset.id) currentEditingPromptId = null;
    await renderPromptLibrary();
    showToast('Prompt deleted', 'info');
  }));
}

async function loadPromptIntoEditor(id) {
  const prompt = await StorageManager.getPromptById(id);
  if (!prompt) return;
  currentEditingPromptId = prompt.id;
  document.getElementById('promptTitleInput').value = prompt.title || '';
  document.getElementById('promptSourceInput').value = prompt.promptText || '';
  document.getElementById('promptContextInput').value = prompt.projectContext || '';
  document.getElementById('optimizedPromptOutput').value = prompt.optimizedPrompt || '';
  document.getElementById('promptTagsInput').value = (prompt.tags || []).join(', ');
  document.getElementById('promptModelsInput').value = (prompt.targetModels || []).join(', ');
  showToast('Prompt loaded', 'success');
}

async function handleExportPromptLibrary() {
  const json = await StorageManager.exportPromptLibrary();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formfiller_prompt_library.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImportPromptLibrary(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await StorageManager.importPromptLibrary(await file.text());
    await renderPromptLibrary();
    showToast('Prompt library imported', 'success');
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function handleSaveContext() {
  const title = document.getElementById('contextTitleInput').value.trim();
  const content = document.getElementById('contextContentInput').value.trim();
  const tags = parseCommaSeparated(document.getElementById('contextTagsInput').value);
  if (!title || !content) return showToast('Context title and content are required', 'warning');

  const saved = await StorageManager.savePromptContext({ id: currentEditingContextId, title, content, tags });
  currentEditingContextId = saved.id;
  await renderPromptContexts();
  document.getElementById('contextSelect').value = saved.id;
  showToast('Context saved', 'success');
}

async function renderPromptContexts() {
  const contexts = await StorageManager.getPromptContexts();
  const select = document.getElementById('contextSelect');
  const list = document.getElementById('promptContextList');

  select.innerHTML = '<option value="">No saved context selected</option>' + contexts.map(context =>
    `<option value="${context.id}">${escapeHtml(context.title)}</option>`
  ).join('');

  if (contexts.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon">C</div>No saved contexts yet.</div>`;
    return;
  }

  list.innerHTML = contexts.map(context => `
    <div class="prompt-item">
      <div class="prompt-item-header">
        <div>
          <div class="prompt-item-title">${escapeHtml(context.title)}</div>
          <div class="prompt-item-meta">${escapeHtml((context.tags || []).join(', '))}</div>
        </div>
        <button class="pc-action-btn" data-action="delete-context" data-id="${context.id}">X</button>
      </div>
      <div class="prompt-item-body">${escapeHtml(truncate(context.content, 180))}</div>
      <div class="prompt-item-actions">
        <button class="btn btn-ghost btn-sm" data-action="load-context" data-id="${context.id}">Load</button>
        <button class="btn btn-ghost btn-sm" data-action="apply-context" data-id="${context.id}">Use</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="load-context"]').forEach(btn => btn.addEventListener('click', async () => {
    const context = await StorageManager.getPromptContextById(btn.dataset.id);
    if (!context) return;
    currentEditingContextId = context.id;
    document.getElementById('contextTitleInput').value = context.title || '';
    document.getElementById('contextContentInput').value = context.content || '';
    document.getElementById('contextTagsInput').value = (context.tags || []).join(', ');
    document.getElementById('contextSelect').value = context.id;
    showToast('Context loaded', 'success');
  }));
  list.querySelectorAll('[data-action="apply-context"]').forEach(btn => btn.addEventListener('click', async () => {
    const context = await StorageManager.getPromptContextById(btn.dataset.id);
    if (!context) return;
    document.getElementById('contextSelect').value = context.id;
    document.getElementById('promptContextInput').value = context.content || '';
    showToast('Context applied to prompt editor', 'success');
  }));
  list.querySelectorAll('[data-action="delete-context"]').forEach(btn => btn.addEventListener('click', async () => {
    await StorageManager.deletePromptContext(btn.dataset.id);
    if (currentEditingContextId === btn.dataset.id) clearContextEditor();
    await renderPromptContexts();
    showToast('Context deleted', 'info');
  }));
}

async function handleContextSelect(e) {
  const id = e.target.value;
  if (!id) return;
  const context = await StorageManager.getPromptContextById(id);
  if (!context) return;
  document.getElementById('promptContextInput').value = context.content || '';
}

function clearContextEditor() {
  currentEditingContextId = null;
  document.getElementById('contextTitleInput').value = '';
  document.getElementById('contextTagsInput').value = '';
  document.getElementById('contextContentInput').value = '';
  document.getElementById('contextSelect').value = '';
}

async function handleExportContexts() {
  const json = await StorageManager.exportPromptContexts();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formfiller_prompt_contexts.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImportContexts(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await StorageManager.importPromptContexts(await file.text());
    await renderPromptContexts();
    showToast('Contexts imported', 'success');
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

// SECTION 11: Document Upload (Preserved)
// ═══════════════════════════════════════════════════════════════

async function loadDocumentStatus() {
  const meta = await StorageManager.getDocMeta();
  if (!meta) return;

  showDocBadge(meta.filename, 'checking...');

  const settings = await StorageManager.getSettings();
  const status = await AIAssist.getDocumentStatus(settings.aiAssistUrl);

  if (status.cached) {
    showDocBadge(meta.filename, status.chunk_count);
    setUploadStatus('✅ Document ready', 'info');
  } else if (status.error) {
    showDocBadge(meta.filename, '?');
    setUploadStatus('⚠️ Backend offline — start server to use document', 'error');
  } else {
    setUploadStatus('⚠️ Server restarted — please re-upload', 'warning');
    await StorageManager.clearDocMeta();
    document.getElementById('docBadge').classList.remove('visible');
  }
}

function setupDocumentUpload() {
  document.getElementById('docFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadStatus('⏳ Uploading and embedding chunks...', 'loading');

    try {
      const settings = await StorageManager.getSettings();
      const data = await AIAssist.uploadDocument(file, settings.aiAssistUrl);

      await StorageManager.setDocMeta({ filename: data.filename, session_id: AIAssist.SESSION_ID });
      showDocBadge(data.filename, data.chunk_count);
      setUploadStatus(`✅ ${data.chunk_count} chunks embedded & cached`, 'info');
    } catch (err) {
      setUploadStatus(`❌ ${err.message}`, 'error');
    }
  });
}

function showDocBadge(filename, chunkCount) {
  document.getElementById('docName').textContent = filename;
  document.getElementById('docChunks').textContent = `${chunkCount} chunks`;
  document.getElementById('docBadge').classList.add('visible');
}

function setUploadStatus(msg, cls) {
  const el = document.getElementById('uploadStatus');
  el.textContent = msg;
  el.style.color = cls === 'error' ? 'var(--error)' :
                    cls === 'loading' ? 'var(--info)' :
                    cls === 'warning' ? 'var(--warning)' :
                    'var(--success)';
}

// ═══════════════════════════════════════════════════════════════
// SECTION 11: Helpers
// ═══════════════════════════════════════════════════════════════

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
        'modules/learned-memory.js',
        'modules/checkbox-engine.js',
        'modules/dropdown-engine.js',
        'modules/decision-engine.js',
        'content.js',
      ],
    });
  } catch (_) {}
  // Small delay for scripts to initialize
  await new Promise(r => setTimeout(r, 100));
}

function sendToContentScript(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function setStatus(msg, cls) {
  const el = document.getElementById('statusBar');
  el.textContent = msg;
  el.className = cls || '';
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
