/**
 * SafetyFilter — Prevents autofilling sensitive fields
 * 
 * Detects and blocks:
 *  - Passwords, OTPs, PINs
 *  - Credit card numbers, CVV, expiry
 *  - SSN, Aadhaar, PAN, national ID
 *  - CAPTCHA, security questions
 *  - Payment-related fields
 */

var SafetyFilter = SafetyFilter || (() => {

  // ─── Sensitive Field Patterns ────────────────────────────────
  // Each category has patterns checked against name, id, placeholder, label, type, autocomplete
  const SENSITIVE_PATTERNS = {
    password: {
      typeMatch:        ['password'],
      autocompleteMatch:['new-password', 'current-password'],
      namePatterns:     [/passw(or)?d/i, /^pwd$/i, /^pass$/i, /login.*pass/i, /^passwd$/i],
      reason:           'Password field',
    },
    otp: {
      namePatterns:     [/\botp\b/i, /one.?time/i, /verification.?code/i, /verify.?code/i, /auth.?code/i, /mfa/i, /2fa/i, /two.?factor/i, /sms.?code/i, /token/i],
      reason:           'OTP / verification code',
    },
    pin: {
      namePatterns:     [/\bpin\b/i, /^pin_?code$/i, /security.?pin/i, /atm.?pin/i],
      reason:           'PIN field',
    },
    credit_card: {
      autocompleteMatch:['cc-number', 'cc-name', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type'],
      namePatterns:     [/card.?num/i, /credit.?card/i, /debit.?card/i, /card.?no/i, /^cc_?num/i, /payment.?card/i, /account.?number/i],
      reason:           'Credit/debit card number',
    },
    cvv: {
      namePatterns:     [/\bcvv\b/i, /\bcvc\b/i, /\bcvv2\b/i, /security.?code/i, /card.?code/i, /^csc$/i],
      reason:           'CVV / security code',
    },
    ssn: {
      namePatterns:     [/\bssn\b/i, /social.?security/i, /soc.?sec/i, /^ss_?n(?:um)?$/i],
      reason:           'Social Security Number',
    },
    national_id: {
      namePatterns:     [/aadhaar/i, /aadhar/i, /\bpan\b/i, /pan.?card/i, /pan.?number/i, /national.?id/i, /id.?number/i, /passport.?n/i, /\bnric\b/i, /\bnic\b/i, /voter.?id/i, /driving.?lic/i, /dl.?number/i],
      reason:           'National ID / government document',
    },
    captcha: {
      namePatterns:     [/captcha/i, /recaptcha/i, /hcaptcha/i, /^g-recaptcha/i, /verification.?image/i, /human.?verify/i],
      reason:           'CAPTCHA field',
    },
    security_question: {
      namePatterns:     [/security.?q/i, /secret.?q/i, /security.?answer/i, /secret.?answer/i, /challenge.?q/i, /mother.?maiden/i],
      reason:           'Security question / answer',
    },
    payment: {
      namePatterns:     [/routing.?number/i, /iban/i, /swift/i, /bic/i, /bank.?account/i, /^upi/i, /payment.?method/i],
      reason:           'Payment / banking field',
    },
  };

  /**
   * Check if a field should be blocked from autofill.
   * 
   * @param {Object} field - { id, name, placeholder, type, label, ariaLabel, autocomplete }
   * @returns {{ blocked: boolean, category: string|null, reason: string|null }}
   */
  function check(field) {
    // Collect all text signals to check
    const signals = [
      field.name || '',
      field.id || '',
      field.placeholder || '',
      field.label || '',
      field.ariaLabel || '',
    ].join(' ');

    for (const [category, rules] of Object.entries(SENSITIVE_PATTERNS)) {
      // Check type match
      if (rules.typeMatch && rules.typeMatch.includes(field.type)) {
        return { blocked: true, category, reason: rules.reason };
      }

      // Check autocomplete match
      if (rules.autocompleteMatch && field.autocomplete) {
        const ac = field.autocomplete.toLowerCase().trim();
        if (rules.autocompleteMatch.includes(ac)) {
          return { blocked: true, category, reason: rules.reason };
        }
      }

      // Check name patterns against all signals
      if (rules.namePatterns) {
        for (const pattern of rules.namePatterns) {
          if (pattern.test(signals)) {
            return { blocked: true, category, reason: rules.reason };
          }
        }
      }
    }

    return { blocked: false, category: null, reason: null };
  }

  /**
   * Filter an array of fields, returning safe and blocked lists.
   * 
   * @param {Array} fields - Array of field objects
   * @returns {{ safe: Array, blocked: Array<{ field, category, reason }> }}
   */
  function filterFields(fields) {
    const safe = [];
    const blocked = [];

    for (const field of fields) {
      const result = check(field);
      if (result.blocked) {
        blocked.push({ field, category: result.category, reason: result.reason });
      } else {
        safe.push(field);
      }
    }

    return { safe, blocked };
  }

  // ─── Checkbox-Specific Consent Patterns ──────────────────────
  // These don't block the field from being detected, but flag it
  // as a legal/consent checkbox that should never be auto-checked.
  const CONSENT_CHECKBOX_PATTERNS = [
    /terms?\s*(and|&|\+)\s*conditions?/i,
    /terms\s*of\s*(service|use)/i,
    /privacy\s*policy/i,
    /cookie\s*policy/i,
    /\bconsent\b/i,
    /\bi\s*(agree|accept|acknowledge|certify|confirm|attest|declare)/i,
    /background\s*(check|verification|screen)/i,
    /legal\s*(certification|declaration|agreement)/i,
    /authorization\s*to\s*(release|process|share)/i,
    /electronic\s*signature/i,
    /accurate\s*(and|&)\s*(complete|true)/i,
    /under\s*penalty/i,
    /perjury/i,
    /certif(y|ication)\s*(that)?/i,
    /gdpr/i,
    /binding\s*agreement/i,
    /non.?disclosure/i,
    /waiver/i,
    /indemnif/i,
  ];

  /**
   * Check if a checkbox field is a legal/consent checkbox.
   * This does NOT block the field from detection—it only flags it.
   * CheckboxEngine uses this to prevent auto-checking.
   * 
   * @param {Object} field - Field descriptor
   * @returns {{ isConsent: boolean, reason: string|null }}
   */
  function checkConsent(field) {
    const text = [
      field.label || '',
      field.ariaLabel || '',
      field.name || '',
      field.id || '',
      field.placeholder || '',
      field.surroundingText || '',
    ].join(' ');

    for (const pattern of CONSENT_CHECKBOX_PATTERNS) {
      if (pattern.test(text)) {
        return { isConsent: true, reason: 'Legal/consent checkbox' };
      }
    }

    return { isConsent: false, reason: null };
  }

  return { check, filterFields, checkConsent, SENSITIVE_PATTERNS, CONSENT_CHECKBOX_PATTERNS };
})();

if (typeof globalThis !== 'undefined') globalThis.SafetyFilter = SafetyFilter;
