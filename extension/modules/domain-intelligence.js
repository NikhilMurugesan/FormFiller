/**
 * DomainIntelligence — Per-domain learning and custom field mappings
 * 
 * Stores and retrieves domain-specific field→profileKey mappings.
 * Learns from user corrections so future visits auto-apply.
 * Tracks fill history per domain for debugging.
 * 
 * Uses StorageManager under the hood for persistence.
 */

const DomainIntelligence = (() => {

  /**
   * Extract the hostname from the current page or a URL.
   * @param {string} url - optional URL; defaults to current page
   * @returns {string} hostname like "careers.google.com"
   */
  function getDomain(url) {
    try {
      return new URL(url || window.location.href).hostname;
    } catch (_) {
      return 'unknown';
    }
  }

  /**
   * Get saved field mappings for the current domain.
   * Returns an object like { "fieldIdOrName": "profileKey", ... }
   */
  async function getMappings(domain) {
    domain = domain || getDomain();
    if (typeof StorageManager !== 'undefined') {
      return await StorageManager.getDomainMappings(domain);
    }
    return {};
  }

  /**
   * Save a manual field→profileKey mapping for a domain.
   * Called when the user manually corrects a field mapping.
   */
  async function learnMapping(fieldIdentifier, profileKey, domain) {
    domain = domain || getDomain();
    if (typeof StorageManager !== 'undefined') {
      await StorageManager.saveDomainMapping(domain, fieldIdentifier, profileKey);
    }
    console.log(`[DomainIntelligence] Learned: ${domain} → ${fieldIdentifier} = ${profileKey}`);
  }

  /**
   * Remove a specific saved mapping for a domain.
   */
  async function forgetMapping(fieldIdentifier, domain) {
    domain = domain || getDomain();
    if (typeof StorageManager !== 'undefined') {
      await StorageManager.deleteDomainMapping(domain, fieldIdentifier);
    }
  }

  /**
   * Clear all saved mappings for a domain.
   */
  async function clearDomain(domain) {
    domain = domain || getDomain();
    if (typeof StorageManager !== 'undefined') {
      await StorageManager.clearDomainMappings(domain);
    }
  }

  /**
   * Get all domain mappings for the settings viewer.
   */
  async function getAllMappings() {
    if (typeof StorageManager !== 'undefined') {
      return await StorageManager.getAllDomainMappings();
    }
    return {};
  }

  /**
   * Apply domain overrides to a mapping result set.
   * This modifies the results in-place, boosting confidence for domain-learned fields.
   * 
   * @param {Array} mappingResults - From MappingEngine.matchAllFields()
   * @param {Object} domainOverrides - { fieldId: profileKey }
   * @param {Object} profileData - The active profile data
   * @returns {Array} Modified mapping results
   */
  function applyOverrides(mappingResults, domainOverrides, profileData) {
    if (!domainOverrides || Object.keys(domainOverrides).length === 0) {
      return mappingResults;
    }

    for (const result of mappingResults) {
      const field = result.field;
      const overrideKey = domainOverrides[field.id] || domainOverrides[field.name];

      if (overrideKey && profileData[overrideKey] !== undefined) {
        result.match = {
          profileKey: overrideKey,
          confidence: 98,
          matchSource: 'domain learned',
          matchedSynonym: field.id || field.name,
        };
        result.value = profileData[overrideKey];
        result.status = 'matched';
      }
    }

    return mappingResults;
  }

  return {
    getDomain,
    getMappings,
    learnMapping,
    forgetMapping,
    clearDomain,
    getAllMappings,
    applyOverrides,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.DomainIntelligence = DomainIntelligence;
