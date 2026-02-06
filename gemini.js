import { GEMINI_API_KEY } from "./config.js";

// Use current model and API version
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Retry configuration
 */
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

/**
 * Sleep with jitter for exponential backoff
 */
function sleep(ms) {
  const jitter = Math.random() * 0.3 * ms;
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

/**
 * Call Gemini API with retry logic and Google Search grounding
 */
async function callGemini(prompt, useSearch = true, retryCount = 0) {
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  };

  // Enable Google Search grounding
  if (useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    // Handle retryable errors
    if (response.status === 429 || response.status === 503 || response.status === 504) {
      if (retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
        console.log(`Rate limited (${response.status}). Retrying in ${delay}ms...`);
        await sleep(delay);
        return callGemini(prompt, useSearch, retryCount + 1);
      }
      throw new Error(`API error ${response.status} after ${MAX_RETRIES} retries`);
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const raw = candidate?.content?.parts?.[0]?.text;

    // Check if response was truncated
    if (candidate?.finishReason === "MAX_TOKENS") {
      console.log("Response truncated, retrying with shorter prompt...");
      if (retryCount < MAX_RETRIES) {
        return callGemini(prompt, useSearch, retryCount + 1);
      }
    }

    if (!raw) {
      // Check for safety block or other issues
      const blockReason = candidate?.finishReason || data.promptFeedback?.blockReason;
      throw new Error(`Empty response from Gemini${blockReason ? `: ${blockReason}` : ""}`);
    }

    // Clean up markdown code blocks and extra whitespace
    let cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

    // Try to extract JSON if there's extra text around it
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      return JSON.parse(cleaned);
    } catch (parseError) {
      // Re-prompt for valid JSON if parsing fails (allow more retries)
      if (retryCount < 3) {
        console.log(`JSON parse failed (attempt ${retryCount + 1}), re-prompting...`);
        const fixPrompt = `Return ONLY valid JSON with no markdown, no explanation, no extra text. Just the raw JSON object.

${prompt}`;
        return callGemini(fixPrompt, useSearch, retryCount + 1);
      }
      console.error("Failed to parse:", cleaned.substring(0, 200));
      throw new Error(`Failed to parse JSON response: ${parseError.message}`);
    }
  } catch (error) {
    if (retryCount < MAX_RETRIES && error.message.includes("fetch")) {
      const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
      await sleep(delay);
      return callGemini(prompt, useSearch, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Basic email format validation
 */
function isValidEmailFormat(email) {
  if (!email || typeof email !== "string") return false;
  // Basic check: must have @ and at least one . after @
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * DNS MX record check - sanity filter only
 */
async function checkDomainMX(domain) {
  try {
    const response = await fetch(
      `https://dns.google/resolve?name=${domain}&type=MX`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await response.json();
    return data.Status === 0 && data.Answer && data.Answer.length > 0;
  } catch {
    // DNS timeout/error = cannot verify, not a hard failure
    return null;
  }
}

/**
 * Extract location from user description
 */
async function extractLocation(description) {
  const prompt = `Analyze this civic issue report and extract location information.

REPORT: "${description}"

Extract the location if mentioned. If no location is specified, return "Unknown".

Return ONLY this JSON format:
{"city":"city name or Unknown","state":"state abbreviation or Unknown","hasLocation":true or false}`;

  return callGemini(prompt, false);
}

/**
 * PASS A: Find topic-specific email candidates
 */
async function findTopicSpecificEmail(jurisdiction, topic) {
  const prompt = `You are finding the email address where citizens can SUBMIT REPORTS about "${topic}" issues in ${jurisdiction}.

SEARCH TASK:
Use Google Search to find the specific email for REPORTING/SUBMITTING ${topic} complaints in ${jurisdiction}.

Search queries to try:
- "${jurisdiction} report ${topic} email"
- "${jurisdiction} ${topic} complaint email"
- "${jurisdiction} submit ${topic} request"
- "report ${topic} ${jurisdiction}"

WHAT YOU'RE LOOKING FOR:
- Email addresses specifically for SUBMITTING service requests or complaints
- Emails on "Report a Problem" or "Submit a Request" pages
- Department emails that accept citizen reports (e.g., publicworks@city.gov, streets@city.gov)

AVOID these types of emails:
- General inquiry or "info@" addresses
- Help desk or customer support for website issues
- Permit or licensing emails
- Media or press contact emails

STRICT RULES:
- Do NOT guess or invent email addresses
- Only return an email if you find it on an official .gov or city website
- The email MUST appear verbatim in your quoted_snippet
- If you cannot find a report-submission email, set found to false

Return ONLY this JSON:
{
  "found": true or false,
  "email": "exact email found or empty string",
  "agency_name": "department/agency name",
  "evidence": {
    "source_title": "page title where email was found",
    "source_url": "URL of the source",
    "quoted_snippet": "exact text snippet containing the email address"
  },
  "confidence": 0.0 to 1.0
}`;

  return callGemini(prompt, true);
}

/**
 * PASS B: Find agency-level email candidates
 */
async function findAgencyEmail(jurisdiction, topic) {
  const prompt = `You are finding the department email where citizens can SUBMIT REPORTS for "${topic}" issues in ${jurisdiction}.

Based on the issue type "${topic}", determine which department handles this:
- Potholes, roads, sidewalks, streetlights → Public Works, Transportation, Streets Department
- Water leaks, sewers, flooding → Water/Utilities Department, Public Works
- Safety, noise, abandoned vehicles → Police (non-emergency), Code Enforcement
- Property violations → Code Enforcement, Building Department
- Parks, trees, public spaces → Parks Department, Urban Forestry
- Trash, illegal dumping → Sanitation, Public Works, Environmental Services

SEARCH TASK:
Use Google Search to find the email for REPORTING ISSUES to this department in ${jurisdiction}.

Search queries to try:
- "${jurisdiction} public works email report"
- "${jurisdiction} [relevant department] service request"
- "${jurisdiction} [relevant department] report problem"

WHAT YOU'RE LOOKING FOR:
- Department emails that accept citizen reports/complaints
- Emails listed on "Contact Us" pages for submitting issues
- Service request or complaint submission emails

AVOID these types of emails:
- General city info@ addresses
- Help desk for website/login issues
- Permit, licensing, or administrative emails
- Individual employee emails

STRICT RULES:
- Do NOT guess or invent email addresses
- Only return an email from an official .gov or city website
- The email MUST appear verbatim in your quoted_snippet
- If you cannot find a department email for reports, set found to false

Return ONLY this JSON:
{
  "found": true or false,
  "email": "exact email found or empty string",
  "agency_name": "department name",
  "evidence": {
    "source_title": "page title where email was found",
    "source_url": "URL of the source",
    "quoted_snippet": "exact text snippet containing the email address"
  },
  "confidence": 0.0 to 1.0
}`;

  return callGemini(prompt, true);
}

/**
 * PASS C: Find jurisdiction-general email candidates
 */
async function findGeneralEmail(jurisdiction) {
  const prompt = `You are finding a general email where citizens can REPORT ISSUES to ${jurisdiction} government.

Previous department-specific searches failed. Now find a general city/county email for submitting citizen reports.

SEARCH TASK:
Use Google Search with these queries:
- "${jurisdiction} report problem email"
- "${jurisdiction} citizen services email"
- "${jurisdiction} city manager email"
- "${jurisdiction} public works email"
- "${jurisdiction} city clerk email"

WHAT YOU'RE LOOKING FOR:
- City manager or city clerk email (they route citizen complaints)
- General citizen services email
- Public works or city services email
- Any official email that accepts citizen reports

AVOID these types of emails:
- Website help desk emails
- IT support emails
- Tourism or visitor information emails

STRICT RULES:
- Do NOT guess or invent email addresses
- Only return an email from an official .gov or city website
- The email MUST appear verbatim in your quoted_snippet
- If you cannot find any email, set found to false

Return ONLY this JSON:
{
  "found": true or false,
  "email": "exact email found or empty string",
  "agency_name": "office/department name",
  "evidence": {
    "source_title": "page title where email was found",
    "source_url": "URL of the source",
    "quoted_snippet": "exact text snippet containing the email address"
  },
  "confidence": 0.0 to 1.0
}`;

  return callGemini(prompt, true);
}

/**
 * Determine issue topic from description
 */
async function extractTopic(description) {
  const prompt = `Categorize this civic issue into a single topic word or short phrase.

ISSUE: "${description}"

Common topics: pothole, streetlight, sidewalk, graffiti, trash, noise, parking, water leak, power outage, tree, traffic signal, crosswalk, flooding, sewer, abandoned vehicle, etc.

Return ONLY this JSON:
{"topic": "single topic word or short phrase"}`;

  const result = await callGemini(prompt, false);
  return result.topic || "general issue";
}

/**
 * Validate that the department/email makes sense for the issue type
 */
function isDepartmentRelevant(topic, agencyName, email) {
  if (!agencyName && !email) return false;

  const combined = `${agencyName || ""} ${email || ""}`.toLowerCase();
  const topicLower = topic.toLowerCase();

  // Reject obviously wrong departments
  const wrongDepartments = [
    { keywords: ["eeo", "equal employment", "human resources", "hr@"], for: "any" },
    { keywords: ["media", "press", "communications", "pr@"], for: "any" },
    { keywords: ["tourism", "visitor", "convention"], for: "any" },
    { keywords: ["permit", "licensing", "license"], for: "any" },
    { keywords: ["graffiti"], for: ["pothole", "streetlight", "sidewalk", "trash", "noise", "flooding", "sewer", "water"] },
    { keywords: ["environment", "sustainability"], for: ["pothole", "streetlight", "sidewalk", "graffiti"] },
  ];

  for (const rule of wrongDepartments) {
    const hasWrongKeyword = rule.keywords.some(kw => combined.includes(kw));
    if (hasWrongKeyword) {
      if (rule.for === "any") return false;
      if (rule.for.some(t => topicLower.includes(t))) return false;
    }
  }

  return true;
}

/**
 * Main function: Generate email draft with evidence-based routing
 */
export async function generateEmailDraft({ description, location, hasPhoto }) {
  // Step 1: Determine location
  let jurisdiction;
  if (location && typeof location.latitude === "number" && typeof location.longitude === "number") {
    // Reverse geocode GPS coordinates
    const geoPrompt = `What city and state are at these coordinates?
Latitude: ${location.latitude.toFixed(4)}, Longitude: ${location.longitude.toFixed(4)}

Respond with ONLY this JSON (no other text):
{"city":"city name","state":"XX"}`;
    try {
      const geo = await callGemini(geoPrompt, false); // No search needed for geocoding
      if (geo && geo.city && geo.state) {
        jurisdiction = `${geo.city}, ${geo.state}`;
      } else {
        console.log("Geocoding returned incomplete data, using default");
        jurisdiction = "Palo Alto, CA"; // Fallback if geocoding fails
      }
    } catch (geoError) {
      console.log("Geocoding failed, using default:", geoError.message);
      jurisdiction = "Palo Alto, CA";
    }
  } else if (location) {
    // Location object exists but is malformed
    console.log("Invalid location object:", location);
    jurisdiction = "Palo Alto, CA";
  } else {
    const extracted = await extractLocation(description);
    if (extracted.hasLocation && extracted.city !== "Unknown") {
      jurisdiction = `${extracted.city}, ${extracted.state}`;
    } else {
      jurisdiction = "Palo Alto, CA"; // Default
    }
  }

  // Step 2: Extract topic from description
  const topic = await extractTopic(description);

  // Step 3: Multi-pass email search
  let emailResult = null;
  let fallbackLevel = "TOPIC_SPECIFIC";

  // PASS A: Topic-specific
  const passA = await findTopicSpecificEmail(jurisdiction, topic);
  if (
    passA.found &&
    isValidEmailFormat(passA.email) &&
    passA.evidence?.quoted_snippet?.includes(passA.email) &&
    isDepartmentRelevant(topic, passA.agency_name, passA.email)
  ) {
    emailResult = passA;
    fallbackLevel = "TOPIC_SPECIFIC";
  }

  // PASS B: Agency-level (if PASS A failed)
  if (!emailResult) {
    const passB = await findAgencyEmail(jurisdiction, topic);
    if (
      passB.found &&
      isValidEmailFormat(passB.email) &&
      passB.evidence?.quoted_snippet?.includes(passB.email) &&
      isDepartmentRelevant(topic, passB.agency_name, passB.email)
    ) {
      emailResult = passB;
      fallbackLevel = "AGENCY_MAIN";
    }
  }

  // PASS C: Jurisdiction-general (if PASS B failed)
  if (!emailResult) {
    const passC = await findGeneralEmail(jurisdiction);
    if (
      passC.found &&
      isValidEmailFormat(passC.email) &&
      passC.evidence?.quoted_snippet?.includes(passC.email) &&
      isDepartmentRelevant(topic, passC.agency_name, passC.email)
    ) {
      emailResult = passC;
      fallbackLevel = "JURISDICTION_GENERAL";
    }
  }

  // ABSOLUTE LAST RESORT: Unverified guess
  if (!emailResult) {
    const guessPrompt = `You must provide an email for ${jurisdiction} government to report: "${topic}".

All grounded searches failed. As a last resort, provide your best guess for an official government email.

Return ONLY this JSON:
{
  "email": "your best guess email",
  "agency_name": "likely department",
  "confidence": 0.1
}`;
    const guess = await callGemini(guessPrompt, false);
    emailResult = {
      found: false,
      email: guess.email,
      agency_name: guess.agency_name,
      evidence: null,
      confidence: 0.1,
    };
    fallbackLevel = "UNVERIFIED_GUESS";
  }

  // Step 4: DNS sanity check (non-blocking)
  const emailDomain = emailResult.email?.split("@")[1];
  let dnsValid = null;
  if (emailDomain) {
    dnsValid = await checkDomainMX(emailDomain);
  }

  // Step 5: Generate email body
  const bodyPrompt = `Write a professional, concise email body for reporting this civic issue.

ISSUE: "${description}"
LOCATION: ${jurisdiction}
TO: ${emailResult.agency_name || "City Services"}
${hasPhoto ? "Note: Photo attached." : ""}

Write 2-3 short paragraphs. Be factual and polite. Do not include subject line.

Return ONLY this JSON:
{"subject": "brief subject line", "body": "the email body text"}`;

  const emailContent = await callGemini(bodyPrompt, false);

  // Return complete result
  return {
    to: emailResult.email,
    subject: emailContent.subject,
    body: emailContent.body,
    jurisdiction,
    agency_name: emailResult.agency_name,
    topic,
    confidence: emailResult.confidence || 0.5,
    fallback_level: fallbackLevel,
    evidence: emailResult.evidence || null,
    dns_verified: dnsValid,
  };
}

/**
 * Revise email draft based on user suggestion
 */
export async function reviseEmailDraft({ currentTo, currentSubject, currentBody, suggestion }) {
  const prompt = `Revise this email based on the user's request.

CURRENT EMAIL:
To: ${currentTo}
Subject: ${currentSubject}
Body: ${currentBody}

USER REQUEST: "${suggestion}"

Apply the requested changes. If the user mentions a different location or department, use Google Search to find the correct email for that location/department.

STRICT RULES:
- If changing the email address, only use emails you can find evidence for
- Keep the same email if the request is just about content changes

Return ONLY this JSON:
{"to": "email address", "subject": "subject line", "body": "email body"}`;

  return callGemini(prompt, true);
}
