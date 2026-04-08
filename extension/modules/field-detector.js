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

const FieldDetector = (() => {

  let _idCounter = 0;

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

  // ─── Surrounding Text ────────────────────────────────────────
  function getSurroundingText(el) {
    const texts = [];

    // Check heading above the field
    const container = el.closest('div, fieldset, section, li, td');
    if (container) {
      const heading = container.querySelector('h1, h2, h3, h4, h5, h6, legend, .heading');
      if (heading) texts.push(heading.innerText.trim());

      // Check for description/help text
      const helpText = container.querySelector('.help-text, .description, .hint, small, .form-text');
      if (helpText) texts.push(helpText.innerText.trim());
    }

    return texts.join(' ').substring(0, 150) || null;
  }

  // ─── Select Options Extraction ───────────────────────────────
  function getSelectOptions(el) {
    if (el.tagName.toLowerCase() !== 'select') return null;
    return Array.from(el.options).map(opt => ({
      value: opt.value,
      text: opt.text.trim(),
    }));
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

      const fieldInfo = {
        id:              el.id,
        name:            el.name || null,
        type:            el.type || el.tagName.toLowerCase(),
        placeholder:     el.placeholder || null,
        label:           label,
        ariaLabel:       el.getAttribute('aria-label') || null,
        autocomplete:    el.getAttribute('autocomplete') || null,
        surroundingText: getSurroundingText(el),
        value:           el.value || '',
        tagName:         el.tagName.toLowerCase(),
        required:        el.required || false,
        readOnly:        el.readOnly || false,
        options:         getSelectOptions(el),
        formId:          el.form ? (el.form.id || el.form.name || null) : null,
        dataAttributes:  extractDataAttributes(el),
      };

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
