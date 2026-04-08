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

var StorageManager = StorageManager || (() => {
  // ─── Storage Keys ────────────────────────────────────────────
  const KEYS = {
    PROFILES:       'ff_profiles',
    ACTIVE_PROFILE: 'ff_active_profile_id',
    DOMAIN_MAPS:    'ff_domain_mappings',
    SETTINGS:       'ff_settings',
    LEGACY_DATA:    'ff_user_data',       // old format — migrate on first run
    DOC_META:       'ff_doc_meta',
    LEARNED_MEMORY: 'ff_learned_memory',  // checkbox/dropdown/correction memory
  };

  // ─── Default Profile Template ────────────────────────────────
  const DEFAULT_PROFILE_DATA = {
    full_name: '', first_name: '', last_name: '',
    email: '', phone: '',
    address: '', city: '', state: '', zip: '', country: '',
    current_company: '', current_title: '',
    linkedin: '', portfolio: '', github: '', website: '',
    highest_degree: '', school: '', major: '', graduation_year: '',
    years_of_experience: '', skills: '', summary: '',
    gender: '', dob: '',
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

  // ─── Pre-loaded Default Profile (from user_data.py) ──────────
  const PRELOADED_PERSONAL = {
    id:   'personal_default',
    name: 'Personal',
    icon: '👤',
    data: {
      full_name:            'Nikhil Murugesan',
      first_name:           'Nikhil',
      last_name:            'Murugesan',
      email:                'mmmm.nikhil@gmail.com',
      phone:                '+91-9597917991',
      city:                 'Chennai',
      state:                'Tamil Nadu',
      country:              'India',
      current_company:      'UPS Supply Chain Solutions',
      current_title:        'Application Developer',
      linkedin:             'https://www.linkedin.com/in/nikhil-murugesan-2484b4180',
      portfolio:            'https://nikhilmurugesan.in',
      website:              'https://nikhilmurugesan.in',
      github:               'https://github.com/NikhilMurugesan',
      highest_degree:       "Bachelor's degree",
      school:               'Vellore Institute of Technology',
      major:                'Computer Engineering',
      years_of_experience:  '4',
      skills:               'Python, Java, Spring Boot, Spring Cloud, FastAPI, Angular, AWS, Docker, OpenShift, Oracle, MySQL, SYBASE, Redis, NLP, Hugging Face, RoBERTa, Sentiment Analysis, LLM Integration, RAG, Feature Engineering, Model Training, Model Evaluation, Microservices, REST APIs, Distributed Systems',
      summary:              'AI/ML and backend engineer with experience building scalable microservices, data pipelines, NLP systems, and production-grade distributed systems.',
    },
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

  function _generateId() {
    return 'profile_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
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
    KEYS, DEFAULT_PROFILE_DATA,
    init,
    getProfiles, getActiveProfileId, getActiveProfile, setActiveProfile,
    getProfileById, saveProfile, createProfile, deleteProfile, duplicateProfile,
    exportProfiles, importProfiles,
    getDomainMappings, saveDomainMapping, getAllDomainMappings,
    deleteDomainMapping, clearDomainMappings,
    getSettings, updateSettings,
    getDocMeta, setDocMeta, clearDocMeta,
    getLearnedMemory, getLearnedMemoryStats,
    clearLearnedMemory, clearLearnedDomain,
    exportLearnedMemory, importLearnedMemory,
    resetAll,
  };
})();

// Make available for ES module import and script tag usage
if (typeof globalThis !== 'undefined') globalThis.StorageManager = StorageManager;
