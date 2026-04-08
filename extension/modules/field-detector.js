/**
 * FieldDetector — Enhanced DOM scanner for form fields
 * 
 * Scans for all visible, interactive form elements and extracts
 * comprehensive metadata for accurate field mapping.
 * 
 * Supports:
 *  - input, textarea, select, [contenteditable]
 *  - Visibility/disability checks
 *  - aria-label, autocomplete, data attributes
 *  - Label association (for, wrapping, sibling, aria-labelledby)
 *  - Surrounding text extraction
 *  - Multi-form grouping
 *  - Delayed rescan for dynamic forms (React, Angular, Vue)
 */

var FieldDetector = FieldDetector || (() => {

  let _idCounter = 0;
  const TEXT_LIMIT = 180;

  // ─── Visibility Check ────────────────────────────────────────
  function isVisible(el) {
    if (!el) return false;

    // Hidden input types we always skip
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'image') {
      return false;
    }

    // Disabled or readonly
    if (el.disabled) return false;

    // CSS visibility
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    // offsetParent null check (skip for fixed/sticky or checkbox/radio which can have null offsetParent)
    if (el.offsetParent === null && el.type !== 'checkbox' && el.type !== 'radio') {
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') {
        return false;
      }
    }

    // Check dimensions — zero-size elements are hidden
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && el.type !== 'checkbox' && el.type !== 'radio') {
      return false;
    }

    return true;
  }

  // ─── Label Detection ─────────────────────────────────────────
  function findLabel(el) {
    // Method 1: element.labels (native association via 'for' attribute)
    if (el.labels && el.labels.length > 0) {
      return el.labels[0].innerText.trim();
    }

    // Method 2: aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // Method 3: aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText.trim();
    }

    // Method 4: Wrapping label
    const parent = el.closest('label');
    if (parent) {
      // Get text content excluding child inputs
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
      const text = clone.innerText.trim();
      if (text) return text;
    }

    // Method 5: Previous sibling label
    let prev = el.previousElementSibling;
    if (prev && prev.tagName.toLowerCase() === 'label') {
      return prev.innerText.trim();
    }

    // Method 6: Parent's previous sibling or parent's first child label
    const formGroup = el.closest('.form-group, .form-field, .field, .form-row, .input-group, .field-group, [class*="form"], [class*="field"]');
    if (formGroup) {
      const label = formGroup.querySelector('label, .label, .field-label');
      if (label && label.innerText.trim()) {
        return label.innerText.trim();
      }
    }

    // Method 7: Title attribute
    if (el.title) return el.title.trim();

    return null;
  }

  function cleanText(value, maxLen = TEXT_LIMIT) {
    if (!value || typeof value !== 'string') return null;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
  }

  function uniqueTexts(values, maxItems = 4, maxLen = TEXT_LIMIT) {
    const seen = new Set();
    const results = [];
    for (const value of values) {
      const text = cleanText(value, maxLen);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(text);
      if (results.length >= maxItems) break;
    }
    return results;
  }

  function buildStableSelector(el) {
    if (el.id) return `#${el.id}`;

    const parts = [el.tagName.toLowerCase()];
    if (el.name) parts.push(`[name="${el.name}"]`);
    if (el.type) parts.push(`[type="${el.type}"]`);

    if (!el.name && el.parentElement) {
      const siblings = Array.from(el.parentElement.children).filter(child => child.tagName === el.tagName);
      const index = siblings.indexOf(el);
      if (index >= 0) {
        parts.push(`:nth-of-type(${index + 1})`);
      }
    }

    return parts.join('');
  }

  function getPageTypeHint() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/apply') || path.includes('/jobs') || path.includes('/careers')) return 'job_application';
    if (path.includes('/checkout') || path.includes('/payment')) return 'checkout';
    if (path.includes('/signup') || path.includes('/register')) return 'signup';
    if (path.includes('/login') || path.includes('/signin')) return 'login';
    return null;
  }

  function getFormContext(el) {
    const form = el.form || el.closest('form');
    const forms = Array.from(document.querySelectorAll('form'));
    const formIndex = form ? forms.indexOf(form) : -1;
    return {
      formId: form ? (form.id || null) : null,
      formName: form ? cleanText(form.getAttribute('name') || null, 80) : null,
      formAction: form ? cleanText(form.getAttribute('action') || null, 240) : null,
      formMethod: form ? cleanText(form.getAttribute('method') || null, 40) : null,
      formIndex: formIndex >= 0 ? formIndex : null,
    };
  }

  function getSectionContext(el) {
    const container = el.closest('fieldset, section, article, [role="group"], [role="radiogroup"], .form-group, .form-field, .field, .question, .form-row, li, td, div');
    if (!container) {
      return {
        sectionHeading: null,
        parentSectionText: null,
        nearbyText: null,
      };
    }

    const heading = container.querySelector('legend, h1, h2, h3, h4, h5, h6, .heading, .section-title, .question-title, [role="heading"]');
    const helpText = container.querySelector('.help-text, .description, .hint, small, .form-text, .helper-text');
    const parentSectionText = cleanText(container.innerText || '', 320);

    return {
      sectionHeading: cleanText(heading?.innerText || null),
      parentSectionText,
      nearbyText: uniqueTexts([
        heading?.innerText,
        helpText?.innerText,
        container.getAttribute('aria-label'),
        container.getAttribute('data-section'),
      ], 3).join(' ') || null,
    };
  }

  // ─── Surrounding Text ────────────────────────────────────────
  function getSurroundingText(el) {
    return getSectionContext(el).nearbyText;
  }

  // ─── Select Options Extraction ───────────────────────────────
  function getSelectOptions(el) {
    if (el.tagName.toLowerCase() !== 'select') return null;
    return Array.from(el.options).map(opt => ({
      value: opt.value,
      text: cleanText(opt.text || '') || '',
      disabled: !!opt.disabled,
      selected: !!opt.selected,
    }));
  }

  function getRadioOptions(el) {
    if (el.type !== 'radio' || !el.name) return null;
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
      .filter(radio => radio.name === el.name && isVisible(radio));

    return radios.map(radio => ({
      value: radio.value || radio.id || '',
      text: cleanText(findLabel(radio) || radio.value || radio.id || '') || '',
      checked: !!radio.checked,
    }));
  }

  function getCheckboxOptions(el) {
    if (el.type !== 'checkbox') return null;
    return [{
      value: el.value || 'true',
      text: cleanText(findLabel(el) || el.value || el.name || el.id || 'checkbox') || 'checkbox',
      checked: !!el.checked,
    }];
  }

  function getCandidateOptions(el) {
    return getSelectOptions(el) || getRadioOptions(el) || getCheckboxOptions(el);
  }

  function getCurrentValue(el) {
    if (el.type === 'checkbox') return !!el.checked;
    if (el.type === 'radio') return el.checked ? (el.value || true) : null;
    if (el.tagName.toLowerCase() === 'select') {
      const selected = el.options[el.selectedIndex];
      return selected ? (selected.value || selected.text || '') : '';
    }
    return cleanText(el.value || '', 240) || '';
  }

  // ─── Main Scan Function ──────────────────────────────────────
  /**
   * Scan the page for all visible form fields.
   * 
   * @param {Set} excludeIds - Set of field IDs to skip (already filled)
   * @returns {Array} Array of field descriptor objects
   */
  function scan(excludeIds = new Set()) {
    const elements = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
    const fields = [];
    _idCounter = 0;

    elements.forEach(el => {
      // Skip invisible/disabled
      if (!isVisible(el)) return;

      // Assign ID if missing
      if (!el.id) {
        el.id = `ff_field_${_idCounter++}`;
      }

      // Skip already processed
      if (excludeIds.has(el.id)) return;

      const label = findLabel(el);
      const section = getSectionContext(el);
      const formContext = getFormContext(el);
      const options = getCandidateOptions(el);

      const fieldInfo = {
        id:              el.id,
        name:            el.name || null,
        type:            el.type || el.tagName.toLowerCase(),
        placeholder:     cleanText(el.placeholder || null),
        label:           cleanText(label),
        ariaLabel:       cleanText(el.getAttribute('aria-label') || null),
        autocomplete:    el.getAttribute('autocomplete') || null,
        surroundingText: getSurroundingText(el),
        nearbyText:      section.nearbyText,
        sectionHeading:  section.sectionHeading,
        parentSectionText: section.parentSectionText,
        value:           getCurrentValue(el),
        currentValue:    getCurrentValue(el),
        tagName:         el.tagName.toLowerCase(),
        inputTag:        el.tagName.toLowerCase(),
        required:        el.required || false,
        readOnly:        el.readOnly || false,
        visible:         true,
        disabled:        !!el.disabled,
        options,
        candidateOptions: options,
        cssSelector:     buildStableSelector(el),
        pageTypeHint:    getPageTypeHint(),
        dataAttributes:  extractDataAttributes(el),
        ...formContext,
      };

      if (typeof LearnedMemory !== 'undefined' && typeof LearnedMemory.normalizeIntent === 'function') {
        fieldInfo.normalizedIntent = LearnedMemory.normalizeIntent(fieldInfo);
      } else {
        fieldInfo.normalizedIntent = 'unknown';
      }

      fields.push(fieldInfo);
    });

    return fields;
  }

  // ─── Data Attributes ─────────────────────────────────────────
  function extractDataAttributes(el) {
    const data = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && !attr.name.startsWith('data-ff-')) {
        data[attr.name] = attr.value;
      }
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  // ─── Delayed Scan (for Dynamic Forms) ────────────────────────
  /**
   * Retry scanning up to maxRetries times with increasing delays.
   * Useful for React/Angular/Vue forms that render after initial page load.
   * 
   * @param {Set} excludeIds 
   * @param {number} maxRetries 
   * @param {number} baseDelay - Initial delay in ms
   * @returns {Promise<Array>}
   */
  async function scanWithRetry(excludeIds = new Set(), maxRetries = 3, baseDelay = 500) {
    let fields = scan(excludeIds);

    let attempt = 0;
    while (fields.length === 0 && attempt < maxRetries) {
      attempt++;
      const delay = baseDelay * attempt;
      console.log(`[FieldDetector] No fields found, retry ${attempt}/${maxRetries} in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      fields = scan(excludeIds);
    }

    return fields;
  }

  // ─── MutationObserver for SPA Changes ────────────────────────
  let _observer = null;
  let _onChangeCallback = null;

  function watchForChanges(callback) {
    _onChangeCallback = callback;

    if (_observer) _observer.disconnect();

    let debounceTimer = null;

    _observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (_onChangeCallback) _onChangeCallback();
      }, 800);  // debounce: wait 800ms after last DOM change
    });

    _observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  function stopWatching() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
    _onChangeCallback = null;
  }

  // ─── Count Forms on Page ──────────────────────────────────────
  function countForms() {
    return document.querySelectorAll('form').length;
  }

  // ─── Expose ──────────────────────────────────────────────────
  return {
    scan,
    scanWithRetry,
    watchForChanges,
    stopWatching,
    countForms,
    isVisible,
    findLabel,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.FieldDetector = FieldDetector;
