/**
 * MappingEngine — Local-first synonym-based field matching
 * 
 * Maps form field metadata to profile keys using:
 *  1. autocomplete attribute (highest priority)
 *  2. Exact match on name/id
 *  3. Synonym dictionary match
 *  4. Label text match
 *  5. Placeholder match
 *  6. Fuzzy substring match
 *  7. Domain-specific overrides (highest override priority)
 * 
 * Returns confidence scores (0–100) for each match.
 */

var MappingEngine = MappingEngine || (() => {

  // ─── Synonym Dictionary ──────────────────────────────────────
  // Each profile key maps to an array of common field names/ids
  const SYNONYMS = {
    full_name:   ['fullname', 'full_name', 'full-name', 'name', 'applicant_name', 'applicantname', 'your_name', 'yourname', 'candidate_name', 'candidatename', 'your-name', 'full name', 'contact_name', 'contactname', 'customer_name', 'customername', 'billing_name', 'billingname', 'your_full_name', 'name_input'],
    first_name:  ['firstname', 'first_name', 'first-name', 'fname', 'given_name', 'givenname', 'given-name', 'first name', 'f_name', 'forename'],
    last_name:   ['lastname', 'last_name', 'last-name', 'lname', 'surname', 'family_name', 'familyname', 'family-name', 'last name', 'l_name'],
    email:       ['email', 'email_address', 'emailaddress', 'email-address', 'e_mail', 'e-mail', 'mail', 'contact_email', 'contactemail', 'emailid', 'email_id', 'email address', 'user_email', 'useremail', 'your_email', 'youremail', 'work_email', 'workemail'],
    phone:       ['phone', 'mobile', 'telephone', 'contact_number', 'contactnumber', 'phone_number', 'phonenumber', 'phone-number', 'cell', 'mobile_number', 'mobilenumber', 'mobile-number', 'tel', 'contact_phone', 'contactphone', 'cell_phone', 'cellphone', 'phone number', 'mobile number', 'landline', 'primary_phone', 'primaryphone'],
    address:     ['address', 'street', 'street_address', 'streetaddress', 'street-address', 'address_line_1', 'addressline1', 'address1', 'address_1', 'mailing_address', 'mailingaddress', 'home_address', 'homeaddress', 'residential_address'],
    city:        ['city', 'town', 'municipality', 'city_name', 'cityname', 'city-name', 'district', 'city_town', 'home_city', 'homecity'],
    state:       ['state', 'province', 'region', 'state_province', 'stateprovince', 'state-province', 'state/province', 'territory', 'county', 'home_state', 'homestate'],
    zip:         ['zip', 'zipcode', 'zip_code', 'zip-code', 'postal_code', 'postalcode', 'postal-code', 'pincode', 'pin_code', 'pin-code', 'postcode', 'post_code', 'postal', 'zip code', 'postal code'],
    country:     ['country', 'nation', 'country_name', 'countryname', 'country-name', 'country_code', 'countrycode', 'country-code', 'nationality', 'home_country', 'homecountry'],
    current_company: ['company', 'organization', 'organisation', 'employer', 'current_company', 'currentcompany', 'current-company', 'company_name', 'companyname', 'company-name', 'org', 'org_name', 'orgname', 'firm', 'workplace', 'current_employer', 'currentemployer'],
    current_title:   ['title', 'job_title', 'jobtitle', 'job-title', 'position', 'current_title', 'currenttitle', 'current-title', 'role', 'designation', 'current_position', 'currentposition', 'current_role', 'currentrole', 'occupation', 'job title'],
    linkedin:    ['linkedin', 'linkedin_url', 'linkedinurl', 'linkedin-url', 'linkedin_profile', 'linkedinprofile', 'li_url', 'liurl'],
    portfolio:   ['portfolio', 'portfolio_url', 'portfoliourl', 'portfolio-url', 'personal_website', 'personalwebsite'],
    website:     ['website', 'website_url', 'websiteurl', 'website-url', 'url', 'homepage', 'home_page', 'web_url', 'weburl', 'personal_url', 'personalurl'],
    github:      ['github', 'github_url', 'githuburl', 'github-url', 'github_profile', 'githubprofile', 'git_url', 'giturl'],
    highest_degree:  ['degree', 'highest_degree', 'highestdegree', 'highest-degree', 'education_level', 'educationlevel', 'qualification', 'academic_degree', 'academicdegree'],
    school:      ['school', 'university', 'institution', 'college', 'alma_mater', 'almamater', 'school_name', 'schoolname', 'university_name', 'universityname', 'institute', 'education_institution'],
    major:       ['major', 'field_of_study', 'fieldofstudy', 'field-of-study', 'specialization', 'specialisation', 'discipline', 'course', 'program', 'programme', 'area_of_study', 'concentration', 'subject'],
    graduation_year: ['graduation_year', 'graduationyear', 'graduation-year', 'grad_year', 'gradyear', 'year_of_graduation', 'passing_year', 'passingyear', 'completion_year', 'batch_year'],
    years_of_experience: ['experience', 'years_of_experience', 'yearsofexperience', 'years-of-experience', 'yoe', 'total_experience', 'totalexperience', 'work_experience', 'workexperience', 'exp_years', 'expyears', 'num_years', 'years experience', 'total_years'],
    skills:      ['skills', 'key_skills', 'keyskills', 'key-skills', 'technical_skills', 'technicalskills', 'technical-skills', 'expertise', 'competencies', 'skillset', 'skill_set', 'abilities', 'proficiencies', 'core_skills', 'coreskills'],
    summary:     ['summary', 'about', 'bio', 'about_me', 'aboutme', 'about-me', 'professional_summary', 'professionalsummary', 'introduction', 'cover_letter', 'coverletter', 'cover-letter', 'profile_summary', 'profilesummary', 'description', 'self_description', 'objective', 'career_objective', 'careerobjectve', 'motivation', 'motivation_reason', 'why_join'],
    gender:      ['gender', 'sex', 'gender_identity', 'genderidentity'],
    dob:         ['dob', 'date_of_birth', 'dateofbirth', 'date-of-birth', 'birthday', 'birth_date', 'birthdate', 'birth-date', 'born_on', 'bornon'],
  };

  // ─── Autocomplete Attribute Mapping ──────────────────────────
  // Maps HTML autocomplete values to profile keys
  const AUTOCOMPLETE_MAP = {
    'name':              'full_name',
    'given-name':        'first_name',
    'family-name':       'last_name',
    'email':             'email',
    'tel':               'phone',
    'tel-national':      'phone',
    'street-address':    'address',
    'address-line1':     'address',
    'address-level2':    'city',
    'address-level1':    'state',
    'postal-code':       'zip',
    'country':           'country',
    'country-name':      'country',
    'organization':      'current_company',
    'organization-title':'current_title',
    'url':               'website',
    'bday':              'dob',
    'sex':               'gender',
  };

  // ─── Normalization ───────────────────────────────────────────
  function normalize(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  }

  function normalizeKeepSeparators(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9_\- ]/g, '').trim();
  }

  // ─── Levenshtein Distance ───────────────────────────────────
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  function similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - (levenshtein(a, b) / maxLen);
  }

  // ─── Match a Single Signal Against Synonym Dictionary ────────
  function matchSignal(signal, source) {
    if (!signal) return null;
    const norm = normalize(signal);
    const normSep = normalizeKeepSeparators(signal);
    if (!norm) return null;

    // Phase 1: Exact match
    for (const [profileKey, synonyms] of Object.entries(SYNONYMS)) {
      for (const syn of synonyms) {
        const synNorm = normalize(syn);
        if (norm === synNorm) {
          return { profileKey, confidence: source === 'name' || source === 'id' ? 90 : 80, matchSource: source, matchedSynonym: syn };
        }
      }
    }

    // Phase 2: Substring match (signal contains synonym or vice versa)
    for (const [profileKey, synonyms] of Object.entries(SYNONYMS)) {
      for (const syn of synonyms) {
        const synNorm = normalize(syn);
        if (synNorm.length >= 3 && (norm.includes(synNorm) || synNorm.includes(norm))) {
          const conf = source === 'name' || source === 'id' ? 75 : 65;
          return { profileKey, confidence: conf, matchSource: source + ' (substring)', matchedSynonym: syn };
        }
      }
    }

    // Phase 3: Fuzzy match via Levenshtein
    let bestMatch = null;
    let bestScore = 0;

    for (const [profileKey, synonyms] of Object.entries(SYNONYMS)) {
      for (const syn of synonyms) {
        const synNorm = normalize(syn);
        const score = similarity(norm, synNorm);
        if (score > 0.75 && score > bestScore) {
          bestScore = score;
          bestMatch = { profileKey, confidence: Math.round(score * 65), matchSource: source + ' (fuzzy)', matchedSynonym: syn };
        }
      }
    }

    return bestMatch;
  }

  // ─── Main Matching Function ──────────────────────────────────
  /**
   * Match a single field to the best profile key.
   * 
   * @param {Object} field - { id, name, placeholder, type, label, ariaLabel, autocomplete, surroundingText }
   * @param {Object} domainOverrides - { fieldSelector: profileKey } from domain intelligence
   * @returns {{ profileKey: string, confidence: number, matchSource: string, matchedSynonym: string } | null}
   */
  function matchField(field, domainOverrides = {}) {
    // Priority 0: Domain-specific override (absolute highest priority)
    const domainKey = domainOverrides[field.id] || domainOverrides[field.name];
    if (domainKey) {
      return { profileKey: domainKey, confidence: 98, matchSource: 'domain override', matchedSynonym: field.id || field.name };
    }

    // Priority 1: autocomplete attribute
    if (field.autocomplete) {
      const acNorm = field.autocomplete.toLowerCase().trim();
      const mapped = AUTOCOMPLETE_MAP[acNorm];
      if (mapped) {
        return { profileKey: mapped, confidence: 95, matchSource: 'autocomplete', matchedSynonym: acNorm };
      }
    }

    // Priority 2–6: Match each signal in priority order
    const signals = [
      { value: field.name, source: 'name' },
      { value: field.id, source: 'id' },
      { value: field.label, source: 'label' },
      { value: field.ariaLabel, source: 'aria-label' },
      { value: field.placeholder, source: 'placeholder' },
      { value: field.surroundingText, source: 'surrounding text' },
    ];

    let bestMatch = null;

    for (const { value, source } of signals) {
      const match = matchSignal(value, source);
      if (match && (!bestMatch || match.confidence > bestMatch.confidence)) {
        bestMatch = match;
      }
    }

    return bestMatch;
  }

  /**
   * Match all fields from a scan result.
   * 
   * @param {Array} fields - Array of field objects from FieldDetector
   * @param {Object} profileData - The active profile's data object
   * @param {Object} domainOverrides - Domain-specific field→profileKey overrides
   * @returns {Array} Array of { field, match, value } objects
   */
  function matchAllFields(fields, profileData, domainOverrides = {}) {
    const results = [];

    for (const field of fields) {
      const match = matchField(field, domainOverrides);

      if (match && profileData[match.profileKey] !== undefined && profileData[match.profileKey] !== '') {
        results.push({
          field,
          match,
          value: profileData[match.profileKey],
          status: 'matched',
        });
      } else if (match) {
        results.push({
          field,
          match,
          value: null,
          status: 'matched_no_value',  // matched but profile doesn't have the value
        });
      } else {
        results.push({
          field,
          match: null,
          value: null,
          status: 'unmatched',
        });
      }
    }

    // Sort by confidence (highest first)
    results.sort((a, b) => {
      const confA = a.match?.confidence || 0;
      const confB = b.match?.confidence || 0;
      return confB - confA;
    });

    return results;
  }

  /**
   * Get a list of all available profile keys with human-readable labels.
   * Used for manual mapping dropdowns.
   */
  function getProfileKeyLabels() {
    return Object.keys(SYNONYMS).map(key => ({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    }));
  }

  // ─── Expose ──────────────────────────────────────────────────
  return {
    SYNONYMS,
    AUTOCOMPLETE_MAP,
    matchField,
    matchAllFields,
    getProfileKeyLabels,
    normalize,
    similarity,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.MappingEngine = MappingEngine;
