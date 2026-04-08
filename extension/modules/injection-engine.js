/**
 * InjectionEngine — Robust value injection into form fields
 * 
 * Handles:
 *  - React/Angular/Vue controlled inputs (native setter bypass)
 *  - Proper event dispatch sequence (focus → keydown → input → change → blur)
 *  - Select elements (match by value or text)
 *  - Checkbox/radio buttons
 *  - Contenteditable divs
 *  - Date inputs
 *  - Duplicate fill prevention via data-ff-filled attribute
 *  - Undo capability (stores original values)
 */

var InjectionEngine = InjectionEngine || (() => {

  // Store original values for undo
  const _originalValues = new Map();

  // ─── Native Input Value Setter (React bypass) ────────────────
  // React overrides the value setter, so we need the native one
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  )?.set;
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, 'value'
  )?.set;
  const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype, 'value'
  )?.set;

  // ─── Event Dispatch ──────────────────────────────────────────
  function dispatchEvents(el) {
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ─── Set Value on Input/Textarea ─────────────────────────────
  function setInputValue(el, value) {
    // Store original
    if (!_originalValues.has(el.id)) {
      _originalValues.set(el.id, el.value);
    }

    // Use native setter to bypass React/Angular interceptors
    const setter = el.tagName === 'TEXTAREA' ? nativeTextareaValueSetter : nativeInputValueSetter;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }

    dispatchEvents(el);
    el.setAttribute('data-ff-filled', 'true');
  }

  // ─── Set Value on Select ─────────────────────────────────────
  function setSelectValue(el, value) {
    if (!_originalValues.has(el.id)) {
      _originalValues.set(el.id, el.value);
    }

    const valLower = String(value).toLowerCase().trim();

    // Try exact value match first
    let matched = false;
    for (const opt of el.options) {
      if (opt.value.toLowerCase().trim() === valLower) {
        if (nativeSelectValueSetter) {
          nativeSelectValueSetter.call(el, opt.value);
        } else {
          el.value = opt.value;
        }
        matched = true;
        break;
      }
    }

    // Try text match
    if (!matched) {
      for (const opt of el.options) {
        if (opt.text.toLowerCase().trim() === valLower) {
          if (nativeSelectValueSetter) {
            nativeSelectValueSetter.call(el, opt.value);
          } else {
            el.value = opt.value;
          }
          matched = true;
          break;
        }
      }
    }

    // Try partial/fuzzy text match
    if (!matched) {
      for (const opt of el.options) {
        if (opt.text.toLowerCase().includes(valLower) || valLower.includes(opt.text.toLowerCase())) {
          if (nativeSelectValueSetter) {
            nativeSelectValueSetter.call(el, opt.value);
          } else {
            el.value = opt.value;
          }
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      dispatchEvents(el);
      el.setAttribute('data-ff-filled', 'true');
    }

    return matched;
  }

  // ─── Set Checkbox/Radio ──────────────────────────────────────
  function setCheckboxRadio(el, value) {
    if (!_originalValues.has(el.id)) {
      _originalValues.set(el.id, el.checked);
    }

    const v = String(value).toLowerCase().trim();
    const shouldCheck = v === 'true' || v === 'yes' || v === 'on' || v === '1' || v === el.value.toLowerCase();

    if (el.checked !== shouldCheck) {
      el.checked = shouldCheck;
      dispatchEvents(el);
      el.setAttribute('data-ff-filled', 'true');
    }
  }

  // ─── Set Contenteditable ─────────────────────────────────────
  function setContentEditable(el, value) {
    if (!_originalValues.has(el.id)) {
      _originalValues.set(el.id, el.innerHTML);
    }

    el.innerHTML = value;
    dispatchEvents(el);
    el.setAttribute('data-ff-filled', 'true');
  }

  // ─── Set Date Input ──────────────────────────────────────────
  function setDateInput(el, value) {
    if (!_originalValues.has(el.id)) {
      _originalValues.set(el.id, el.value);
    }

    // Try to parse and format as YYYY-MM-DD
    let formatted = value;
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        formatted = d.toISOString().split('T')[0];
      }
    } catch (_) {}

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, formatted);
    } else {
      el.value = formatted;
    }
    dispatchEvents(el);
    el.setAttribute('data-ff-filled', 'true');
  }

  // ─── Main Inject Function ───────────────────────────────────
  /**
   * Inject a value into a form field.
   * 
   * @param {string} fieldId - The element ID
   * @param {*} value - The value to inject
   * @param {Object} options - { onlyEmpty: boolean }
   * @returns {{ success: boolean, reason: string }}
   */
  function inject(fieldId, value, options = {}) {
    if (value === null || value === undefined) {
      return { success: false, reason: 'No value provided' };
    }

    const el = document.getElementById(fieldId);
    if (!el) {
      return { success: false, reason: 'Element not found' };
    }

    // Skip if already filled and duplicate prevention is on
    if (el.getAttribute('data-ff-filled') === 'true' && !options.force) {
      return { success: false, reason: 'Already filled' };
    }

    // Skip if field has a value and onlyEmpty mode
    if (options.onlyEmpty && el.value && el.value.trim() !== '') {
      return { success: false, reason: 'Field not empty' };
    }

    try {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();

      if (tag === 'select') {
        const matched = setSelectValue(el, value);
        return matched
          ? { success: true, reason: 'Select value set' }
          : { success: false, reason: 'No matching option found' };
      }

      if (type === 'checkbox' || type === 'radio') {
        setCheckboxRadio(el, value);
        return { success: true, reason: 'Checkbox/radio set' };
      }

      if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'week') {
        setDateInput(el, value);
        return { success: true, reason: 'Date value set' };
      }

      if (el.getAttribute('contenteditable') === 'true') {
        setContentEditable(el, value);
        return { success: true, reason: 'Contenteditable set' };
      }

      // Default: input or textarea
      setInputValue(el, String(value));
      return { success: true, reason: 'Value injected' };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }

  /**
   * Inject multiple fields from a mapping results array.
   * 
   * @param {Array} mappings - Array of { field: { id }, value }
   * @param {Object} options - { onlyEmpty: boolean }
   * @returns {{ filled: Array, skipped: Array, failed: Array }}
   */
  function injectAll(mappings, options = {}) {
    const filled = [];
    const skipped = [];
    const failed = [];

    for (const mapping of mappings) {
      const fieldId = mapping.field?.id || mapping.fieldId;
      const fieldLabel = mapping.field?.label || mapping.field?.placeholder || mapping.field?.name || fieldId;
      const hasValue = mapping.value !== null && mapping.value !== undefined && mapping.value !== '';

      if (!hasValue || mapping.status === 'blocked') {
        let reason = mapping.reason || mapping.status || 'no value';
        if (!hasValue && mapping.status === 'matched_no_value') reason = 'No stored value available';
        if (!hasValue && mapping.status === 'unmatched') reason = 'No suggestion found';
        if (!hasValue && mapping.status === 'uncertain') reason = mapping.reason || 'Marked for review';

        skipped.push({
          id: fieldId,
          fieldLabel,
          reason,
          suggestedValue: hasValue ? mapping.value : null,
          status: mapping.status || 'skipped',
        });
        continue;
      }

      const result = inject(fieldId, mapping.value, options);
      if (result.success) {
        filled.push({ id: fieldId, fieldLabel, value: mapping.value });
      } else if (result.reason === 'Field not empty' || result.reason === 'Already filled') {
        skipped.push({
          id: fieldId,
          fieldLabel,
          reason: result.reason,
          suggestedValue: mapping.value,
          status: 'skipped',
        });
      } else {
        failed.push({
          id: fieldId,
          fieldLabel,
          reason: result.reason,
          suggestedValue: mapping.value,
        });
      }
    }

    return { filled, skipped, failed };
  }

  // ─── Clear Autofilled Fields ─────────────────────────────────
  function clearFilled() {
    const filledEls = document.querySelectorAll('[data-ff-filled="true"]');
    let cleared = 0;

    filledEls.forEach(el => {
      const original = _originalValues.get(el.id);
      if (original !== undefined) {
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = original;
        } else if (el.getAttribute('contenteditable') === 'true') {
          el.innerHTML = original;
        } else {
          el.value = original;
        }
        dispatchEvents(el);
      } else {
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = false;
        } else {
          el.value = '';
        }
        dispatchEvents(el);
      }
      el.removeAttribute('data-ff-filled');
      cleared++;
    });

    _originalValues.clear();
    return cleared;
  }

  // ─── Get Fill Count ──────────────────────────────────────────
  function getFilledCount() {
    return document.querySelectorAll('[data-ff-filled="true"]').length;
  }

  return {
    inject,
    injectAll,
    clearFilled,
    getFilledCount,
    dispatchEvents,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.InjectionEngine = InjectionEngine;
