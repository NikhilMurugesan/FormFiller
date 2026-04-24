/**
 * LearnedMemory — Persistent learning cache for FormFiller Pro
 * 
 * Stores and retrieves:
 *  - Learned dropdown selections per domain + field intent
 *  - Learned checkbox selections per domain + field intent
 *  - Manual corrections (user changed autofilled value)
 *  - Usage counts and confidence evolution
 *  - Global fallback preferences (cross-domain)
 * 
 * Storage key: ff_learned_memory
 * 
 * Schema per entry:
 * {
 *   id:              string,   // unique hash: domain + fieldIntent + fieldId
 *   domain:          string,   // e.g. "linkedin.com"
 *   pageType:        string,   // from FormTypeClassifier or null
 *   fieldLabel:      string,   // human label
 *   fieldType:       string,   // "checkbox","select","radio","text" etc.
 *   fieldName:       string,
 *   fieldId:         string,
 *   placeholder:     string,
 *   fieldIntent:     string,   // normalized intent key
 *   value:           any,      // stored value / option text / checked state
 *   valueSource:     string,   // "profile" | "learned" | "manual_correction" | "domain_rule"
 *   confidence:      number,   // 0-100, evolves over time
 *   usageCount:      number,
 *   correctionCount: number,   // how many times user changed the autofilled result
 *   createdAt:       string,   // ISO
 *   lastUsedAt:      string,   // ISO
 * }
 */

var LearnedMemory = LearnedMemory || (() => {

  const STORAGE_KEY = 'ff_learned_memory';
  const MAX_ENTRIES = 2000; // cap to prevent storage bloat

  // ─── Internal helpers ──────────────────────────────────────
  function _get() {
    return new Promise(resolve => {
      chrome.storage.local.get(STORAGE_KEY, r => resolve(r[STORAGE_KEY] || []));
    });
  }

  function _set(entries) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [STORAGE_KEY]: entries }, resolve);
    });
  }

  /**
   * Generate a deterministic ID for a memory entry.
   * domain + fieldIntent gives domain-specific lookup.
   * Adding fieldId gives exact-field lookup.
   */
  function makeId(domain, fieldIntent, fieldId) {
    return `${domain}::${fieldIntent}::${fieldId || ''}`.toLowerCase();
  }

  function makeGlobalId(fieldIntent) {
    return `__global__::${fieldIntent}::`.toLowerCase();
  }

  // ─── Field Intent Normalization ────────────────────────────
  // Reduces field metadata to a canonical "intent" string
  const INTENT_PATTERNS = [
    { intent: 'work_authorization',    patterns: [/work.?auth/i, /authorized?.?to.?work/i, /right.?to.?work/i, /work.?permit/i, /legal.?right/i, /eligible.?to.?work/i, /employment.?eligib/i] },
    { intent: 'sponsorship',           patterns: [/sponsor/i, /visa.?sponsor/i, /immigration.?sponsor/i, /h1b/i, /h-1b/i, /require.?sponsor/i, /need.?sponsor/i] },
    { intent: 'relocation',            patterns: [/relocat/i, /willing.?to.?move/i, /open.?to.?relocat/i, /relocation/i] },
    { intent: 'remote_preference',     patterns: [/remote/i, /work.?from.?home/i, /hybrid/i, /on.?site/i, /onsite/i, /in.?office/i, /work.?location.?pref/i, /work.?type/i, /workplace.?type/i] },
    { intent: 'employment_type',       patterns: [/employ.?type/i, /job.?type/i, /full.?time/i, /part.?time/i, /contract/i, /freelance/i, /internship/i, /temporary/i] },
    { intent: 'start_date',            patterns: [/start.?date/i, /avail.?date/i, /join.?date/i, /earliest.?start/i, /when.?can.?you.?start/i, /availability/i] },
    { intent: 'notice_period',         patterns: [/notice.?period/i, /notice.?time/i, /days.?notice/i, /current.?notice/i] },
    { intent: 'salary_expectation',    patterns: [/salary/i, /compensation/i, /expected.?pay/i, /desired.?salary/i, /pay.?expect/i, /ctc/i, /expected.?ctc/i, /current.?ctc/i] },
    { intent: 'experience_years',      patterns: [/year.?of.?exp/i, /yoe/i, /total.?exp/i, /work.?exp/i, /professional.?exp/i, /experience/i] },
    { intent: 'education_level',       patterns: [/degree/i, /education.?level/i, /highest.?degree/i, /qualification/i, /academic/i] },
    { intent: 'gender',                patterns: [/gender/i, /sex/i, /gender.?identity/i, /pronouns/i] },
    { intent: 'ethnicity',             patterns: [/ethnic/i, /race/i, /racial/i, /heritage/i, /demographic/i] },
    { intent: 'veteran_status',        patterns: [/veteran/i, /military/i, /armed.?force/i, /service.?member/i] },
    { intent: 'disability_status',     patterns: [/disab/i, /handicap/i, /accommodat/i, /special.?need/i] },
    { intent: 'newsletter',            patterns: [/newsletter/i, /subscri/i, /mailing.?list/i, /email.?update/i, /marketing.?email/i, /promotional/i] },
    { intent: 'country_code',          patterns: [/country.?code/i, /dial.?code/i, /dialing.?code/i, /phone.?country.?code/i, /isd.?code/i, /calling.?code/i] },
    { intent: 'country',               patterns: [/country/i, /nation/i, /country.?of.?residence/i, /home.?country/i] },
    { intent: 'state',                 patterns: [/^state$/i, /province/i, /state.?province/i, /region/i] },
    { intent: 'city',                  patterns: [/^city$/i, /town/i, /city.?town/i, /metro/i, /location/i, /preferred.?location/i] },
    { intent: 'phone_type',            patterns: [/phone.?type/i, /mobile.?type/i, /device.?type/i] },
    { intent: 'language',              patterns: [/language/i, /language.?proficiency/i, /fluent/i, /speak/i, /known.?language/i] },
    { intent: 'hear_about',            patterns: [/hear.?about/i, /how.?did.?you/i, /referral.?source/i, /source/i, /where.?did.?you.?hear/i, /how.?did.?you.?find/i] },
    { intent: 'shift_preference',      patterns: [/shift/i, /work.?shift/i, /shift.?prefer/i, /night.?shift/i, /day.?shift/i] },
    { intent: 'travel_willingness',    patterns: [/travel/i, /willing.?to.?travel/i, /travel.?percent/i, /business.?travel/i] },
    { intent: 'same_as_above',         patterns: [/same.?as/i, /copy.?from/i, /use.?above/i, /duplicate/i, /same.?address/i] },
  ];

  /**
   * Normalize field signals into a canonical intent string.
   * @param {Object} field or text signals
   * @returns {string} intent key or 'unknown'
   */
  function normalizeIntent(fieldOrText) {
    let text = '';
    if (typeof fieldOrText === 'string') {
      text = fieldOrText;
    } else {
      text = [
        fieldOrText.label, fieldOrText.name, fieldOrText.id,
        fieldOrText.placeholder, fieldOrText.ariaLabel,
        fieldOrText.surroundingText
      ].filter(Boolean).join(' ');
    }
    if (!text) return 'unknown';

    for (const { intent, patterns } of INTENT_PATTERNS) {
      for (const p of patterns) {
        if (p.test(text)) return intent;
      }
    }
    return 'unknown';
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Record a learned value for a field.
   * Called after autofill confirmation or manual correction.
   * 
   * @param {Object} params
   * @param {string} params.domain
   * @param {string} params.pageType
   * @param {Object} params.field - { label, type, name, id, placeholder }
   * @param {*} params.value - The selected/corrected value
   * @param {string} params.valueSource - "profile"|"learned"|"manual_correction"|"domain_rule"
   * @param {number} params.confidence - Initial confidence
   */
  async function record(params) {
    const { domain, pageType, field, value, valueSource, confidence } = params;
    const fieldIntent = normalizeIntent(field);
    const id = makeId(domain, fieldIntent, field.id || field.name);
    const globalId = makeGlobalId(fieldIntent);
    const now = new Date().toISOString();

    let entries = await _get();

    // Find or create domain-specific entry
    let entry = entries.find(e => e.id === id);
    if (entry) {
      // Update existing
      if (entry.value === value) {
        // Same value → confirmed, boost confidence
        entry.confidence = Math.min(100, entry.confidence + 5);
        entry.usageCount += 1;
      } else {
        // Different value → correction
        entry.value = value;
        entry.valueSource = valueSource;
        entry.correctionCount += 1;
        // Reduce confidence if keeps changing
        entry.confidence = Math.max(30, entry.confidence - 10);
      }
      entry.lastUsedAt = now;
    } else {
      // Create new entry
      entry = {
        id,
        domain:          domain || 'unknown',
        pageType:        pageType || null,
        fieldLabel:      field.label || '',
        fieldType:       field.type || '',
        fieldName:       field.name || '',
        fieldId:         field.id || '',
        placeholder:     field.placeholder || '',
        fieldIntent,
        value,
        valueSource:     valueSource || 'learned',
        confidence:      confidence || 70,
        usageCount:      1,
        correctionCount: 0,
        createdAt:       now,
        lastUsedAt:      now,
      };
      entries.push(entry);
    }

    // Also update/create global fallback if intent is known
    if (fieldIntent !== 'unknown') {
      let global = entries.find(e => e.id === globalId);
      if (global) {
        if (global.value === value) {
          global.confidence = Math.min(85, global.confidence + 3);
          global.usageCount += 1;
        } else {
          global.correctionCount += 1;
          // Only update global if correction count is low (consistent user)
          if (global.correctionCount >= 3) {
            global.confidence = Math.max(20, global.confidence - 5);
          } else {
            global.value = value;
            global.confidence = Math.max(40, global.confidence - 3);
          }
        }
        global.lastUsedAt = now;
      } else {
        entries.push({
          id:              globalId,
          domain:          '__global__',
          pageType:        null,
          fieldLabel:      field.label || '',
          fieldType:       field.type || '',
          fieldName:       '',
          fieldId:         '',
          placeholder:     '',
          fieldIntent,
          value,
          valueSource:     'learned',
          confidence:      50,
          usageCount:      1,
          correctionCount: 0,
          createdAt:       now,
          lastUsedAt:      now,
        });
      }
    }

    // Trim old entries if over cap
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));
      entries = entries.slice(0, MAX_ENTRIES);
    }

    await _set(entries);
    return entry;
  }

  /**
   * Lookup the best learned value using priority cascade:
   *  1. exact domain + exact field
   *  2. exact domain + same field intent
   *  3. global preference by intent
   * 
   * @param {string} domain
   * @param {Object} field - { label, name, id, placeholder, type, ariaLabel, surroundingText }
   * @returns {{ value: any, confidence: number, source: string, hasConflict: boolean } | null}
   */
  async function lookup(domain, field) {
    const fieldIntent = normalizeIntent(field);
    const id = makeId(domain, fieldIntent, field.id || field.name);
    const entries = await _get();

    // Priority 1: Exact domain + exact field
    const exact = entries.find(e => e.id === id);
    if (exact && exact.confidence >= 30) {
      // Check for conflicting mappings on same domain+intent
      const conflicting = entries.filter(
        e => e.domain === domain && e.fieldIntent === fieldIntent && e.id !== id && e.value !== exact.value
      );
      return {
        value: exact.value,
        confidence: exact.confidence,
        source: 'exact_domain_field',
        hasConflict: conflicting.length > 0,
        usageCount: exact.usageCount,
        correctionCount: exact.correctionCount,
      };
    }

    // Priority 2: Same domain + same intent (different field id/name)
    if (fieldIntent !== 'unknown') {
      const domainIntent = entries.filter(
        e => e.domain === domain && e.fieldIntent === fieldIntent && e.confidence >= 40
      );
      if (domainIntent.length > 0) {
        // Use the most confident & most recently used
        domainIntent.sort((a, b) => (b.confidence - a.confidence) || (new Date(b.lastUsedAt) - new Date(a.lastUsedAt)));
        const best = domainIntent[0];
        // Check for conflicts
        const uniqueValues = new Set(domainIntent.map(e => String(e.value)));
        return {
          value: best.value,
          confidence: Math.min(best.confidence, 85), // cap for intent-level match
          source: 'domain_intent',
          hasConflict: uniqueValues.size > 1,
          usageCount: best.usageCount,
          correctionCount: best.correctionCount,
        };
      }
    }

    // Priority 3: Global fallback by intent
    if (fieldIntent !== 'unknown') {
      const globalId = makeGlobalId(fieldIntent);
      const global = entries.find(e => e.id === globalId);
      if (global && global.confidence >= 35) {
        return {
          value: global.value,
          confidence: Math.min(global.confidence, 65), // cap for global
          source: 'global_intent',
          hasConflict: global.correctionCount >= 3,
          usageCount: global.usageCount,
          correctionCount: global.correctionCount,
        };
      }
    }

    return null;
  }

  /**
   * Get all entries for a specific domain.
   */
  async function getByDomain(domain) {
    const entries = await _get();
    return entries.filter(e => e.domain === domain);
  }

  /**
   * Get all entries (for debug / settings viewer).
   */
  async function getAll() {
    return await _get();
  }

  /**
   * Get summary stats.
   */
  async function getStats() {
    const entries = await _get();
    const domains = new Set(entries.filter(e => e.domain !== '__global__').map(e => e.domain));
    return {
      totalEntries: entries.length,
      domainCount: domains.size,
      globalCount: entries.filter(e => e.domain === '__global__').length,
      domainEntries: entries.filter(e => e.domain !== '__global__').length,
    };
  }

  /**
   * Clear all learned memory.
   */
  async function clearAll() {
    await _set([]);
  }

  /**
   * Clear learned memory for a specific domain.
   */
  async function clearDomain(domain) {
    let entries = await _get();
    entries = entries.filter(e => e.domain !== domain);
    await _set(entries);
  }

  /**
   * Export all learned memory as JSON string.
   */
  async function exportMemory() {
    const entries = await _get();
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Import learned memory from JSON string.
   */
  async function importMemory(jsonString) {
    const imported = JSON.parse(jsonString);
    if (!Array.isArray(imported)) throw new Error('Expected array');
    await _set(imported);
  }

  return {
    STORAGE_KEY,
    normalizeIntent,
    record,
    lookup,
    getByDomain,
    getAll,
    getStats,
    clearAll,
    clearDomain,
    exportMemory,
    importMemory,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.LearnedMemory = LearnedMemory;
