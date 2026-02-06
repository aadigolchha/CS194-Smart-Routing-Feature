import { GEMINI_API_KEY } from "./config";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Helper to call Gemini API
 */
async function callGemini(prompt, useSearch = false) {
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    },
  };

  // Enable Google Search grounding when needed
  if (useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) throw new Error("Empty response from Gemini");

  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

/**
 * Extracts location from user description if no GPS location provided
 */
async function extractLocationFromDescription(description) {
  const prompt = `Analyze this civic issue report and determine the location:
"${description}"

If any location is mentioned or implied (street name, neighborhood, landmark, city, state, etc.), extract it.
If NO location is mentioned at all, respond with "Unknown" for location.

You MUST respond in EXACTLY this JSON format and nothing else:
{"location":"extracted location or Unknown","city":"city name or Unknown","state":"state abbreviation or Unknown","hasExplicitLocation":true or false}`;

  return callGemini(prompt);
}

/**
 * Checks if a domain exists and can receive email using DNS lookup API
 */
async function verifyDomainExists(domain) {
  try {
    // Use Google's DNS-over-HTTPS to check MX records
    const response = await fetch(
      `https://dns.google/resolve?name=${domain}&type=MX`
    );
    const data = await response.json();

    // Status 0 = NOERROR (domain exists), check if there are MX records
    if (data.Status === 0 && data.Answer && data.Answer.length > 0) {
      return { exists: true, hasMX: true };
    }

    // Try checking if the domain at least has an A record (website exists)
    const aResponse = await fetch(
      `https://dns.google/resolve?name=${domain}&type=A`
    );
    const aData = await aResponse.json();

    if (aData.Status === 0 && aData.Answer && aData.Answer.length > 0) {
      return { exists: true, hasMX: false };
    }

    return { exists: false, hasMX: false };
  } catch (error) {
    // If DNS check fails, we can't verify - assume it might be valid
    console.log("DNS check failed:", error);
    return { exists: null, hasMX: null };
  }
}

/**
 * Validates email by checking if the domain actually exists
 * If domain doesn't exist, asks Gemini to provide a corrected email
 */
async function validateAndCorrectRouting({ to, subject, body, locationInfo }) {
  const emailDomain = to.includes('@') ? to.split('@')[1] : 'unknown';

  // Step 1: Check if the domain actually exists via DNS
  const domainCheck = await verifyDomainExists(emailDomain);

  // If domain exists and has MX records, the email is likely valid
  if (domainCheck.exists && domainCheck.hasMX) {
    return {
      isValid: true,
      correctedTo: to,
      correctedSubject: subject,
      correctedBody: body,
      validationNote: `Domain ${emailDomain} verified - has valid MX records`,
    };
  }

  // If domain doesn't exist or has no MX records, ask Gemini to correct it
  const prompt = `The email domain "${emailDomain}" does not exist or cannot receive email.

LOCATION: ${locationInfo}
INVALID EMAIL: ${to}

The domain "${emailDomain}" failed DNS verification - it either doesn't exist or has no mail servers.

Please provide a CORRECTED email address for reporting civic issues to this location's government.
- Use a domain you are CONFIDENT actually exists
- Prefer .gov domains or well-known city domains
- Use a general contact like info@, contact@, or 311@ if unsure of specific department

Respond in JSON format:
{"correctedTo":"corrected email address","reason":"why this domain should be correct"}`;

  // Use Google Search to find real contact info
  const result = await callGemini(prompt, true);

  // Verify the corrected domain also exists
  const correctedDomain = result.correctedTo?.includes('@')
    ? result.correctedTo.split('@')[1]
    : null;

  if (correctedDomain) {
    const correctedCheck = await verifyDomainExists(correctedDomain);
    if (correctedCheck.exists) {
      return {
        isValid: false,
        correctedTo: result.correctedTo,
        correctedSubject: subject,
        correctedBody: body,
        validationNote: `Original domain invalid. Corrected to ${correctedDomain} (verified)`,
      };
    }
  }

  // If even the corrected domain fails, return original with a warning
  return {
    isValid: false,
    correctedTo: to,
    correctedSubject: subject,
    correctedBody: body,
    validationNote: `Warning: Could not verify email domain. Please double-check the address.`,
    unverified: true,
  };
}

/**
 * Calls Gemini to generate the routed email draft.
 * Returns { to, subject, body } or throws on error.
 */
export async function generateEmailDraft({ description, location, hasPhoto }) {
  // Determine location context
  let locationInfo;
  let locationContext;

  if (location) {
    // GPS location provided
    locationInfo = `GPS coordinates: latitude ${location.latitude}, longitude ${location.longitude}`;
    locationContext = `The issue is located at approximately ${locationInfo}.`;
  } else {
    // Try to extract location from description, default to Palo Alto
    const extracted = await extractLocationFromDescription(description);
    if (extracted.hasExplicitLocation && extracted.location !== "Unknown") {
      locationInfo = extracted.location;
      if (extracted.city !== "Unknown") {
        locationInfo = `${extracted.city}, ${extracted.state}`;
      }
      locationContext = `The issue is located in/near: ${locationInfo}`;
    } else {
      locationInfo = "Palo Alto, CA (default)";
      locationContext = `No specific location provided. Assuming Palo Alto, CA as default.`;
    }
  }

  const photoContext = hasPhoto
    ? "The user has attached a photo of the issue."
    : "";

  const prompt = `You are a civic issue routing assistant for the United States. A resident is reporting a local issue and needs help contacting the right government department.

Here is the resident's description of the issue:
"${description}"

${locationContext}
${photoContext}

Your job:
1. Determine the single most appropriate government department or agency email address to contact for this issue based on the location provided.
   - For city-level issues: use the city's official government email (public works, utilities, parks, police, etc.)
   - For county-level issues: use the county government email
   - For state highway issues: use the state's DOT (e.g., Caltrans for CA, TxDOT for TX)
   - Use real, publicly available email addresses. Common patterns: [dept]@cityof[name].org, [dept]@[city].gov, [dept]@[county]county.gov

2. If the location is Palo Alto, CA (or defaults to it), use these verified emails:
   - Public Works: PWE-Work-Request@cityofpaloalto.org
   - Utilities: utilities@cityofpaloalto.org
   - Police: pd@cityofpaloalto.org
   - Code Enforcement: codecompliance@cityofpaloalto.org
   - Parks: parks.division@cityofpaloalto.org
   - General: city.hall@cityofpaloalto.org

3. Write a professional, concise email on behalf of the resident reporting this issue.

You MUST respond in EXACTLY this JSON format and nothing else — no markdown, no backticks, no explanation:
{"to":"email@example.gov","subject":"Brief subject line","body":"The full email body text"}`;

  // Step 1: Generate initial draft (with Google Search to find real contact info)
  const initialDraft = await callGemini(prompt, true);

  // Step 2: Validate and correct the routing (domain check)
  const validation = await validateAndCorrectRouting({
    to: initialDraft.to,
    subject: initialDraft.subject,
    body: initialDraft.body,
    locationInfo: locationInfo,
  });

  // Return corrected version if validation found issues, otherwise return original
  return {
    to: validation.correctedTo || initialDraft.to,
    subject: validation.correctedSubject || initialDraft.subject,
    body: validation.correctedBody || initialDraft.body,
    validationNote: validation.validationNote,
    wasCorrected: !validation.isValid,
  };
}

/**
 * Calls Gemini to revise the email draft based on a user suggestion.
 * Returns { to, subject, body }.
 */
export async function reviseEmailDraft({ currentTo, currentSubject, currentBody, suggestion }) {
  const prompt = `You are a civic issue routing assistant. A resident has already drafted an email to report a local issue, but wants changes.

Current email:
To: ${currentTo}
Subject: ${currentSubject}
Body:
${currentBody}

The resident's requested change:
"${suggestion}"

Apply the requested change to the email. If the change implies a different department should be contacted, update the "to" address accordingly.

You MUST respond in EXACTLY this JSON format and nothing else — no markdown, no backticks, no explanation:
{"to":"email@example.gov","subject":"Brief subject line","body":"The full email body text"}`;

  return callGemini(prompt);
}
