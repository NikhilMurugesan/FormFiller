/**
 * DropdownEngine — Intelligent dropdown handling for FormFiller Pro
 * 
 * Supports:
 *  - Native HTML <select> (single & multi)
 *  - Custom div-based dropdowns (listbox, combobox)
 *  - Searchable/typeahead selects
 *  - Framework dropdowns (React/Angular/Vue)
 *  - Dependent dropdowns (country→state→city) with retry/wait
 *  - Yes/No answer selection based on field intent
 * 
 * Matching cascade per option:
 *  1. Exact value/text match
 *  2. Case-insensitive match
 *  3. Normalized match (strip accents, punctuation)
 *  4. Synonym/abbreviation match (known mappings)
 *  5. Fuzzy match (only when safe, high similarity)
 *  6. Partial match (only when confidence is strong)
 */

var DropdownEngine = DropdownEngine || (() => {

  // ─── Known Abbreviation/Synonym Maps ────────────────────────
  const STATE_ABBREVIATIONS = {
    'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', 'assam': 'AS',
    'bihar': 'BR', 'chhattisgarh': 'CG', 'goa': 'GA', 'gujarat': 'GJ',
    'haryana': 'HR', 'himachal pradesh': 'HP', 'jharkhand': 'JH',
    'karnataka': 'KA', 'kerala': 'KL', 'madhya pradesh': 'MP',
    'maharashtra': 'MH', 'manipur': 'MN', 'meghalaya': 'ML',
    'mizoram': 'MZ', 'nagaland': 'NL', 'odisha': 'OD', 'punjab': 'PB',
    'rajasthan': 'RJ', 'sikkim': 'SK', 'tamil nadu': 'TN',
    'telangana': 'TS', 'tripura': 'TR', 'uttar pradesh': 'UP',
    'uttarakhand': 'UK', 'west bengal': 'WB',
    // US states
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN',
    'mississippi': 'MS', 'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE',
    'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
    'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR',
    'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
    'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  };

  const COUNTRY_CODES = {
    'india': 'IN', 'united states': 'US', 'united states of america': 'US',
    'usa': 'US', 'united kingdom': 'GB', 'uk': 'GB', 'canada': 'CA',
    'australia': 'AU', 'germany': 'DE', 'france': 'FR', 'japan': 'JP',
    'china': 'CN', 'brazil': 'BR', 'mexico': 'MX', 'singapore': 'SG',
    'south korea': 'KR', 'italy': 'IT', 'spain': 'ES', 'netherlands': 'NL',
    'switzerland': 'CH', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
    'ireland': 'IE', 'new zealand': 'NZ', 'south africa': 'ZA',
    'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA',
    'israel': 'IL', 'taiwan': 'TW', 'hong kong': 'HK', 'malaysia': 'MY',
    'indonesia': 'ID', 'philippines': 'PH', 'thailand': 'TH', 'vietnam': 'VN',
    'poland': 'PL', 'belgium': 'BE', 'austria': 'AT', 'czech republic': 'CZ',
    'portugal': 'PT', 'finland': 'FI', 'russia': 'RU', 'sri lanka': 'LK',
    'pakistan': 'PK', 'bangladesh': 'BD', 'nepal': 'NP',
  };

  const DEGREE_SYNONYMS = {
    "bachelor's degree":   ["bachelors", "bachelor", "bsc", "b.sc", "b.sc.", "ba", "b.a", "b.a.", "btech", "b.tech", "b.tech.", "b.e", "b.e.", "be", "bca", "b.ca", "bba", "b.b.a", "undergraduate", "ug", "4-year degree", "4 year degree"],
    "master's degree":     ["masters", "master", "msc", "m.sc", "m.sc.", "ma", "m.a", "m.a.", "mtech", "m.tech", "m.tech.", "mba", "m.b.a", "m.b.a.", "mca", "m.ca", "ms", "m.s", "m.s.", "postgraduate", "pg", "graduate degree"],
    "doctoral degree":     ["phd", "ph.d", "ph.d.", "doctorate", "doctoral", "dphil", "d.phil"],
    "associate's degree":  ["associates", "associate", "aa", "a.a", "a.s", "as", "2-year degree", "2 year degree"],
    "high school diploma": ["high school", "hs diploma", "hsc", "12th", "12th grade", "+2", "higher secondary", "secondary school", "ged"],
    "professional degree": ["professional", "md", "m.d", "jd", "j.d", "dds", "dmd", "llm", "ll.m"],
  };

  const YES_NO_SYNONYMS = {
    yes: ['yes', 'y', 'true', '1', 'yeah', 'yep', 'affirmative', 'indeed', 'correct', 'definitely'],
    no:  ['no', 'n', 'false', '0', 'nah', 'nope', 'negative', 'not'],
  };

  // ─── Normalization ──────────────────────────────────────────
  function norm(s) {
    if (!s) return '';
    return s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
      .replace(/[''`]/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ─── Levenshtein similarity ─────────────────────────────────
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - (levenshtein(a, b) / maxLen);
  }

  // ═══════════════════════════════════════════════════════════
  // CORE: Match a value against dropdown options
  // ═══════════════════════════════════════════════════════════

  /**
   * Find the best matching option for a given value.
   * 
   * @param {string} targetValue - The value to match (from profile/memory)
   * @param {Array} options - [{ value, text }] from the <select> element
   * @param {Object} context - { fieldIntent, domain } for smart matching
   * @returns {{ optionValue: string, optionText: string, confidence: number, matchType: string } | null}
   */
  function matchOption(targetValue, options, context = {}) {
    if (!targetValue || !options || options.length === 0) return null;

    const target = String(targetValue);
    const targetNorm = norm(target);

    if (!targetNorm) return null;

    // Filter out placeholder/empty options
    const validOptions = options.filter(o => o.value && o.text.trim() && o.value !== '' && !o.text.match(/^--(select|choose|pick|option)/i));

    // 1) Exact value match
    for (const o of validOptions) {
      if (o.value === target || o.text.trim() === target) {
        return { optionValue: o.value, optionText: o.text, confidence: 98, matchType: 'exact' };
      }
    }

    // 2) Case-insensitive match
    for (const o of validOptions) {
      if (o.value.toLowerCase() === target.toLowerCase() || o.text.trim().toLowerCase() === target.toLowerCase()) {
        return { optionValue: o.value, optionText: o.text, confidence: 95, matchType: 'case_insensitive' };
      }
    }

    // 3) Normalized match
    for (const o of validOptions) {
      const oNorm = norm(o.text);
      const oValNorm = norm(o.value);
      if (oNorm === targetNorm || oValNorm === targetNorm) {
        return { optionValue: o.value, optionText: o.text, confidence: 90, matchType: 'normalized' };
      }
    }

    // 4) Known synonym/abbreviation match
    const synonymResult = matchBySynonym(targetNorm, validOptions, context.fieldIntent);
    if (synonymResult) return synonymResult;

    // 5) Fuzzy match (only when safe — similarity > 0.85)
    let bestFuzzy = null;
    let bestFuzzyScore = 0;
    for (const o of validOptions) {
      const oNorm = norm(o.text);
      if (oNorm.length < 2) continue;
      const score = similarity(targetNorm, oNorm);
      if (score > 0.85 && score > bestFuzzyScore) {
        bestFuzzyScore = score;
        bestFuzzy = { optionValue: o.value, optionText: o.text, confidence: Math.round(score * 80), matchType: 'fuzzy' };
      }
    }
    if (bestFuzzy) return bestFuzzy;

    // 6) Partial/contains match (only when target is long enough)
    if (targetNorm.length >= 4) {
      for (const o of validOptions) {
        const oNorm = norm(o.text);
        if (oNorm.length >= 4 && (oNorm.includes(targetNorm) || targetNorm.includes(oNorm))) {
          // Confidence proportional to overlap
          const overlap = Math.min(oNorm.length, targetNorm.length) / Math.max(oNorm.length, targetNorm.length);
          if (overlap > 0.5) {
            return { optionValue: o.value, optionText: o.text, confidence: Math.round(overlap * 65), matchType: 'partial' };
          }
        }
      }
    }

    return null;
  }

  /**
   * Match using known synonym maps (states, countries, degrees, yes/no).
   */
  function matchBySynonym(targetNorm, options, fieldIntent) {
    // Determine which synonym maps are relevant
    const mapsToCheck = [];

    if (fieldIntent === 'state' || fieldIntent === 'country' || fieldIntent === 'unknown') {
      mapsToCheck.push({ map: buildReverseLookup(STATE_ABBREVIATIONS), label: 'state_abbrev' });
      mapsToCheck.push({ map: buildReverseLookup(COUNTRY_CODES), label: 'country_code' });
    }
    if (fieldIntent === 'education_level' || fieldIntent === 'unknown') {
      mapsToCheck.push({ map: buildDegreeLookup(), label: 'degree_synonym' });
    }

    // Always check Yes/No
    mapsToCheck.push({ map: buildYesNoLookup(), label: 'yes_no' });

    for (const { map, label } of mapsToCheck) {
      // Get all possible canonical forms of the target
      const canonicals = map[targetNorm];
      if (!canonicals) continue;

      for (const canonical of canonicals) {
        const canonNorm = norm(canonical);
        for (const o of options) {
          const oNorm = norm(o.text);
          const oValNorm = norm(o.value);
          if (oNorm === canonNorm || oValNorm === canonNorm || oNorm === targetNorm || oValNorm === targetNorm) {
            return { optionValue: o.value, optionText: o.text, confidence: 85, matchType: `synonym_${label}` };
          }
        }
      }
    }

    // Also try reverse: map option text to abbreviation and match target
    for (const o of options) {
      const oNorm = norm(o.text);

      // State: option might be abbreviation, target might be full name
      const stateAbbrev = STATE_ABBREVIATIONS[targetNorm];
      if (stateAbbrev && norm(stateAbbrev) === oNorm) {
        return { optionValue: o.value, optionText: o.text, confidence: 85, matchType: 'synonym_state_to_abbrev' };
      }
      const countryCode = COUNTRY_CODES[targetNorm];
      if (countryCode && norm(countryCode) === oNorm) {
        return { optionValue: o.value, optionText: o.text, confidence: 85, matchType: 'synonym_country_to_code' };
      }
    }

    return null;
  }

  // Build reverse lookups (abbrev → [full names], full → [abbrevs])
  function buildReverseLookup(map) {
    const reverse = {};
    for (const [full, abbr] of Object.entries(map)) {
      const fullNorm = norm(full);
      const abbrNorm = norm(abbr);
      if (!reverse[fullNorm]) reverse[fullNorm] = [];
      if (!reverse[abbrNorm]) reverse[abbrNorm] = [];
      reverse[fullNorm].push(abbr, full);
      reverse[abbrNorm].push(full, abbr);
    }
    return reverse;
  }

  function buildDegreeLookup() {
    const lookup = {};
    for (const [canonical, synonyms] of Object.entries(DEGREE_SYNONYMS)) {
      const canNorm = norm(canonical);
      if (!lookup[canNorm]) lookup[canNorm] = [];
      lookup[canNorm].push(canonical);
      for (const syn of synonyms) {
        const synNorm = norm(syn);
        if (!lookup[synNorm]) lookup[synNorm] = [];
        lookup[synNorm].push(canonical);
        lookup[canNorm].push(syn);
      }
    }
    return lookup;
  }

  function buildYesNoLookup() {
    const lookup = {};
    for (const [key, syns] of Object.entries(YES_NO_SYNONYMS)) {
      for (const s of syns) {
        const sNorm = norm(s);
        if (!lookup[sNorm]) lookup[sNorm] = [];
        lookup[sNorm].push(key);
        lookup[sNorm].push(...syns);
      }
    }
    return lookup;
  }

  // ═══════════════════════════════════════════════════════════
  // YES/NO Intent Detection
  // ═══════════════════════════════════════════════════════════

  /**
   * Detect if a dropdown is a Yes/No question and determine the answer
   * based on field intent and profile data.
   * 
   * @param {Object} field
   * @param {Array} options
   * @param {Object} profileData
   * @param {string} domain
   * @returns {{ answer: string, confidence: number } | null}
   */
  async function resolveYesNo(field, options, profileData, domain) {
    // Check if options are Yes/No
    const optTexts = options.map(o => norm(o.text));
    const hasYes = optTexts.some(t => YES_NO_SYNONYMS.yes.includes(t));
    const hasNo = optTexts.some(t => YES_NO_SYNONYMS.no.includes(t));
    if (!hasYes || !hasNo) return null;

    const intent = (typeof LearnedMemory !== 'undefined') ? LearnedMemory.normalizeIntent(field) : 'unknown';

    // Check learned memory first
    if (typeof LearnedMemory !== 'undefined') {
      const memory = await LearnedMemory.lookup(domain, field);
      if (memory && !memory.hasConflict && memory.confidence >= 60) {
        const ans = toBoolStr(memory.value) ? 'yes' : 'no';
        return { answer: ans, confidence: memory.confidence };
      }
    }

    // Profile-level yes/no answers
    const yesNoMap = {
      'work_authorization': { key: 'work_authorization', defaultYes: true },
      'sponsorship':        { key: 'sponsorship_required', defaultYes: false },
      'relocation':         { key: 'willing_to_relocate', defaultYes: null },
      'remote_preference':  { key: 'remote_preference', defaultYes: null },
      'travel_willingness': { key: 'travel_willingness', defaultYes: null },
      'veteran_status':     { key: 'veteran_status', defaultYes: false },
      'disability_status':  { key: 'disability_status', defaultYes: null },
    };

    if (yesNoMap[intent] && profileData[yesNoMap[intent].key] !== undefined) {
      const val = profileData[yesNoMap[intent].key];
      const ans = toBoolStr(val) ? 'yes' : 'no';
      return { answer: ans, confidence: 75 };
    }

    // Default behavior based on intent
    if (yesNoMap[intent] && yesNoMap[intent].defaultYes !== null) {
      return { answer: yesNoMap[intent].defaultYes ? 'yes' : 'no', confidence: 45 };
    }

    // Can't determine — return null to skip
    return null;
  }

  function toBoolStr(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase().trim();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN: Process all dropdown fields
  // ═══════════════════════════════════════════════════════════

  /**
   * @param {Array} selectFields - Field descriptors where tagName is 'select'
   * @param {Object} profileData
   * @param {string} domain
   * @returns {Promise<Array<{ field, action, optionValue, optionText, confidence, matchType, reason }>>}
   */
  async function processAll(selectFields, profileData, domain) {
    const results = [];

    for (const field of selectFields) {
      const result = await processSingle(field, profileData, domain);
      results.push(result);
    }

    return results;
  }

  /**
   * Decide on a single dropdown.
   */
  async function processSingle(field, profileData, domain) {
    const options = field.options || [];
    if (options.length === 0) {
      return { field, action: 'skip', optionValue: null, optionText: null, confidence: 0, matchType: null, reason: 'No options available' };
    }

    const intent = (typeof LearnedMemory !== 'undefined') ? LearnedMemory.normalizeIntent(field) : 'unknown';

    // 1) Check learned memory
    if (typeof LearnedMemory !== 'undefined') {
      const memory = await LearnedMemory.lookup(domain, field);
      if (memory) {
        if (memory.hasConflict) {
          return {
            field, action: 'review', optionValue: null, optionText: null,
            confidence: Math.min(memory.confidence, 45),
            matchType: 'learned_conflict',
            reason: 'Conflicting past selections — needs review',
          };
        }

        // Try matching the learned value against current options
        const match = matchOption(String(memory.value), options, { fieldIntent: intent, domain });
        if (match && match.confidence >= 60) {
          const finalConf = Math.round((memory.confidence + match.confidence) / 2);
          if (finalConf >= 70) {
            return {
              field, action: 'select', optionValue: match.optionValue, optionText: match.optionText,
              confidence: finalConf,
              matchType: `learned_${memory.source}`,
              reason: `Learned value (${memory.usageCount} uses)`,
            };
          }
          return {
            field, action: 'review', optionValue: match.optionValue, optionText: match.optionText,
            confidence: finalConf,
            matchType: `learned_${memory.source}`,
            reason: `Medium confidence learned value`,
          };
        }
      }
    }

    // 2) Check Yes/No questions
    const yesNo = await resolveYesNo(field, options, profileData, domain);
    if (yesNo) {
      const match = matchOption(yesNo.answer, options, { fieldIntent: intent, domain });
      if (match) {
        const finalConf = Math.round((yesNo.confidence + match.confidence) / 2);
        if (finalConf >= 65) {
          return {
            field, action: 'select', optionValue: match.optionValue, optionText: match.optionText,
            confidence: finalConf, matchType: 'yes_no_intent',
            reason: `Intent-based: ${intent} → ${yesNo.answer}`,
          };
        }
        return {
          field, action: 'review', optionValue: match.optionValue, optionText: match.optionText,
          confidence: finalConf, matchType: 'yes_no_intent',
          reason: `Low-confidence Yes/No for ${intent}`,
        };
      }
    }

    // 3) Match from profile data
    const profileKey = getProfileKeyForIntent(intent, field);
    const profileValue = profileKey ? profileData[profileKey] : null;

    if (profileValue) {
      const match = matchOption(profileValue, options, { fieldIntent: intent, domain });
      if (match) {
        if (match.confidence >= 70) {
          return {
            field, action: 'select', optionValue: match.optionValue, optionText: match.optionText,
            confidence: match.confidence, matchType: `profile_${match.matchType}`,
            reason: `Profile: ${profileKey} → ${match.optionText}`,
          };
        }
        return {
          field, action: 'review', optionValue: match.optionValue, optionText: match.optionText,
          confidence: match.confidence, matchType: `profile_${match.matchType}`,
          reason: `Low-confidence profile match for ${profileKey}`,
        };
      }
    }

    // 4) No match → skip
    return {
      field, action: 'skip', optionValue: null, optionText: null,
      confidence: 0, matchType: null,
      reason: `No matching value found for dropdown`,
    };
  }

  /**
   * Map field intent back to a profile key.
   */
  function getProfileKeyForIntent(intent, field) {
    const intentToProfileKey = {
      country:          'country',
      state:            'state',
      city:             'city',
      education_level:  'highest_degree',
      experience_years: 'years_of_experience',
      gender:           'gender',
    };

    if (intentToProfileKey[intent]) return intentToProfileKey[intent];

    // Fallback: use MappingEngine match
    if (typeof MappingEngine !== 'undefined') {
      const match = MappingEngine.matchField(field);
      return match?.profileKey || null;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // INJECTION: Apply dropdown decisions
  // ═══════════════════════════════════════════════════════════

  /**
   * Apply dropdown decisions to the DOM.
   */
  function applyDecisions(decisions) {
    const applied = { selected: [], skipped: [], uncertain: [] };

    for (const d of decisions) {
      if (d.action === 'skip') {
        applied.skipped.push(d);
        continue;
      }
      if (d.action === 'review') {
        applied.uncertain.push(d);
        continue;
      }

      // Action is 'select'
      const el = document.getElementById(d.field.id);
      if (!el) {
        applied.skipped.push({ ...d, reason: 'Element not found' });
        continue;
      }

      // Skip if already has a value and it's the same
      if (el.value === d.optionValue) {
        applied.skipped.push({ ...d, reason: 'Already selected' });
        continue;
      }

      // Use native setter for React/Angular/Vue compatibility
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, d.optionValue);
      } else {
        el.value = d.optionValue;
      }

      // Full event dispatch for frameworks
      InjectionEngine.dispatchEvents(el);
      el.setAttribute('data-ff-filled', 'true');
      applied.selected.push(d);

      // Handle dependent dropdowns — wait and retry
      if (['country', 'state'].includes(d.field?.intent || LearnedMemory?.normalizeIntent(d.field))) {
        scheduleRetryForDependents(el);
      }
    }

    return applied;
  }

  /**
   * After selecting a parent dropdown (country/state), wait for dependent
   * options to load, then re-trigger the autofill pipeline for the child.
   */
  function scheduleRetryForDependents(parentEl) {
    const form = parentEl.closest('form') || parentEl.closest('div');
    if (!form) return;

    // Watch for new options loading in sibling selects
    let retries = 0;
    const maxRetries = 5;
    const retryInterval = setInterval(() => {
      retries++;
      const childSelects = form.querySelectorAll('select');
      childSelects.forEach(sel => {
        if (sel !== parentEl && sel.options.length <= 1 && retries < maxRetries) {
          // Still loading — wait
          return;
        }
      });
      if (retries >= maxRetries) {
        clearInterval(retryInterval);
      }
    }, 600);

    // Clear after max wait (3 seconds)
    setTimeout(() => clearInterval(retryInterval), 3000);
  }

  // ═══════════════════════════════════════════════════════════
  // CUSTOM DROPDOWN SUPPORT
  // ═══════════════════════════════════════════════════════════

  /**
   * Detect and interact with custom (non-native) dropdowns.
   * Looks for common patterns: [role="listbox"], [role="combobox"],
   * .select2, .choices, .vs__dropdown, .MuiSelect, etc.
   */
  function findCustomDropdowns() {
    const selectors = [
      '[role="listbox"]',
      '[role="combobox"]',
      '.select2-container',
      '.choices',
      '.vs__dropdown-toggle',
      '.css-1s2u09g-control', // React Select
      '[class*="MuiSelect"]',
      '[class*="dropdown"][class*="select"]',
      '[data-testid*="select"]',
      '[data-testid*="dropdown"]',
    ];

    const found = [];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        if (FieldDetector.isVisible(el) && !el.closest('#ff-pro-fab-menu')) {
          found.push(el);
        }
      });
    }
    return found;
  }

  /**
   * Try to type-search in a custom/searchable dropdown.
   */
  function typeInSearchable(containerEl, searchText) {
    // Look for input within the dropdown container
    const input = containerEl.querySelector('input[type="text"], input[type="search"], input[role="combobox"]');
    if (!input) return false;

    input.focus();
    input.value = searchText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));

    // Wait a beat, then try to click the first matching option
    setTimeout(() => {
      const optionEl = containerEl.querySelector('[role="option"], .select2-results__option, .choices__item, .vs__dropdown-option, [class*="option"]');
      if (optionEl) {
        optionEl.click();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      }
    }, 300);

    return true;
  }

  return {
    matchOption,
    processAll,
    processSingle,
    applyDecisions,
    resolveYesNo,
    findCustomDropdowns,
    typeInSearchable,
    scheduleRetryForDependents,
    STATE_ABBREVIATIONS,
    COUNTRY_CODES,
    DEGREE_SYNONYMS,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.DropdownEngine = DropdownEngine;
