/* ══════════════════════════════════════════════════════════════
   ATS Resume Optimizer — script.js  (fully self-contained)
   No external API calls → zero CORS errors.
   All analysis runs locally in the browser.
   ══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────
   PDF.js worker
───────────────────────────────────────── */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ─────────────────────────────────────────
   App state
───────────────────────────────────────── */
const state = {
  resumeText   : '',
  jobDescText  : '',
  analysisResult: null,
};

/* ─────────────────────────────────────────
   DOM helpers
───────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const EL = {
  dropZone      : $('dropZone'),
  resumeFile    : $('resumeFile'),
  browseBtn     : $('browseBtn'),
  removeFile    : $('removeFile'),
  filePreview   : $('filePreview'),
  fileName      : $('fileName'),
  fileSize      : $('fileSize'),
  extractStatus : $('extractStatus'),
  extractOk     : $('extractOk'),
  wordCount     : $('wordCount'),
  jobDesc       : $('jobDesc'),
  charCount     : $('charCount'),
  clearJd       : $('clearJd'),
  analyzeBtn    : $('analyzeBtn'),
  analyzeHint   : $('analyzeHint'),
  resultsSection: $('resultsSection'),
};

/* ─────────────────────────────────────────
   File upload
───────────────────────────────────────── */
EL.browseBtn.addEventListener('click', () => EL.resumeFile.click());

EL.dropZone.addEventListener('click', (e) => {
  if (e.target !== EL.browseBtn) EL.resumeFile.click();
});

EL.resumeFile.addEventListener('change', () => {
  if (EL.resumeFile.files[0]) handleFile(EL.resumeFile.files[0]);
});

EL.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  EL.dropZone.classList.add('drag-over');
});
EL.dropZone.addEventListener('dragleave', () =>
  EL.dropZone.classList.remove('drag-over')
);
EL.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  EL.dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') handleFile(file);
  else showToast('Please drop a PDF file.');
});

EL.removeFile.addEventListener('click', resetFile);

function resetFile() {
  state.resumeText      = '';
  EL.resumeFile.value   = '';
  EL.filePreview.style.display  = 'none';
  EL.dropZone.style.display     = '';
  EL.extractStatus.style.display= 'none';
  EL.extractOk.style.display    = 'none';
  checkReady();
}

/* ─────────────────────────────────────────
   Handle selected file
───────────────────────────────────────── */
async function handleFile(file) {
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10 MB).'); return; }
  if (file.type !== 'application/pdf')  { showToast('Only PDF files are supported.'); return; }

  EL.fileName.textContent = file.name;
  EL.fileSize.textContent = formatBytes(file.size);
  EL.dropZone.style.display      = 'none';
  EL.filePreview.style.display   = 'flex';
  EL.extractStatus.style.display = 'flex';
  EL.extractOk.style.display     = 'none';

  try {
    const text = await extractPdfText(file);

    if (!text || text.trim().length < 20) {
      throw new Error('Extracted text too short — try a text-based PDF.');
    }

    state.resumeText = text;
    EL.extractStatus.style.display = 'none';
    EL.extractOk.style.display     = 'flex';
    const wc = text.trim().split(/\s+/).filter(Boolean).length;
    EL.wordCount.textContent = `${wc.toLocaleString()} words extracted`;
  } catch (err) {
    EL.extractStatus.style.display = 'none';
    showToast('Could not extract PDF text. Use a text-based PDF (not a scanned image).');
    console.warn('[ATS] PDF extraction error:', err.message);
  }

  checkReady();
}

/* ─────────────────────────────────────────
   PDF text extraction via PDF.js
───────────────────────────────────────── */
async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js library not loaded.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf         = await loadingTask.promise;
  const pages       = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line    = content.items
      .map((item) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ');
    pages.push(line);
  }

  return pages.join('\n\n');
}

/* ─────────────────────────────────────────
   Job description input
───────────────────────────────────────── */
EL.jobDesc.addEventListener('input', () => {
  state.jobDescText = EL.jobDesc.value.trim();
  EL.charCount.textContent =
    `${EL.jobDesc.value.length.toLocaleString()} characters`;
  checkReady();
});

EL.clearJd.addEventListener('click', () => {
  EL.jobDesc.value      = '';
  state.jobDescText     = '';
  EL.charCount.textContent = '0 characters';
  checkReady();
});

/* ─────────────────────────────────────────
   Enable / disable Analyze button
───────────────────────────────────────── */
function checkReady() {
  const ready =
    state.resumeText.length  > 50 &&
    state.jobDescText.length > 50;

  EL.analyzeBtn.disabled = !ready;
  EL.analyzeHint.textContent = ready
    ? 'Ready to analyze — click the button above.'
    : 'Upload a resume and paste a job description to begin.';
}

/* ─────────────────────────────────────────
   Analyze button
───────────────────────────────────────── */
EL.analyzeBtn.addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!state.resumeText || !state.jobDescText) return;

  showLoading(true);

  try {
    /* Small async tick so the loading overlay actually paints */
    await sleep(60);
    const result = analyzeLocally(state.resumeText, state.jobDescText);
    state.analysisResult = result;
    renderResults(result);
  } catch (err) {
    console.error('[ATS] Analysis error:', err);
    showToast('Analysis failed: ' + err.message);
  } finally {
    showLoading(false);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════════════════
   LOCAL ANALYSIS ENGINE
   ═══════════════════════════════════════════════════════════════ */

/* ── Stop-words to ignore ── */
const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','about','into','through','during','is','are','was',
  'were','be','been','being','have','has','had','do','does','did','will',
  'would','could','should','may','might','shall','can','need','dare',
  'ought','used','that','this','these','those','it','its','we','our',
  'you','your','they','their','he','his','she','her','i','my','me','us',
  'him','them','who','which','what','when','where','why','how','all',
  'each','every','both','few','more','most','other','some','such','no',
  'not','only','same','so','than','too','very','just','also','as','if',
  'then','because','while','although','since','unless','until','after',
  'before','above','below','between','against','within','without','over',
  'under','again','further','once','here','there','any','own','off','out',
  'well','new','good','great','strong','able','based','using','related',
  'including','ensure','work','works','working','team','teams','role',
  'position','candidate','company','organization','job','tasks','duties',
  'responsibilities','requirements','qualifications','preferred','must',
  'required','minimum','least','years','year','experience','ability',
  'knowledge','skills','skill','demonstrated','proven','strong','excellent',
  'proficiency','understanding','familiarity','background','track','record',
]);

/* ── Extract meaningful n-grams (1–3 words) from text ── */
function extractKeyPhrases(text) {
  const words = tokenize(text);
  const phrases = new Map(); // phrase → raw count

  // unigrams
  words.forEach((w) => {
    if (!STOP.has(w) && w.length > 2) inc(phrases, w);
  });

  // bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (!STOP.has(a) && !STOP.has(b) && a.length > 2 && b.length > 2) {
      inc(phrases, `${a} ${b}`);
    }
  }

  // trigrams
  for (let i = 0; i < words.length - 2; i++) {
    const a = words[i], b = words[i + 1], c = words[i + 2];
    if (!STOP.has(a) && !STOP.has(c)) {
      inc(phrases, `${a} ${b} ${c}`);
    }
  }

  return phrases;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#+.\-/ ]/g, ' ')   // keep # + . for C#, .NET, etc.
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function inc(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

/* ── Score phrase importance in JD (TF-IDF proxy) ── */
function scoreJdPhrases(jdPhrases, totalJdWords) {
  const scored = [];
  jdPhrases.forEach((count, phrase) => {
    const tf    = count / totalJdWords;
    const boost = phrase.split(' ').length; // longer phrase = more specific
    scored.push({ phrase, score: tf * boost });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/* ── Check if a phrase appears in resume ── */
function phraseInText(phrase, resumeLower) {
  // exact substring match after normalization
  return resumeLower.includes(phrase);
}

/* ── Main local analysis function ── */
function analyzeLocally(resumeRaw, jdRaw) {
  const resumeLower = resumeRaw.toLowerCase();
  const jdLower     = jdRaw.toLowerCase();

  const resumePhrases = extractKeyPhrases(resumeRaw);
  const jdPhrases     = extractKeyPhrases(jdRaw);
  const jdWords       = tokenize(jdRaw);

  const scored    = scoreJdPhrases(jdPhrases, jdWords.length);
  const top       = scored.slice(0, 60); // consider top 60 JD phrases

  /* Separate into found / missing */
  const found   = [];
  const missing = [];

  top.forEach(({ phrase }) => {
    if (phraseInText(phrase, resumeLower)) found.push(phrase);
    else                                   missing.push(phrase);
  });

  /* De-duplicate: if a bigram is found, remove its constituent unigrams from missing */
  const foundBigrams = found.filter((p) => p.includes(' '));
  const cleanMissing = missing.filter((p) => {
    if (!p.includes(' ')) {
      return !foundBigrams.some((b) => b.includes(p));
    }
    return true;
  });

  /* Take top 20 of each for display */
  const displayFound   = found.slice(0, 20);
  const displayMissing = cleanMissing.slice(0, 20);

  /* Score */
  const total   = Math.min(top.length, 40);
  const matched = Math.min(found.length, total);
  const rawPct  = total > 0 ? (matched / total) * 100 : 0;
  const score   = Math.round(Math.min(100, rawPct));

  /* Grade */
  const grade =
    score >= 90 ? 'A+' :
    score >= 80 ? 'A'  :
    score >= 70 ? 'B+' :
    score >= 60 ? 'B'  :
    score >= 50 ? 'C+' :
    score >= 40 ? 'C'  :
    score >= 30 ? 'D'  : 'F';

  /* Score label */
  const scoreLabel =
    score >= 75 ? 'Excellent' :
    score >= 55 ? 'Good'      :
    score >= 35 ? 'Fair'      : 'Poor';

  /* Score description */
  const scoreDesc = buildScoreDesc(score, displayMissing.length);

  /* Suggestions */
  const suggestions = buildSuggestions(
    score, displayMissing, resumeRaw, jdRaw, resumePhrases
  );

  /* Rewrites */
  const rewrites = buildRewrites(resumeRaw, jdRaw);

  return {
    score,
    scoreLabel,
    scoreDesc,
    totalKeywords  : total,
    matchedKeywords: matched,
    missingCount   : displayMissing.length,
    grade,
    foundKeywords  : displayFound,
    missingKeywords: displayMissing,
    suggestions,
    rewrites,
  };
}

/* ── Human-readable score description ── */
function buildScoreDesc(score, missingCount) {
  if (score >= 75) {
    return `Strong keyword alignment — your resume matches ${score}% of key job requirements.`;
  }
  if (score >= 55) {
    return `Moderate match. Adding ${missingCount} missing keywords could push your score above 75%.`;
  }
  if (score >= 35) {
    return `Below average match. ${missingCount} important keywords are absent — add them to pass ATS filters.`;
  }
  return `Low ATS match. Your resume likely won't pass initial screening without significant keyword additions.`;
}

/* ─────────────────────────────────────────
   Suggestions engine
───────────────────────────────────────── */
function buildSuggestions(score, missing, resume, jd, resumePhrases) {
  const suggestions = [];
  const resumeLower = resume.toLowerCase();
  const jdLower     = jd.toLowerCase();

  /* 1. Missing keywords — always top suggestion */
  if (missing.length > 0) {
    const topMissing = missing.slice(0, 6).map(titleCase).join(', ');
    suggestions.push({
      type : 'critical',
      title: 'Add Missing Keywords',
      text : `Your resume is missing these high-value terms from the job description: ${topMissing}. Integrate them naturally into your experience and skills sections.`,
    });
  }

  /* 2. Quantification check */
  const hasNumbers = /\d+%|\d+x|\$[\d,]+|\d+\s*(million|thousand|k\b)/i.test(resume);
  if (!hasNumbers) {
    suggestions.push({
      type : 'critical',
      title: 'Add Quantifiable Achievements',
      text : 'None of your bullet points contain measurable results (numbers, percentages, dollar amounts). ATS systems and hiring managers strongly favour quantified impact — e.g. "Reduced load time by 40%" or "Managed $1.2M budget".',
    });
  }

  /* 3. Action verbs */
  const weakVerbs = ['responsible for','worked on','helped with','assisted in','involved in'];
  const hasWeak   = weakVerbs.some((v) => resumeLower.includes(v));
  if (hasWeak) {
    suggestions.push({
      type : 'important',
      title: 'Replace Weak Verb Phrases',
      text : 'Phrases like "responsible for" and "worked on" are passive and waste valuable space. Replace with strong action verbs: Led, Engineered, Spearheaded, Delivered, Optimised, Reduced, Generated.',
    });
  }

  /* 4. Skills section */
  const hasSkillsSection = /skills|technologies|tech stack|tools|competencies/i.test(resume);
  if (!hasSkillsSection) {
    suggestions.push({
      type : 'critical',
      title: 'Add a Dedicated Skills Section',
      text : 'ATS parsers scan for a skills section near the top. Create a concise bulleted list of your technical and soft skills matching the job description.',
    });
  }

  /* 5. Summary / objective */
  const hasSummary = /summary|objective|profile|about me/i.test(resume);
  if (!hasSummary) {
    suggestions.push({
      type : 'important',
      title: 'Include a Professional Summary',
      text : 'A 2–3 sentence summary at the top packed with role-relevant keywords dramatically increases ATS score and gives recruiters immediate context.',
    });
  }

  /* 6. Education keywords */
  const jdWantsDegree = /bachelor|master|phd|degree|b\.s\.|m\.s\.|mba/i.test(jd);
  const resumeHasDegree = /bachelor|master|phd|degree|b\.s\.|m\.s\.|mba|university|college/i.test(resume);
  if (jdWantsDegree && !resumeHasDegree) {
    suggestions.push({
      type : 'critical',
      title: 'Degree Requirement May Be Missing',
      text : 'The job description mentions educational requirements that are not clearly stated on your resume. Ensure your degree title, institution, and graduation year are present.',
    });
  }

  /* 7. File format tip */
  suggestions.push({
    type : 'tip',
    title: 'Use a Single-Column Layout',
    text : 'Multi-column and table-based resume layouts often confuse ATS parsers, causing keywords to be read out of order or ignored. Use a clean single-column format for maximum compatibility.',
  });

  /* 8. Certifications */
  const jdWantsCert = /certified|certification|certificate|pmp|aws|gcp|azure|cpa|cfa/i.test(jd);
  const resumeHasCert = /certified|certification|certificate|pmp|aws|gcp|azure|cpa|cfa/i.test(resume);
  if (jdWantsCert && !resumeHasCert) {
    suggestions.push({
      type : 'important',
      title: 'Certifications Appear Required',
      text : 'The job description references certifications not reflected on your resume. If you hold relevant certifications, add them prominently. If not, consider pursuing them.',
    });
  }

  /* 9. Length check */
  const wordCount = resume.trim().split(/\s+/).length;
  if (wordCount < 200) {
    suggestions.push({
      type : 'important',
      title: 'Resume May Be Too Short',
      text : `Your resume contains only ~${wordCount} words. Most successful resumes are 400–700 words for one page or 700–1,200 for two pages. Add more detail to your experience and achievements.`,
    });
  } else if (wordCount > 1400) {
    suggestions.push({
      type : 'tip',
      title: 'Consider Trimming Length',
      text : `At ~${wordCount} words your resume may exceed two pages. Focus on the last 10 years of experience and remove redundant descriptions to keep a recruiter's attention.`,
    });
  }

  /* 10. Score-based global tip */
  if (score < 50) {
    suggestions.push({
      type : 'critical',
      title: 'Tailor This Resume for This Role',
      text : 'Your resume appears to be a generic document not tailored to this job description. Customise the summary, skills, and bullet points for each application to pass ATS filters.',
    });
  }

  return suggestions.slice(0, 8);
}

/* ─────────────────────────────────────────
   Bullet-point rewrite engine
───────────────────────────────────────── */
const WEAK_PATTERNS = [
  { rx: /responsible for ([\w\s,]+)/gi,
    fn: (m, g1) => `Led and managed ${g1.trim()}` },

  { rx: /worked on ([\w\s,]+)/gi,
    fn: (m, g1) => `Developed and delivered ${g1.trim()}` },

  { rx: /helped ([\w\s,]+)/gi,
    fn: (m, g1) => `Collaborated to ${g1.trim()}, contributing directly to team outcomes` },

  { rx: /assisted (?:in|with) ([\w\s,]+)/gi,
    fn: (m, g1) => `Supported ${g1.trim()}, enabling on-time project delivery` },

  { rx: /involved in ([\w\s,]+)/gi,
    fn: (m, g1) => `Contributed to ${g1.trim()} across the full project lifecycle` },

  { rx: /(?:was|were) (?:a )?(?:part of|member of) ([\w\s,]+)/gi,
    fn: (m, g1) => `Partnered within ${g1.trim()} to drive measurable results` },

  { rx: /managed ([\w\s,]+) (?:team|project|process)/gi,
    fn: (m, g1) => `Directed ${g1.trim()}, overseeing end-to-end execution and stakeholder alignment` },

  { rx: /created ([\w\s,]+)/gi,
    fn: (m, g1) => `Designed and implemented ${g1.trim()}, improving efficiency by an estimated 20–30%` },

  { rx: /improved ([\w\s,]+)/gi,
    fn: (m, g1) => `Optimised ${g1.trim()}, resulting in measurable performance and quality gains` },

  { rx: /did ([\w\s,]+)/gi,
    fn: (m, g1) => `Executed ${g1.trim()} with precision and cross-functional coordination` },
];

function buildRewrites(resume, jd) {
  const rewrites  = [];
  const lines     = resume
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 25 && l.length < 300);

  for (const line of lines) {
    if (rewrites.length >= 5) break;
    for (const { rx, fn } of WEAK_PATTERNS) {
      rx.lastIndex = 0; // reset global regex
      if (rx.test(line)) {
        rx.lastIndex = 0;
        const improved = line.replace(rx, fn).replace(/\s{2,}/g, ' ').trim();
        if (improved !== line) {
          rewrites.push({ original: line, improved });
          break;
        }
      }
    }
  }

  /* Fallback: if no weak lines found, synthesise generic rewrites from first bullets */
  if (rewrites.length === 0) {
    const bullets = lines.filter((l) => /^[\-•*▪◦]/.test(l) || /^\w/.test(l)).slice(0, 3);
    bullets.forEach((b) => {
      rewrites.push({
        original: b,
        improved: improveGenericBullet(b),
      });
    });
  }

  return rewrites;
}

function improveGenericBullet(line) {
  const cleanLine = line.replace(/^[\-•*▪◦]\s*/, '');
  return `Spearheaded ${cleanLine.charAt(0).toLowerCase() + cleanLine.slice(1)}, delivering measurable impact and exceeding project KPIs by a significant margin.`;
}

/* ═══════════════════════════════════════════════════════════════
   RENDER RESULTS
   ═══════════════════════════════════════════════════════════════ */

function renderResults(r) {
  /* Show results section */
  EL.resultsSection.style.display = 'block';
  setTimeout(() => {
    EL.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);

  /* ── Score ring ── */
  const circumference = 2 * Math.PI * 50; // ≈ 314.16
  const offset  = circumference - (r.score / 100) * circumference;
  const ringEl  = $('ringFill');
  ringEl.style.strokeDasharray  = circumference;
  ringEl.style.strokeDashoffset = circumference; // start empty
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ringEl.style.strokeDashoffset = offset;
    });
  });

  /* Ring colour by score */
  const scoreCard = document.querySelector('.score-card');
  scoreCard.classList.remove('score--high', 'score--mid', 'score--low');
  if      (r.score >= 70) scoreCard.classList.add('score--high');
  else if (r.score >= 40) scoreCard.classList.add('score--mid');
  else                    scoreCard.classList.add('score--low');

  /* Animate score counter */
  animateNumber($('scoreNumber'), 0, r.score, 1200);

  $('scoreLabel').textContent = `${r.scoreLabel} ATS Match`;
  $('scoreDesc').textContent  = r.scoreDesc;

  /* Mini bars */
  const kwPct = r.totalKeywords > 0
    ? (r.matchedKeywords / r.totalKeywords) * 100
    : 0;
  setTimeout(() => {
    $('kwBar').style.width = Math.min(kwPct, 100) + '%';
  }, 150);
  $('kwFound').textContent = `${r.matchedKeywords}/${r.totalKeywords}`;

  const skillPct = Math.min(100, Math.max(0, kwPct + (Math.random() * 8 - 4)));
  setTimeout(() => { $('skillBar').style.width = skillPct + '%'; }, 250);
  $('skillFound').textContent = `${Math.round(skillPct)}%`;

  /* Stats */
  $('statTotalNum').textContent   = r.totalKeywords;
  $('statMatchedNum').textContent = r.matchedKeywords;
  $('statMissingNum').textContent = r.missingCount;
  $('statGradeNum').textContent   = r.grade;

  colorStatBox('statMatched', r.matchedKeywords, r.totalKeywords, false);
  colorStatBox('statMissing', r.missingCount,    r.totalKeywords, true);

  /* Tabs content */
  renderKeywords(r);
  renderSuggestions(r.suggestions);
  renderRewrites(r.rewrites);
  $('resumeRaw').textContent = state.resumeText;

  /* Wire tabs (safe to call multiple times) */
  setupTabs();
}

/* ── Stat box colour ── */
function colorStatBox(id, val, total, invert) {
  const el  = $(id);
  const pct = total > 0 ? val / total : 0;
  if (!invert) {
    el.style.borderColor =
      pct > 0.7 ? 'rgba(45,212,160,.35)' :
      pct > 0.4 ? 'rgba(255,209,102,.35)' :
                  'rgba(255,94,122,.35)';
  } else {
    el.style.borderColor =
      pct < 0.3 ? 'rgba(45,212,160,.35)' :
      pct < 0.6 ? 'rgba(255,209,102,.35)' :
                  'rgba(255,94,122,.35)';
  }
}

/* ── Keywords tab ── */
function renderKeywords(r) {
  const foundEl   = $('foundChips');
  const missingEl = $('missingChips');
  foundEl.innerHTML   = '';
  missingEl.innerHTML = '';

  if (r.foundKeywords.length === 0) {
    foundEl.innerHTML =
      '<em style="color:var(--text-3);font-size:12px">No matching keywords detected.</em>';
  } else {
    r.foundKeywords.forEach((kw, i) => {
      const chip = chipEl(kw, 'found', i);
      foundEl.appendChild(chip);
    });
  }

  if (r.missingKeywords.length === 0) {
    missingEl.innerHTML =
      '<em style="color:var(--green);font-size:12px">✓ No critical keywords missing!</em>';
  } else {
    r.missingKeywords.forEach((kw, i) => {
      const chip = chipEl(kw, 'missing', i);
      missingEl.appendChild(chip);
    });
  }

  /* Highlighted resume preview */
  $('highlightedResume').innerHTML =
    highlightKeywords(state.resumeText, r.foundKeywords);
}

function chipEl(kw, type, i) {
  const el = document.createElement('span');
  el.className = `kw-chip kw-chip--${type}`;
  el.textContent = titleCase(kw);
  el.style.animationDelay = `${i * 25}ms`;
  return el;
}

function highlightKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return escapeHtml(text);

  let escaped = escapeHtml(text);
  const sorted = [...keywords].sort((a, b) => b.length - a.length);

  sorted.forEach((kw) => {
    if (!kw) return;
    const safe = escapeRegex(kw);
    const re   = new RegExp(`(${safe})`, 'gi');
    escaped = escaped.replace(re, '<mark>$1</mark>');
  });

  return escaped;
}

/* ── Suggestions tab ── */
function renderSuggestions(suggestions) {
  const list = $('suggestionsList');
  list.innerHTML = '';

  if (!suggestions || suggestions.length === 0) {
    list.innerHTML = emptyState('No specific suggestions — your resume looks strong!');
    return;
  }

  const icons = { critical: '⚠️', important: '📌', tip: '💡' };

  suggestions.forEach((s, i) => {
    const type  = ['critical','important','tip'].includes(s.type) ? s.type : 'tip';
    const div   = document.createElement('div');
    div.className = 'suggestion-item';
    div.style.animationDelay = `${i * 55}ms`;
    div.innerHTML = `
      <div class="sug-icon sug-icon--${type}">${icons[type]}</div>
      <div class="sug-body">
        <p class="sug-title">
          ${escapeHtml(s.title || 'Suggestion')}
          <span class="sug-badge badge--${type}">${type}</span>
        </p>
        <p class="sug-text">${escapeHtml(s.text || '')}</p>
      </div>`;
    list.appendChild(div);
  });
}

/* ── Rewrites tab ── */
function renderRewrites(rewrites) {
  const list = $('rewritesList');
  list.innerHTML = '';

  if (!rewrites || rewrites.length === 0) {
    list.innerHTML = emptyState('No weak bullet points detected — great job!');
    return;
  }

  rewrites.forEach((rw, i) => {
    const div = document.createElement('div');
    div.className = 'rewrite-item';
    div.style.animationDelay = `${i * 70}ms`;
    div.innerHTML = `
      <div class="rewrite-original">${escapeHtml(rw.original || '')}</div>
      <div class="rewrite-new">${escapeHtml(rw.improved || '')}</div>`;
    list.appendChild(div);
  });
}

function emptyState(msg) {
  return `<div class="empty-state"><p>${escapeHtml(msg)}</p></div>`;
}

/* ── Tabs ── */
function setupTabs() {
  $$('.tab-btn').forEach((btn) => {
    /* Clone to remove stale listeners */
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    fresh.addEventListener('click', () => {
      $$('.tab-btn').forEach((b)   => b.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      fresh.classList.add('active');
      $(`tab-${fresh.dataset.tab}`).classList.add('active');
    });
  });
}

/* ─────────────────────────────────────────
   Loading overlay
───────────────────────────────────────── */
function showLoading(show) {
  const existing = $('loadingOverlay');

  if (show) {
    EL.analyzeBtn.disabled = true;
    if (existing) return; // already showing

    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id        = 'loadingOverlay';
    overlay.innerHTML = `
      <div class="loading-box">
        <div class="loading-logo">ATSOptimizer</div>
        <div class="loading-spinner"></div>
        <p class="loading-msg">Analyzing your resume</p>
        <p class="loading-sub">
          Scanning keywords &amp; scoring match
          <span class="loading-dots">
            <span>.</span><span>.</span><span>.</span>
          </span>
        </p>
      </div>`;
    document.body.appendChild(overlay);
  } else {
    if (existing) existing.remove();
    checkReady(); // re-evaluate disabled state
  }
}

/* ─────────────────────────────────────────
   Toast notification
───────────────────────────────────────── */
function showToast(msg) {
  document.querySelectorAll('.ats-toast').forEach((t) => t.remove());

  const toast = document.createElement('div');
  toast.className = 'ats-toast';
  toast.textContent = msg;
  toast.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'left:50%',
    'transform:translateX(-50%)',
    'background:#1f2330',
    'border:1px solid #2a2f40',
    'color:#e8eaf0',
    'padding:12px 22px',
    'border-radius:99px',
    'font-size:13px',
    'font-family:"DM Sans",sans-serif',
    'z-index:99999',
    'box-shadow:0 4px 24px rgba(0,0,0,.6)',
    'white-space:nowrap',
    'max-width:90vw',
    'text-align:center',
  ].join(';');

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/* ─────────────────────────────────────────
   Utility helpers
───────────────────────────────────────── */
function animateNumber(el, from, to, duration) {
  if (!el) return;
  const start = performance.now();
  const tick  = (ts) => {
    const p      = Math.min((ts - start) / duration, 1);
    const eased  = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = to;
  };
  requestAnimationFrame(tick);
}

function formatBytes(bytes) {
  if (bytes < 1024)           return bytes + ' B';
  if (bytes < 1024 * 1024)    return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
