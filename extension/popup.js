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

  // Set up event listeners
  setupTabNavigation();
  setupQuickActions();
  setupProfileActions();
  setupSettingsActions();
  setupDocumentUpload();
  setupProfileDropdown();
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
    const domain = new URL(tab.url).hostname;
    const domainMappings = await StorageManager.getDomainMappings(domain);

    const response = await sendToContentScript(tab.id, {
      action: 'SCAN_FORM',
      profileData: profile?.data || {},
      domainMappings,
    });

    if (response.status !== 'success') throw new Error(response.error || 'Scan failed');

    currentScanResults = response;
    renderScanResults(response);
    setStatus(`Found ${response.totalFields} fields on this page`, 'success');
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
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

function renderFieldList(mappings, blocked) {
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
    const confClass = conf >= 80 ? 'high' : conf >= 50 ? 'medium' : 'low';
    const statusClass = m.status === 'matched' ? confClass : 'blocked';
    const value = m.value ? String(m.value).substring(0, 30) : '—';
    const profileKey = m.profileKey || 'unmatched';

    return `
      <div class="field-row" data-field-id="${m.fieldId}">
        <div class="fr-status ${statusClass}"></div>
        <div class="fr-info">
          <div class="fr-name" title="${m.fieldLabel}">${truncate(m.fieldLabel, 22)}</div>
          <div class="fr-match">${m.status === 'matched' ? profileKey : m.status}</div>
        </div>
        ${m.status === 'matched' ? `<div class="fr-value" title="${value}">${truncate(value, 18)}</div>` : ''}
        ${conf > 0 ? `<span class="fr-confidence ${confClass}">${conf}%</span>` : ''}
        ${m.status === 'matched' ? `<button class="fr-edit" title="Edit mapping" data-field="${m.fieldId}" data-key="${profileKey}">✏️</button>` : ''}
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

  // Edit button handlers
  list.querySelectorAll('.fr-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fieldId = btn.dataset.field;
      const currentKey = btn.dataset.key;
      // For now, show a simple prompt — could be enhanced to a dropdown
      const newValue = prompt(`Enter new value for "${fieldId}" (currently mapped to: ${currentKey}):`);
      if (newValue !== null) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await sendToContentScript(tab.id, {
            action: 'FILL_SINGLE',
            fieldId,
            value: newValue,
          });
          showToast(`Updated ${fieldId}`, 'success');
        } catch (err) {
          showToast('Failed to update: ' + err.message, 'error');
        }
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
// SECTION 10: Document Upload (Preserved)
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
