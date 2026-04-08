/**
 * AIAssist — Optional backend API wrapper for complex field mapping
 * 
 * Only called when:
 *  - User explicitly clicks "AI Assist" button
 *  - Or auto-AI is enabled AND confidence < threshold
 * 
 * Wraps the existing Vercel/FastAPI backend at /analyze-fields
 * Graceful fallback if backend is offline.
 */

const AIAssist = (() => {

  const DEFAULT_API_URL = 'https://form-filler-pi.vercel.app';
  const SESSION_ID = 'formfiller_session';

  /**
   * Call the backend API to analyze fields using Gemini LLM.
   * 
   * @param {Array} fields - Array of { id, name, placeholder, type, label } objects
   * @param {Object} profileData - The user's profile data object
   * @param {string} apiUrl - Override API URL (from settings)
   * @returns {{ mappings: Array, latency_sec: number, cost_usd: number, error: string|null }}
   */
  async function analyzeFields(fields, profileData, apiUrl) {
    const baseUrl = apiUrl || DEFAULT_API_URL;
    const url = `${baseUrl}/analyze-fields`;

    // Compact field format — strip nulls to save tokens
    const compactFields = fields.map(f => {
      const cf = {};
      if (f.id) cf.id = f.id;
      if (f.name) cf.name = f.name;
      if (f.placeholder) cf.placeholder = f.placeholder;
      if (f.type) cf.type = f.type;
      if (f.label) cf.label = f.label;
      return cf;
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: compactFields,
          session_id: SESSION_ID,
          user_data: profileData,
        }),
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const enrichedMappings = (data.mappings || []).map(m => ({
        ...m,
        confidence: m.confidence || 0,
        reason: m.reason || '',
        source: m.source || 'ai',
      }));

      return {
        mappings: enrichedMappings,
        latency_sec: data.latency_sec || 0,
        cost_usd: data.cost_usd || 0,
        error: null,
      };
    } catch (err) {
      console.error('[AIAssist] API call failed:', err.message);
      return {
        mappings: [],
        latency_sec: 0,
        cost_usd: 0,
        error: err.message,
      };
    }
  }

  /**
   * Check if the backend is reachable.
   * @returns {boolean}
   */
  async function isAvailable(apiUrl) {
    const baseUrl = apiUrl || DEFAULT_API_URL;
    try {
      const res = await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Upload a document to the backend for RAG.
   * Preserves the original upload-document endpoint.
   */
  async function uploadDocument(file, apiUrl) {
    const baseUrl = apiUrl || DEFAULT_API_URL;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('session_id', SESSION_ID);

    const res = await fetch(`${baseUrl}/upload-document`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Upload failed');
    }

    return await res.json();
  }

  /**
   * Check document status on the backend.
   */
  async function getDocumentStatus(apiUrl) {
    const baseUrl = apiUrl || DEFAULT_API_URL;
    try {
      const res = await fetch(
        `${baseUrl}/document-status?session_id=${SESSION_ID}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (!res.ok) throw new Error(`Server ${res.status}`);
      return await res.json();
    } catch (err) {
      return { cached: false, error: err.message };
    }
  }

  /**
   * Clear backend storage.
   */
  async function clearBackendStorage(apiUrl) {
    const baseUrl = apiUrl || DEFAULT_API_URL;
    try {
      await fetch(`${baseUrl}/clear-storage?session_id=${SESSION_ID}`, {
        method: 'DELETE',
      });
    } catch (_) {}
  }

  return {
    analyzeFields,
    isAvailable,
    uploadDocument,
    getDocumentStatus,
    clearBackendStorage,
    DEFAULT_API_URL,
    SESSION_ID,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.AIAssist = AIAssist;
