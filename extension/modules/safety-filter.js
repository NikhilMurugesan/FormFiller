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

const SafetyFilter = (() => {

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

  return { check, filterFields, SENSITIVE_PATTERNS };
})();

if (typeof globalThis !== 'undefined') globalThis.SafetyFilter = SafetyFilter;
