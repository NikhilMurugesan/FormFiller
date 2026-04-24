/**
 * StorageManager — Centralized storage layer for FormFiller Pro
 * 
 * Responsibilities:
 *  - Multi-profile CRUD (Personal, Work, Job Application, Custom)
 *  - Active profile tracking
 *  - Domain-specific field mappings
 *  - Extension settings
 *  - Import/Export profiles as JSON
 *  - Auto-migration from legacy ff_user_data format
 */

var StorageManager = (() => {
  // ─── Storage Keys ────────────────────────────────────────────
  const KEYS = {
    PROFILES:       'ff_profiles',
    ACTIVE_PROFILE: 'ff_active_profile_id',
    DOMAIN_MAPS:    'ff_domain_mappings',
    SETTINGS:       'ff_settings',
    PROMPT_LIBRARY: 'ff_prompt_library',
    PROMPT_CONTEXTS: 'ff_prompt_contexts',
    PROMPT_SETTINGS: 'ff_prompt_settings',
    LEGACY_DATA:    'ff_user_data',       // old format — migrate on first run
    DOC_META:       'ff_doc_meta',
    LEARNED_MEMORY: 'ff_learned_memory',  // checkbox/dropdown/correction memory
  };

  const BACKEND_PROFILE_ID = 'backend_user_data';

  // ─── Default Profile Template ────────────────────────────────
  const DEFAULT_PROFILE_DATA = {
    full_name: '', first_name: '', last_name: '',
    email: '', phone: '',
    country_code: '', phone_number_digits: '',
    address: '', city: '', state: '', zip: '', country: '',
    location: '', current_company: '', current_title: '', desired_title: '',
    linkedin: '', portfolio: '', github: '', website: '',
    highest_degree: '', school: '', major: '', graduation_year: '',
    years_of_experience: '', skills: '', summary: '',
    headline: '', cover_letter: '', message_to_recruiter: '',
    employment_type_preference: '', preferred_employment_type: '',
    work_authorization: '', sponsorship_required: '', willing_to_relocate: '',
    remote_preference: '', preferred_locations: '',
    veteran_status: '', armed_forces_service: '', disability_status: '',
    languages_known: '', phone_type: '', hear_about: '',
    shift_preference: '', travel_willingness: '', salary_expectation: '',
    notice_period: '', start_date: '',
    gender: '', dob: '', date_of_birth: '',
  };

  // ─── Default Settings ────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    debugMode:        false,
    aiAssistEnabled:  false,            // opt-in only
    aiAssistUrl:      'https://form-filler-pi.vercel.app',
    fillOnlyEmpty:    false,
    showFab:          true,
    keyboardShortcut: 'Alt+Shift+F',
  };

  const DEFAULT_PROMPT_SETTINGS = {
    enabled: true,
    defaultTargetModels: ['ChatGPT', 'Claude', 'Gemini', 'Copilot'],
    preserveIntent: true,
    autoSaveHistory: true,
    maxHistoryItems: 50,
  };

  // ─── Pre-loaded Default Profile ───────────────────────────────
  const PRELOADED_PERSONAL = {
    id:   'personal_default',
    name: 'Personal',
    icon: '👤',
    data: { ...DEFAULT_PROFILE_DATA },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const PRELOADED_WORK = {
    id:   'work_default',
    name: 'Work',
    icon: '💼',
    data: { ...DEFAULT_PROFILE_DATA },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const PRELOADED_JOB = {
    id:   'job_application_default',
    name: 'Job Application',
    icon: '📄',
    data: { ...DEFAULT_PROFILE_DATA },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // ─── Internal Helpers ────────────────────────────────────────
  function _get(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, r => resolve(r[key] ?? null));
    });
  }

  function _set(data) {
    return new Promise(resolve => {
      chrome.storage.local.set(data, resolve);
    });
  }

  function _remove(key) {
    return new Promise(resolve => {
      chrome.storage.local.remove(key, resolve);
    });
  }

  function _generateEntityId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function _generateId() {
    return _generateEntityId('profile');
  }

  function _sanitizeProfileData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};

    const out = {};
    for (const [key, value] of Object.entries(data)) {
      if (!key || value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        out[key] = value.map(item => String(item ?? '').trim()).filter(Boolean).join(', ');
      } else if (typeof value === 'object') {
        out[key] = JSON.stringify(value);
      } else {
        out[key] = String(value).trim();
      }
    }
    return out;
  }

  function _normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    const output = [];
    for (const raw of tags) {
      const tag = String(raw || '').trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(tag);
    }
    return output;
  }

  // ─── Migration: old ff_user_data → new profile format ────────
  async function _migrateLegacy() {
    const legacy = await _get(KEYS.LEGACY_DATA);
    if (!legacy) return;

    // Flatten the nested legacy object into our flat profile data shape
    const flat = { ...DEFAULT_PROFILE_DATA };
    const af = legacy.autofill_fields || legacy;

    const fieldMap = {
      full_name: af.full_name || af.name || '',
      first_name: af.first_name || '',
      last_name: af.last_name || '',
      email: af.email || '',
      phone: af.phone || '',
      city: af.city || (legacy.personal_info?.location?.city) || '',
      state: af.state || (legacy.personal_info?.location?.state) || '',
      country: af.country || (legacy.personal_info?.location?.country) || '',
      current_company: af.current_company || '',
      current_title: af.current_title || '',
      linkedin: af.linkedin || '',
      portfolio: af.portfolio || '',
      website: af.website || '',
      github: af.github || (legacy.personal_info?.github_url) || '',
      highest_degree: af.highest_degree || '',
      school: af.school || '',
      major: af.major || '',
      years_of_experience: af.years_of_experience || '',
      skills: af.skills || '',
      summary: af.summary || '',
    };

    Object.assign(flat, fieldMap);

    // Merge into the default personal profile
    PRELOADED_PERSONAL.data = { ...PRELOADED_PERSONAL.data, ...flat };

    console.log('[StorageManager] Migrated legacy ff_user_data into Personal profile');
  }

  // ─── Public API ──────────────────────────────────────────────

  /** Initialize storage — call once on extension load */
  async function init() {
    await _migrateLegacy();

    const existing = await _get(KEYS.PROFILES);
    if (!existing || existing.length === 0) {
      // First run — seed default profiles
      await _set({
        [KEYS.PROFILES]: [PRELOADED_PERSONAL, PRELOADED_WORK, PRELOADED_JOB],
        [KEYS.ACTIVE_PROFILE]: PRELOADED_PERSONAL.id,
      });
      console.log('[StorageManager] Seeded default profiles');
    }

    // Ensure settings exist
    const settings = await _get(KEYS.SETTINGS);
    if (!settings) {
      await _set({ [KEYS.SETTINGS]: DEFAULT_SETTINGS });
    }

    // Ensure domain mappings exist
    const maps = await _get(KEYS.DOMAIN_MAPS);
    if (!maps) {
      await _set({ [KEYS.DOMAIN_MAPS]: {} });
    }

    const promptLibrary = await _get(KEYS.PROMPT_LIBRARY);
    if (!Array.isArray(promptLibrary)) {
      await _set({ [KEYS.PROMPT_LIBRARY]: [] });
    }

    const promptContexts = await _get(KEYS.PROMPT_CONTEXTS);
    if (!Array.isArray(promptContexts)) {
      await _set({ [KEYS.PROMPT_CONTEXTS]: [] });
    }

    const promptSettings = await _get(KEYS.PROMPT_SETTINGS);
    if (!promptSettings) {
      await _set({ [KEYS.PROMPT_SETTINGS]: DEFAULT_PROMPT_SETTINGS });
    }
  }

  // ─── Profile CRUD ────────────────────────────────────────────

  async function getProfiles() {
    return (await _get(KEYS.PROFILES)) || [];
  }

  async function getActiveProfileId() {
    return (await _get(KEYS.ACTIVE_PROFILE)) || 'personal_default';
  }

  async function getActiveProfile() {
    const profiles = await getProfiles();
    const activeId = await getActiveProfileId();
    return profiles.find(p => p.id === activeId) || profiles[0] || null;
  }

  async function setActiveProfile(profileId) {
    await _set({ [KEYS.ACTIVE_PROFILE]: profileId });
  }

  async function getProfileById(id) {
    const profiles = await getProfiles();
    return profiles.find(p => p.id === id) || null;
  }

  async function saveProfile(profile) {
    const profiles = await getProfiles();
    const idx = profiles.findIndex(p => p.id === profile.id);
    profile.updatedAt = new Date().toISOString();
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profile.createdAt = profile.createdAt || new Date().toISOString();
      profiles.push(profile);
    }
    await _set({ [KEYS.PROFILES]: profiles });
    return profile;
  }

  async function createProfile(name, icon = '📋') {
    const profile = {
      id:        _generateId(),
      name,
      icon,
      data:      { ...DEFAULT_PROFILE_DATA },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveProfile(profile);
    return profile;
  }

  async function deleteProfile(id) {
    let profiles = await getProfiles();
    profiles = profiles.filter(p => p.id !== id);
    await _set({ [KEYS.PROFILES]: profiles });

    // If we deleted the active profile, switch to first
    const activeId = await getActiveProfileId();
    if (activeId === id && profiles.length > 0) {
      await setActiveProfile(profiles[0].id);
    }
  }

  async function duplicateProfile(id) {
    const source = await getProfileById(id);
    if (!source) return null;
    const dup = {
      id:        _generateId(),
      name:      source.name + ' (Copy)',
      icon:      source.icon,
      data:      { ...source.data },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveProfile(dup);
    return dup;
  }

  async function upsertBackendProfile(payload, options = {}) {
    const incomingProfile = payload?.profile || payload || {};
    const incomingData = _sanitizeProfileData(incomingProfile.data || payload?.data || {});
    if (Object.keys(incomingData).length === 0) {
      throw new Error('Backend profile did not include any autofill values');
    }

    const profiles = await getProfiles();
    const profileId = incomingProfile.id || BACKEND_PROFILE_ID;
    const idx = profiles.findIndex(p => p.id === profileId);
    const existing = idx >= 0 ? profiles[idx] : null;
    const now = new Date().toISOString();
    const merged = {
      id: profileId,
      name: incomingProfile.name || existing?.name || 'Backend User Data',
      icon: incomingProfile.icon || existing?.icon || 'DB',
      data: {
        ...DEFAULT_PROFILE_DATA,
        ...(existing?.data || {}),
        ...incomingData,
      },
      source: incomingProfile.source || existing?.source || 'backend_user_data',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (idx >= 0) {
      profiles[idx] = merged;
    } else {
      profiles.unshift(merged);
    }

    const storagePayload = { [KEYS.PROFILES]: profiles };
    if (options.activate !== false) {
      storagePayload[KEYS.ACTIVE_PROFILE] = merged.id;
    }
    await _set(storagePayload);
    return merged;
  }

  // ─── Import / Export ─────────────────────────────────────────

  function exportProfiles(profiles) {
    return JSON.stringify(profiles, null, 2);
  }

  async function importProfiles(jsonString) {
    const imported = JSON.parse(jsonString);
    if (!Array.isArray(imported)) throw new Error('Expected an array of profiles');

    const profiles = await getProfiles();
    for (const p of imported) {
      if (!p.id) p.id = _generateId();
      if (!p.name) p.name = 'Imported Profile';
      if (!p.data) p.data = { ...DEFAULT_PROFILE_DATA };
      p.updatedAt = new Date().toISOString();

      const idx = profiles.findIndex(x => x.id === p.id);
      if (idx >= 0) {
        profiles[idx] = p;
      } else {
        profiles.push(p);
      }
    }
    await _set({ [KEYS.PROFILES]: profiles });
    return profiles;
  }

  // ─── Domain Mappings ─────────────────────────────────────────

  async function getDomainMappings(domain) {
    const all = (await _get(KEYS.DOMAIN_MAPS)) || {};
    return all[domain] || {};
  }

  async function saveDomainMapping(domain, fieldSelector, profileKey) {
    const all = (await _get(KEYS.DOMAIN_MAPS)) || {};
    if (!all[domain]) all[domain] = {};
    all[domain][fieldSelector] = profileKey;
    await _set({ [KEYS.DOMAIN_MAPS]: all });
  }

  async function getAllDomainMappings() {
    return (await _get(KEYS.DOMAIN_MAPS)) || {};
  }

  async function deleteDomainMapping(domain, fieldSelector) {
    const all = (await _get(KEYS.DOMAIN_MAPS)) || {};
    if (all[domain]) {
      delete all[domain][fieldSelector];
      if (Object.keys(all[domain]).length === 0) delete all[domain];
    }
    await _set({ [KEYS.DOMAIN_MAPS]: all });
  }

  async function clearDomainMappings(domain) {
    const all = (await _get(KEYS.DOMAIN_MAPS)) || {};
    delete all[domain];
    await _set({ [KEYS.DOMAIN_MAPS]: all });
  }

  // ─── Settings ────────────────────────────────────────────────

  async function getSettings() {
    return (await _get(KEYS.SETTINGS)) || { ...DEFAULT_SETTINGS };
  }

  async function updateSettings(partial) {
    const current = await getSettings();
    const merged = { ...current, ...partial };
    await _set({ [KEYS.SETTINGS]: merged });
    return merged;
  }

  async function getPromptSettings() {
    return (await _get(KEYS.PROMPT_SETTINGS)) || { ...DEFAULT_PROMPT_SETTINGS };
  }

  async function updatePromptSettings(partial) {
    const current = await getPromptSettings();
    const merged = { ...current, ...partial };
    await _set({ [KEYS.PROMPT_SETTINGS]: merged });
    return merged;
  }

  async function getPromptLibrary() {
    const prompts = (await _get(KEYS.PROMPT_LIBRARY)) || [];
    return prompts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async function getPromptById(id) {
    const prompts = await getPromptLibrary();
    return prompts.find(p => p.id === id) || null;
  }

  async function savePrompt(prompt) {
    const prompts = await getPromptLibrary();
    const now = new Date().toISOString();
    const normalized = {
      id: prompt.id || _generateEntityId('prompt'),
      title: String(prompt.title || 'Untitled Prompt').trim(),
      description: String(prompt.description || '').trim(),
      promptText: String(prompt.promptText || prompt.prompt_text || '').trim(),
      optimizedPrompt: String(prompt.optimizedPrompt || prompt.optimized_prompt || '').trim(),
      projectContext: String(prompt.projectContext || prompt.project_context || '').trim(),
      tags: _normalizeTags(prompt.tags),
      targetModels: Array.isArray(prompt.targetModels) ? prompt.targetModels.slice(0, 8) : [],
      source: String(prompt.source || 'manual').trim() || 'manual',
      favorite: prompt.favorite === true,
      createdAt: prompt.createdAt || now,
      updatedAt: now,
    };

    const idx = prompts.findIndex(p => p.id === normalized.id);
    if (idx >= 0) {
      normalized.createdAt = prompts[idx].createdAt || normalized.createdAt;
      prompts[idx] = normalized;
    } else {
      prompts.push(normalized);
    }

    await _set({ [KEYS.PROMPT_LIBRARY]: prompts });
    return normalized;
  }

  async function deletePrompt(id) {
    const prompts = await getPromptLibrary();
    await _set({ [KEYS.PROMPT_LIBRARY]: prompts.filter(p => p.id !== id) });
  }

  async function searchPromptLibrary(query = '', tag = '') {
    const prompts = await getPromptLibrary();
    const queryNorm = String(query || '').trim().toLowerCase();
    const tagNorm = String(tag || '').trim().toLowerCase();

    return prompts.filter(prompt => {
      const matchesTag = !tagNorm || (prompt.tags || []).some(t => String(t).toLowerCase() === tagNorm);
      if (!matchesTag) return false;
      if (!queryNorm) return true;

      const haystack = [
        prompt.title,
        prompt.description,
        prompt.promptText,
        prompt.optimizedPrompt,
        prompt.projectContext,
        ...(prompt.tags || []),
      ].join(' ').toLowerCase();

      return haystack.includes(queryNorm);
    });
  }

  async function exportPromptLibrary() {
    const prompts = await getPromptLibrary();
    return JSON.stringify(prompts, null, 2);
  }

  async function importPromptLibrary(jsonString) {
    const imported = JSON.parse(jsonString);
    if (!Array.isArray(imported)) throw new Error('Expected array of prompts');
    for (const raw of imported) {
      await savePrompt({
        ...raw,
        id: raw.id || _generateEntityId('prompt'),
        createdAt: raw.createdAt || new Date().toISOString(),
      });
    }
    return await getPromptLibrary();
  }

  async function getPromptContexts() {
    const contexts = (await _get(KEYS.PROMPT_CONTEXTS)) || [];
    return contexts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async function getPromptContextById(id) {
    const contexts = await getPromptContexts();
    return contexts.find(c => c.id === id) || null;
  }

  async function savePromptContext(context) {
    const contexts = await getPromptContexts();
    const now = new Date().toISOString();
    const normalized = {
      id: context.id || _generateEntityId('context'),
      title: String(context.title || 'Untitled Context').trim(),
      content: String(context.content || '').trim(),
      tags: _normalizeTags(context.tags),
      createdAt: context.createdAt || now,
      updatedAt: now,
    };

    const idx = contexts.findIndex(c => c.id === normalized.id);
    if (idx >= 0) {
      normalized.createdAt = contexts[idx].createdAt || normalized.createdAt;
      contexts[idx] = normalized;
    } else {
      contexts.push(normalized);
    }

    await _set({ [KEYS.PROMPT_CONTEXTS]: contexts });
    return normalized;
  }

  async function deletePromptContext(id) {
    const contexts = await getPromptContexts();
    await _set({ [KEYS.PROMPT_CONTEXTS]: contexts.filter(c => c.id !== id) });
  }

  async function exportPromptContexts() {
    const contexts = await getPromptContexts();
    return JSON.stringify(contexts, null, 2);
  }

  async function importPromptContexts(jsonString) {
    const imported = JSON.parse(jsonString);
    if (!Array.isArray(imported)) throw new Error('Expected array of contexts');

    for (const raw of imported) {
      await savePromptContext({
        ...raw,
        id: raw.id || _generateEntityId('context'),
        createdAt: raw.createdAt || new Date().toISOString(),
      });
    }
  }

  // ─── Document Meta (preserved from original) ────────────────

  async function getDocMeta() {
    return await _get(KEYS.DOC_META);
  }

  async function setDocMeta(meta) {
    await _set({ [KEYS.DOC_META]: meta });
  }

  async function clearDocMeta() {
    await _remove(KEYS.DOC_META);
  }

  // ─── Learned Memory ──────────────────────────────────────────

  async function getLearnedMemory() {
    return (await _get(KEYS.LEARNED_MEMORY)) || [];
  }

  async function getLearnedMemoryStats() {
    const entries = await getLearnedMemory();
    const domains = new Set(entries.filter(e => e.domain !== '__global__').map(e => e.domain));
    return {
      totalEntries: entries.length,
      domainCount: domains.size,
      globalCount: entries.filter(e => e.domain === '__global__').length,
      domainEntries: entries.filter(e => e.domain !== '__global__').length,
    };
  }

  async function clearLearnedMemory() {
    await _set({ [KEYS.LEARNED_MEMORY]: [] });
  }

  async function clearLearnedDomain(domain) {
    let entries = await getLearnedMemory();
    entries = entries.filter(e => e.domain !== domain);
    await _set({ [KEYS.LEARNED_MEMORY]: entries });
  }

  async function exportLearnedMemory() {
    const entries = await getLearnedMemory();
    return JSON.stringify(entries, null, 2);
  }

  async function importLearnedMemory(jsonString) {
    const imported = JSON.parse(jsonString);
    if (!Array.isArray(imported)) throw new Error('Expected array of memory entries');
    await _set({ [KEYS.LEARNED_MEMORY]: imported });
  }

  // ─── Reset Everything ────────────────────────────────────────

  async function resetAll() {
    await chrome.storage.local.clear();
    await init();
  }

  // ─── Expose ──────────────────────────────────────────────────
  return {
    KEYS, DEFAULT_PROFILE_DATA, DEFAULT_PROMPT_SETTINGS, BACKEND_PROFILE_ID,
    init,
    getProfiles, getActiveProfileId, getActiveProfile, setActiveProfile,
    getProfileById, saveProfile, createProfile, deleteProfile, duplicateProfile,
    upsertBackendProfile,
    exportProfiles, importProfiles,
    getDomainMappings, saveDomainMapping, getAllDomainMappings,
    deleteDomainMapping, clearDomainMappings,
    getSettings, updateSettings,
    getPromptSettings, updatePromptSettings,
    getPromptLibrary, getPromptById, savePrompt, deletePrompt,
    searchPromptLibrary, exportPromptLibrary, importPromptLibrary,
    getPromptContexts, getPromptContextById, savePromptContext, deletePromptContext,
    exportPromptContexts, importPromptContexts,
    getDocMeta, setDocMeta, clearDocMeta,
    getLearnedMemory, getLearnedMemoryStats,
    clearLearnedMemory, clearLearnedDomain,
    exportLearnedMemory, importLearnedMemory,
    resetAll,
  };
})();

// Make available for ES module import and script tag usage
if (typeof globalThis !== 'undefined') globalThis.StorageManager = StorageManager;
