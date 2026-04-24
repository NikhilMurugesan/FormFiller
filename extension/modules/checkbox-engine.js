/**
 * CheckboxEngine — Intelligent checkbox handling for FormFiller Pro
 * 
 * Classifies checkboxes by purpose:
 *  - consent/legal (NEVER auto-check)
 *  - newsletter/subscription
 *  - same-as-above
 *  - work authorization / relocation / job preferences
 *  - skill/category/interest multi-select
 *  - single preference toggles
 * 
 * Uses LearnedMemory for domain-specific checkbox decisions.
 * Returns per-checkbox decisions: { action: 'check'|'skip'|'review'|'blocked', confidence, reason }
 */

var CheckboxEngine = CheckboxEngine || (() => {

  // ─── Legal / Consent Patterns (NEVER auto-check) ────────────
  const LEGAL_PATTERNS = [
    /terms?\s*(and|&|\+)\s*conditions?/i,
    /terms\s*of\s*(service|use)/i,
    /privacy\s*policy/i,
    /cookie\s*policy/i,
    /consent/i,
    /i\s*(have\s+read|agree|accept|acknowledge|certify|confirm|attest|declare)/i,
    /background\s*(check|verification|screen)/i,
    /legal\s*(certification|declaration|agreement)/i,
    /binding\s*agreement/i,
    /gdpr/i,
    /ccpa/i,
    /hipaa/i,
    /data\s*process/i,
    /authorization\s*to\s*(release|process|share)/i,
    /disclaimer/i,
    /waiver/i,
    /liability/i,
    /indemnif/i,
    /non.?disclosure/i,
    /nda/i,
    /affirmation/i,
    /sworn\s*statement/i,
    /legally\s*binding/i,
    /under\s*penalty/i,
    /e.?sign/i,
    /electronic\s*signature/i,
    /accurate\s*(and|&)\s*(complete|true)/i,
    /truthful/i,
    /perjury/i,
    /certif(y|ication)\s*(that)?/i,
  ];

  // ─── Newsletter / Subscription Patterns ─────────────────────
  const NEWSLETTER_PATTERNS = [
    /newsletter/i,
    /subscri(be|ption)/i,
    /mailing\s*list/i,
    /email\s*(me|update|notification|alert)/i,
    /marketing\s*(email|communication|material)/i,
    /promotional/i,
    /opt.?in/i,
    /receive\s*(email|update|info|offer)/i,
    /send\s*me/i,
    /stay\s*(update|inform|connect)/i,
    /join\s*our/i,
    /sign\s*up\s*for/i,
    /keep\s*me\s*(inform|updat|post)/i,
  ];

  // ─── Same-as-above Patterns ─────────────────────────────────
  const SAME_AS_PATTERNS = [
    /same\s*as/i,
    /copy\s*(from|above|billing|shipping)/i,
    /use\s*(above|billing|shipping|my)/i,
    /identical\s*to/i,
    /duplicate/i,
    /same\s*address/i,
  ];

  // ─── Work/Job Preference Patterns ───────────────────────────
  const JOB_PREF_PATTERNS = [
    /work\s*auth/i,
    /authorized?\s*to\s*work/i,
    /right\s*to\s*work/i,
    /reloca/i,
    /willing\s*to\s*(move|relocat|travel)/i,
    /open\s*to\s*(relocat|remote|travel)/i,
    /remote\s*(work|option|position)/i,
    /hybrid/i,
    /on.?site/i,
    /full.?time/i,
    /part.?time/i,
    /overtime/i,
    /night\s*shift/i,
    /weekend/i,
    /travel\s*require/i,
    /sponsor/i,
    /visa/i,
    /h1b|h-1b/i,
    /currently\s*employ/i,
    /have\s*you\s*worked/i,
    /previously\s*applied/i,
    /veteran/i,
    /disability/i,
    /18\s*years/i,
    /legally\s*eligible/i,
  ];

  // ─── Classify a single checkbox ─────────────────────────────
  /**
   * @param {Object} field - Field descriptor from FieldDetector
   * @returns {{ category: string, isLegal: boolean, isNewsletter: boolean, isSameAs: boolean, isJobPref: boolean }}
   */
  function classifyCheckbox(field) {
    const text = gatherCheckboxText(field);

    if (isMatchAny(text, LEGAL_PATTERNS)) {
      return { category: 'legal', isLegal: true, isNewsletter: false, isSameAs: false, isJobPref: false };
    }
    if (isMatchAny(text, SAME_AS_PATTERNS)) {
      return { category: 'same_as_above', isLegal: false, isNewsletter: false, isSameAs: true, isJobPref: false };
    }
    if (isMatchAny(text, NEWSLETTER_PATTERNS)) {
      return { category: 'newsletter', isLegal: false, isNewsletter: true, isSameAs: false, isJobPref: false };
    }
    if (isMatchAny(text, JOB_PREF_PATTERNS)) {
      return { category: 'job_preference', isLegal: false, isNewsletter: false, isSameAs: false, isJobPref: true };
    }

    // Check if part of multi-select checkbox group
    const groupName = field.name || '';
    if (groupName) {
      const sameNameCbs = document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(groupName)}"]`);
      if (sameNameCbs.length > 1) {
        return { category: 'multi_select_group', isLegal: false, isNewsletter: false, isSameAs: false, isJobPref: false };
      }
    }

    return { category: 'preference', isLegal: false, isNewsletter: false, isSameAs: false, isJobPref: false };
  }

  /**
   * Gather all text signals for a checkbox.
   */
  function gatherCheckboxText(field) {
    const parts = [
      field.label || '',
      field.ariaLabel || '',
      field.name || '',
      field.id || '',
      field.placeholder || '',
      field.surroundingText || '',
    ];

    // Also grab container / parent text for context
    const el = document.getElementById(field.id);
    if (el) {
      // Get wrapping label text
      const wrap = el.closest('label, .checkbox, .form-check, .option, .field-item, li, div');
      if (wrap) {
        const clone = wrap.cloneNode(true);
        clone.querySelectorAll('input').forEach(c => c.remove());
        parts.push(clone.textContent?.trim() || '');
      }
    }

    return parts.join(' ');
  }

  function isMatchAny(text, patterns) {
    return patterns.some(p => p.test(text));
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN: Decide what to do with each checkbox
  // ═══════════════════════════════════════════════════════════

  /**
   * Process all checkbox fields and return per-checkbox decisions.
   * 
   * @param {Array} checkboxFields - Field descriptors where type === 'checkbox'
   * @param {Object} profileData - Active profile data
   * @param {string} domain - Current domain
   * @param {Object} settings - Extension settings
   * @returns {Promise<Array<{ field, action, value, confidence, reason, category }>>}
   */
  async function processAll(checkboxFields, profileData, domain, settings = {}) {
    const results = [];

    for (const field of checkboxFields) {
      const result = await processSingle(field, profileData, domain, settings);
      results.push(result);
    }

    return results;
  }

  /**
   * Decide on a single checkbox.
   */
  async function processSingle(field, profileData, domain, settings = {}) {
    const classification = classifyCheckbox(field);
    const el = document.getElementById(field.id);

    // Already checked? Never toggle existing user selections.
    if (el && el.checked && el.getAttribute('data-ff-filled') !== 'true') {
      return {
        field,
        action: 'skip',
        value: true,
        confidence: 0,
        reason: 'Already checked by user',
        category: classification.category,
      };
    }

    // 1) LEGAL / CONSENT → ALWAYS BLOCKED
    if (classification.isLegal) {
      return {
        field,
        action: 'blocked',
        value: null,
        confidence: 0,
        reason: 'Legal/consent checkbox — requires manual action',
        category: 'legal',
      };
    }

    // 2) NEWSLETTER → Skip by default (user preference in settings)
    if (classification.isNewsletter) {
      if (settings.autoCheckNewsletter) {
        return { field, action: 'check', value: true, confidence: 60, reason: 'Newsletter (auto-check enabled)', category: 'newsletter' };
      }
      return { field, action: 'skip', value: null, confidence: 0, reason: 'Newsletter — skipped by default', category: 'newsletter' };
    }

    // 3) SAME-AS-ABOVE → Check if it makes sense
    if (classification.isSameAs) {
      return { field, action: 'review', value: true, confidence: 50, reason: 'Same-as-above — requires context review', category: 'same_as_above' };
    }

    // 4) Look up learned memory
    if (typeof LearnedMemory !== 'undefined') {
      const memory = await LearnedMemory.lookup(domain, field);
      if (memory) {
        // Conflicting past answers → mark for review
        if (memory.hasConflict) {
          return {
            field,
            action: 'review',
            value: memory.value,
            confidence: Math.min(memory.confidence, 50),
            reason: 'Conflicting past answers — needs review',
            category: classification.category,
          };
        }

        const shouldCheck = toBool(memory.value);

        if (memory.confidence >= 75) {
          return {
            field,
            action: shouldCheck ? 'check' : 'uncheck',
            value: shouldCheck,
            confidence: memory.confidence,
            reason: `Learned from ${memory.source} (${memory.usageCount} uses)`,
            category: classification.category,
          };
        }

        if (memory.confidence >= 50) {
          return {
            field,
            action: 'review',
            value: shouldCheck,
            confidence: memory.confidence,
            reason: `Medium confidence from ${memory.source}`,
            category: classification.category,
          };
        }
      }
    }

    // 5) JOB PREFERENCE — look for profile data or skip
    if (classification.isJobPref) {
      const intent = (typeof LearnedMemory !== 'undefined') ? LearnedMemory.normalizeIntent(field) : 'unknown';
      // Check if we have profile-level data for common job prefs
      const jobPrefMap = {
        'work_authorization': profileData.work_authorization,
        'sponsorship':        profileData.sponsorship_required,
        'relocation':         profileData.willing_to_relocate,
      };
      const profileValue = jobPrefMap[intent];
      if (profileValue !== undefined && profileValue !== '') {
        const shouldCheck = toBool(profileValue);
        return {
          field,
          action: shouldCheck ? 'check' : 'uncheck',
          value: shouldCheck,
          confidence: 70,
          reason: 'From profile job preferences',
          category: 'job_preference',
        };
      }
      return { field, action: 'review', value: null, confidence: 30, reason: 'Job preference — no stored answer', category: 'job_preference' };
    }

    // 6) MULTI-SELECT GROUP — match against profile skills/interests
    if (classification.category === 'multi_select_group') {
      const checkText = gatherCheckboxText(field).toLowerCase();
      const skills = (profileData.skills || '').toLowerCase().split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
      
      for (const skill of skills) {
        if (skill.length >= 3 && checkText.includes(skill)) {
          return { field, action: 'check', value: true, confidence: 70, reason: `Matches profile skill: ${skill}`, category: 'multi_select_group' };
        }
      }
      return { field, action: 'skip', value: null, confidence: 20, reason: 'No matching skill/interest found', category: 'multi_select_group' };
    }

    // 7) GENERIC PREFERENCE — low confidence, skip
    return {
      field,
      action: 'skip',
      value: null,
      confidence: 15,
      reason: 'Unknown purpose — skipped for safety',
      category: classification.category,
    };
  }

  /**
   * Apply checkbox decisions (inject checks).
   * Only applies 'check' and 'uncheck' actions.
   * Prevents double-toggle by verifying current state.
   */
  function applyDecisions(decisions) {
    const applied = { selected: [], skipped: [], uncertain: [], blocked: [] };

    for (const d of decisions) {
      if (d.action === 'blocked') {
        applied.blocked.push(d);
        continue;
      }
      if (d.action === 'skip') {
        applied.skipped.push(d);
        continue;
      }
      if (d.action === 'review') {
        applied.uncertain.push(d);
        continue;
      }

      // Action is 'check' or 'uncheck'
      const el = document.getElementById(d.field.id);
      if (!el) {
        applied.skipped.push({ ...d, reason: 'Element not found' });
        continue;
      }

      const targetState = d.action === 'check';

      // Prevent toggle if already in target state
      if (el.checked === targetState) {
        applied.skipped.push({ ...d, reason: `Already ${targetState ? 'checked' : 'unchecked'}` });
        continue;
      }

      // Prevent toggling user-made selections
      if (el.getAttribute('data-ff-filled') !== 'true' && el.checked) {
        applied.skipped.push({ ...d, reason: 'User-checked — not toggling' });
        continue;
      }

      // Apply
      el.checked = targetState;
      InjectionEngine.dispatchEvents(el);
      el.setAttribute('data-ff-filled', 'true');
      applied.selected.push(d);
    }

    return applied;
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase().trim();
    if (/not\s+(authorized|eligible)|no\s+right\s+to\s+work/.test(s)) return false;
    if (/citizen|authorized|eligible|right\s+to\s+work|permanent\s+resident/.test(s)) return true;
    return s === 'true' || s === 'yes' || s === 'on' || s === '1';
  }

  return {
    classifyCheckbox,
    processAll,
    processSingle,
    applyDecisions,
    gatherCheckboxText,
    LEGAL_PATTERNS,
    NEWSLETTER_PATTERNS,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.CheckboxEngine = CheckboxEngine;
