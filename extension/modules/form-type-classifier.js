/**
 * FormTypeClassifier — Detects the purpose/type of a form
 * 
 * Categories:
 *  - login: password + email/username, ≤ 4 fields
 *  - signup: password + confirm_password + email + name
 *  - job_application: resume, experience, skills, cover_letter, linkedin
 *  - contact: name + email + message, ≤ 6 fields
 *  - checkout: card, billing, shipping, payment fields
 *  - survey: multiple radio/checkbox groups, ratings
 *  - general: anything else
 * 
 * Each type triggers different autofill behavior.
 */

const FormTypeClassifier = (() => {

  // ─── Field Indicator Patterns ────────────────────────────────
  const INDICATORS = {
    password:        /passw(or)?d|^pwd$/i,
    confirm_password:/confirm.?pass|re.?enter.?pass|repeat.?pass/i,
    username:        /username|user.?name|user.?id|login.?id/i,
    email:           /email|e.?mail/i,
    name:            /name|full.?name|first.?name|last.?name/i,
    message:         /message|comment|inquiry|feedback|description|question|body|^msg$/i,
    subject:         /subject|topic|regarding/i,
    resume:          /resume|cv|curriculum|upload.?resume|attach.?resume|cover.?letter/i,
    experience:      /experience|years?.?of?.?exp|yoe|work.?experience/i,
    skills:          /skills|competenc|expertise|technical|proficien/i,
    linkedin:        /linkedin|li.?url/i,
    portfolio:       /portfolio|website|github|personal.?url/i,
    salary:          /salary|compensation|expected.?ctc|current.?ctc/i,
    card_number:     /card.?num|credit.?card|debit.?card|^cc/i,
    cvv:             /cvv|cvc|security.?code|card.?code/i,
    billing:         /billing|shipping|delivery|payment/i,
    card_expiry:     /expir|exp.?(month|year|date)/i,
    rating:          /rating|stars?|score|satisfaction/i,
    agree:           /agree|terms|consent|accept|gdpr|privacy/i,
  };

  /**
   * Classify a form based on its fields.
   * 
   * @param {Array} fields - Array of field descriptor objects from FieldDetector
   * @returns {{ type: string, confidence: number, label: string, icon: string, fillStrategy: Object }}
   */
  function classify(fields) {
    if (!fields || fields.length === 0) {
      return makeResult('general', 50);
    }

    // Collect all text signals from every field
    const signals = fields.map(f =>
      [f.name, f.id, f.placeholder, f.label, f.ariaLabel, f.surroundingText].filter(Boolean).join(' ')
    );
    const allText = signals.join(' ');

    // Count indicator matches
    const counts = {};
    for (const [key, pattern] of Object.entries(INDICATORS)) {
      counts[key] = 0;
      for (const sig of signals) {
        if (pattern.test(sig)) counts[key]++;
      }
    }

    // Also check field types
    const typeCount = {};
    for (const f of fields) {
      typeCount[f.type] = (typeCount[f.type] || 0) + 1;
    }

    const total = fields.length;

    // ─── Login Detection ─────────────────────────────────────
    if (counts.password >= 1 && counts.confirm_password === 0 && total <= 4) {
      if (counts.email >= 1 || counts.username >= 1) {
        return makeResult('login', 90);
      }
    }

    // ─── Signup Detection ────────────────────────────────────
    if (counts.password >= 1 && (counts.confirm_password >= 1 || counts.password >= 2)) {
      if (counts.email >= 1 || counts.name >= 1) {
        return makeResult('signup', 85);
      }
    }

    // ─── Checkout / Payment ──────────────────────────────────
    if (counts.card_number >= 1 || counts.cvv >= 1 || counts.card_expiry >= 1) {
      return makeResult('checkout', 90);
    }
    if (counts.billing >= 2) {
      return makeResult('checkout', 70);
    }

    // ─── Job Application ─────────────────────────────────────
    const jobScore = counts.resume + counts.experience + counts.skills + counts.linkedin + counts.portfolio + counts.salary;
    if (jobScore >= 2) {
      return makeResult('job_application', Math.min(95, 65 + jobScore * 10));
    }

    // ─── Contact Form ────────────────────────────────────────
    if (counts.message >= 1 && counts.email >= 1 && total <= 7) {
      return makeResult('contact', 80);
    }
    if (counts.subject >= 1 && counts.message >= 1) {
      return makeResult('contact', 75);
    }

    // ─── Survey ──────────────────────────────────────────────
    const radioCheckboxCount = (typeCount['radio'] || 0) + (typeCount['checkbox'] || 0);
    if (radioCheckboxCount >= 5 && radioCheckboxCount > total * 0.5) {
      return makeResult('survey', 70);
    }
    if (counts.rating >= 2) {
      return makeResult('survey', 75);
    }

    // ─── General ─────────────────────────────────────────────
    return makeResult('general', 50);
  }

  // ─── Result Builder ──────────────────────────────────────────
  const TYPE_META = {
    login:           { label: 'Login Form',       icon: '🔐', fillStrategy: { fillPasswords: false, fillMinimal: true } },
    signup:          { label: 'Signup Form',       icon: '📝', fillStrategy: { fillPasswords: false, fillMinimal: false } },
    job_application: { label: 'Job Application',  icon: '💼', fillStrategy: { fillPasswords: false, fillMinimal: false, prioritizeProfessional: true } },
    contact:         { label: 'Contact Form',     icon: '📬', fillStrategy: { fillPasswords: false, fillMinimal: true } },
    checkout:        { label: 'Checkout Form',    icon: '💳', fillStrategy: { fillPasswords: false, skipPayment: true, fillAddress: true } },
    survey:          { label: 'Survey / Quiz',    icon: '📊', fillStrategy: { fillPasswords: false, fillMinimal: true, cautious: true } },
    general:         { label: 'General Form',     icon: '📋', fillStrategy: { fillPasswords: false, fillMinimal: false } },
  };

  function makeResult(type, confidence) {
    const meta = TYPE_META[type];
    return {
      type,
      confidence,
      label: meta.label,
      icon:  meta.icon,
      fillStrategy: meta.fillStrategy,
    };
  }

  return { classify, TYPE_META };
})();

if (typeof globalThis !== 'undefined') globalThis.FormTypeClassifier = FormTypeClassifier;
