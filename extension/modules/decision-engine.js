/**
 * DecisionEngine — Central orchestrator for checkbox/dropdown autofill decisions
 * 
 * For every checkbox and dropdown, evaluates:
 *  1. What is the field intent?
 *  2. Do I have an exact learned mapping for this domain?
 *  3. Do I have a domain-level similar mapping?
 *  4. Do I have a global learned preference?
 *  5. Do I have a profile fallback?
 *  6. Is it safe to autofill?
 *  7. Should I autofill, preview, or skip?
 * 
 * Decision rules:
 *  - HIGH confidence (≥70) + safe → autofill
 *  - MEDIUM confidence (50-69) → preview/review
 *  - LOW confidence (<50) or risky → skip
 *  - LEGAL/consent checkboxes → always blocked
 */

var DecisionEngine = DecisionEngine || (() => {

  const CONFIDENCE_THRESHOLDS = {
    HIGH:   70,  // Auto-apply
    MEDIUM: 50,  // Mark for review
    LOW:    0,   // Skip
  };

  /**
   * Process all fields through the decision engine.
   * Separates checkboxes and dropdowns, processes them through
   * their specialized engines, then merges results.
   * 
   * @param {Array} fields - All detected fields (from FieldDetector)
   * @param {Object} profileData - Active profile data
   * @param {string} domain - Current page domain
   * @param {Object} settings - Extension settings
   * @returns {Promise<Object>} Combined decision results
   */
  async function processFields(fields, profileData, domain, settings = {}) {
    // Separate field types
    const checkboxFields = fields.filter(f => f.type === 'checkbox');
    const selectFields = fields.filter(f => f.tagName === 'select' || f.type === 'select-one' || f.type === 'select-multiple');
    const radioFields = fields.filter(f => f.type === 'radio');
    const otherFields = fields.filter(f => f.type !== 'checkbox' && f.type !== 'radio' && f.tagName !== 'select' && f.type !== 'select-one' && f.type !== 'select-multiple');

    // Process each type through its engine
    const checkboxResults = (typeof CheckboxEngine !== 'undefined' && checkboxFields.length > 0)
      ? await CheckboxEngine.processAll(checkboxFields, profileData, domain, settings)
      : [];

    const dropdownResults = (typeof DropdownEngine !== 'undefined' && selectFields.length > 0)
      ? await DropdownEngine.processAll(selectFields, profileData, domain)
      : [];

    // Radio buttons — treat like dropdown groups
    const radioResults = await processRadioGroups(radioFields, profileData, domain);

    return {
      checkboxes: checkboxResults,
      dropdowns:  dropdownResults,
      radios:     radioResults,
      otherFields, // pass-through for MappingEngine
      summary:    buildSummary(checkboxResults, dropdownResults, radioResults),
    };
  }

  /**
   * Process radio button groups.
   * Groups by name, then treats each group like a dropdown.
   */
  async function processRadioGroups(radioFields, profileData, domain) {
    if (radioFields.length === 0) return [];

    // Group by name
    const groups = {};
    for (const field of radioFields) {
      const groupKey = field.name || field.id;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(field);
    }

    const results = [];

    for (const [groupName, groupFields] of Object.entries(groups)) {
      // Build pseudo-options from radio values
      const options = groupFields.map(f => ({
        value: f.value || f.id,
        text: f.label || f.value || f.id,
      }));

      // Use the first field as the "representative" for intent detection
      const repField = { ...groupFields[0], options };

      // Check learned memory
      let memory = null;
      if (typeof LearnedMemory !== 'undefined') {
        memory = await LearnedMemory.lookup(domain, repField);
      }

      if (memory && !memory.hasConflict && memory.confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
        // Find matching radio
        const matchField = groupFields.find(f => {
          const fVal = (f.value || f.label || '').toLowerCase();
          const memVal = String(memory.value).toLowerCase();
          return fVal === memVal || (f.label || '').toLowerCase() === memVal;
        });

        if (matchField) {
          results.push({
            field: matchField,
            groupName,
            action: 'select',
            value: matchField.value,
            confidence: memory.confidence,
            reason: `Learned from ${memory.source}`,
          });
          continue;
        }
      }

      // Try profile data via DropdownEngine matching
      if (typeof DropdownEngine !== 'undefined') {
        const ddResult = await DropdownEngine.processSingle(repField, profileData, domain);
        if (ddResult.action === 'select') {
          const matchField = groupFields.find(f => f.value === ddResult.optionValue || (f.label || '').toLowerCase() === (ddResult.optionText || '').toLowerCase());
          if (matchField) {
            results.push({
              field: matchField,
              groupName,
              action: 'select',
              value: matchField.value,
              confidence: ddResult.confidence,
              reason: ddResult.reason,
            });
            continue;
          }
        }
      }

      // No match — skip
      results.push({
        field: groupFields[0],
        groupName,
        action: 'skip',
        value: null,
        confidence: 0,
        reason: 'No matching radio option',
      });
    }

    return results;
  }

  /**
   * Apply all decisions to the DOM.
   * Calls the specialized engines' apply methods.
   */
  function applyAll(decisions) {
    const result = {
      checkboxes: { selected: [], skipped: [], uncertain: [], blocked: [] },
      dropdowns:  { selected: [], skipped: [], uncertain: [] },
      radios:     { selected: [], skipped: [] },
      totalApplied: 0,
      totalSkipped: 0,
      totalReview: 0,
      totalBlocked: 0,
    };

    // Apply checkbox decisions
    if (typeof CheckboxEngine !== 'undefined' && decisions.checkboxes.length > 0) {
      result.checkboxes = CheckboxEngine.applyDecisions(decisions.checkboxes);
    }

    // Apply dropdown decisions
    if (typeof DropdownEngine !== 'undefined' && decisions.dropdowns.length > 0) {
      result.dropdowns = DropdownEngine.applyDecisions(decisions.dropdowns);
    }

    // Apply radio decisions
    for (const rd of decisions.radios) {
      if (rd.action === 'select') {
        const el = document.getElementById(rd.field.id);
        if (el && !el.checked) {
          el.checked = true;
          InjectionEngine.dispatchEvents(el);
          el.setAttribute('data-ff-filled', 'true');
          result.radios.selected.push(rd);
        } else {
          result.radios.skipped.push(rd);
        }
      } else {
        result.radios.skipped.push(rd);
      }
    }

    // Tally
    result.totalApplied = result.checkboxes.selected.length + result.dropdowns.selected.length + result.radios.selected.length;
    result.totalSkipped = result.checkboxes.skipped.length + result.dropdowns.skipped.length + result.radios.skipped.length;
    result.totalReview  = result.checkboxes.uncertain.length + result.dropdowns.uncertain.length;
    result.totalBlocked = result.checkboxes.blocked.length;

    return result;
  }

  /**
   * Record all successful fills into LearnedMemory.
   * Called after autofill completes—records decisions so future
   * visits on the same domain are smarter.
   */
  async function recordSuccessfulFills(appliedResults, domain, pageType) {
    if (typeof LearnedMemory === 'undefined') return;

    const now = new Date().toISOString();

    // Record checkbox selections
    for (const d of (appliedResults.checkboxes?.selected || [])) {
      await LearnedMemory.record({
        domain,
        pageType,
        field: d.field,
        value: d.value,
        valueSource: 'learned',
        confidence: d.confidence,
      });
    }

    // Record dropdown selections
    for (const d of (appliedResults.dropdowns?.selected || [])) {
      await LearnedMemory.record({
        domain,
        pageType,
        field: d.field,
        value: d.optionText || d.optionValue,
        valueSource: 'learned',
        confidence: d.confidence,
      });
    }

    // Record radio selections
    for (const d of (appliedResults.radios?.selected || [])) {
      await LearnedMemory.record({
        domain,
        pageType,
        field: d.field,
        value: d.value,
        valueSource: 'learned',
        confidence: d.confidence,
      });
    }
  }

  /**
   * Build summary statistics for the decision results.
   */
  function buildSummary(checkboxResults, dropdownResults, radioResults) {
    const cb = { check: 0, skip: 0, review: 0, blocked: 0 };
    const dd = { select: 0, skip: 0, review: 0 };
    const rd = { select: 0, skip: 0 };

    for (const r of checkboxResults) {
      if (r.action === 'check' || r.action === 'uncheck') cb.check++;
      else if (r.action === 'blocked') cb.blocked++;
      else if (r.action === 'review') cb.review++;
      else cb.skip++;
    }

    for (const r of dropdownResults) {
      if (r.action === 'select') dd.select++;
      else if (r.action === 'review') dd.review++;
      else dd.skip++;
    }

    for (const r of radioResults) {
      if (r.action === 'select') rd.select++;
      else rd.skip++;
    }

    return {
      checkboxes: cb,
      dropdowns: dd,
      radios: rd,
      total: {
        willFill:  cb.check + dd.select + rd.select,
        willSkip:  cb.skip + dd.skip + rd.skip,
        forReview: cb.review + dd.review,
        blocked:   cb.blocked,
      },
    };
  }

  return {
    CONFIDENCE_THRESHOLDS,
    processFields,
    applyAll,
    recordSuccessfulFills,
    buildSummary,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.DecisionEngine = DecisionEngine;
