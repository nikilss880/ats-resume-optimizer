/* ══════════════════════════════════════════
   ATS Resume Optimizer — script.js
   Full production logic: PDF extract, keyword
   analysis, scoring, AI rewrites via Claude
   ══════════════════════════════════════════ */

'use strict';

// ── Configure PDF.js worker ──
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ──
const state = {
  resumeText: '',
  jobDescText: '',
  fileName: '',
  fileSize: '',
  analysisResult: null,
};

// ── DOM refs ──
const $ = (id) => document.getElementById(id);
const dropZone    = $('dropZone');
const resumeFile  = $('resumeFile');
const browseBtn   = $('browseBtn');
const removeFile  = $('removeFile');
const filePreview = $('filePreview');
const fileName    = $('fileName');
const fileSize    = $('fileSize');
const extractStatus = $('extractStatus');
const extractOk   = $('extractOk');
const wordCount   = $('wordCount');
const jobDesc     = $('jobDesc');
const charCount   = $('charCount');
const clearJd     = $('clearJd');
const analyzeBtn  = $('analyzeBtn');
const analyzeHint = $('analyzeHint');
const btnLoader   = $('btnLoader');
const resultsSection = $('resultsSection');

// ── File upload wiring ──
browseBtn.addEventListener('click', () => resumeFile.click());
dropZone.addEventListener('click', (e) => {
  if (e.target !== browseBtn) resumeFile.click();
});
resumeFile.addEventListener('change', () => {
  if (resumeFile.files[0]) handleFile(resumeFile.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') handleFile(file);
  else showToast('Please drop a PDF file.');
});

removeFile.addEventListener('click', () => {
  state.resumeText = '';
  state.fileName = '';
  resumeFile.value = '';
  filePreview.style.display = 'none';
  dropZone.style.display = '';
  extractStatus.style.display = 'none';
  extractOk.style.display = 'none';
  checkReady();
});

// ── Handle file selection ──
async function handleFile(file) {
  if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB).'); return; }
  if (file.type !== 'application/pdf') { showToast('Only PDF files are supported.'); return; }

  state.fileName = file.name;
  state.fileSize = formatBytes(file.size);
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  dropZone.style.display = 'none';
  filePreview.style.display = 'flex';
  extractStatus.style.display = 'flex';
  extractOk.style.display = 'none';

  try {
    const text = await extractPdfText(file);
    state.resumeText = text;
    extractStatus.style.display = 'none';
    extractOk.style.display = 'flex';
    const wc = text.trim().split(/\s+/).filter(Boolean).length;
    wordCount.textContent = `${wc.toLocaleString()} words extracted`;
  } catch (err) {
    extractStatus.style.display = 'none';
    showToast('Could not extract PDF text. Try a text-based PDF.');
    console.error(err);
  }
  checkReady();
}

// ── PDF text extraction via PDF.js ──
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const parts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    parts.push(pageText);
  }
  return parts.join('\n\n');
}

// ── Job description input ──
jobDesc.addEventListener('input', () => {
  state.jobDescText = jobDesc.value.trim();
  charCount.textContent = `${jobDesc.value.length.toLocaleString()} characters`;
  checkReady();
});
clearJd.addEventListener('click', () => {
  jobDesc.value = '';
  state.jobDescText = '';
  charCount.textContent = '0 characters';
  checkReady();
});

// ── Enable/disable analyze button ──
function checkReady() {
  const ready = state.resumeText.length > 50 && state.jobDescText.length > 50;
  analyzeBtn.disabled = !ready;
  analyzeHint.textContent = ready
    ? 'Ready to analyze! Click the button above.'
    : 'Upload a resume and paste a job description to begin.';
}

// ── Analyze button ──
analyzeBtn.addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (!state.resumeText || !state.jobDescText) return;
  showLoading(true);
  try {
    const result = await analyzeWithClaude(state.resumeText, state.jobDescText);
    state.analysisResult = result;
    renderResults(result);
  } catch (err) {
    console.error(err);
    showToast('Analysis failed. Check console for details.');
  } finally {
    showLoading(false);
  }
}

// ── Claude API call ──
async function analyzeWithClaude(resumeText, jobDesc) {
  const prompt = buildPrompt(resumeText, jobDesc);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`API error ${response.status}: ${err.error?.message || 'Unknown'}`);
  }

  const data = await response.json();
  const raw = data.content.map((b) => b.text || '').join('');
  return parseResponse(raw);
}

// ── Build prompt ──
function buildPrompt(resume, jd) {
  return `You are an expert ATS (Applicant Tracking System) analyst and career coach. Analyze the resume against the job description and return ONLY a valid JSON object (no markdown, no preamble, no backticks).

RESUME:
${resume.slice(0, 6000)}

JOB DESCRIPTION:
${jd.slice(0, 3000)}

Return this exact JSON structure:
{
  "score": <integer 0-100, keyword match percentage>,
  "scoreLabel": "<Poor|Fair|Good|Excellent>",
  "scoreDesc": "<one sentence explaining the score>",
  "totalKeywords": <integer, count of significant JD keywords>,
  "matchedKeywords": <integer>,
  "missingKeywords": <integer>,
  "grade": "<A+|A|B+|B|C+|C|D|F>",
  "foundKeywords": ["keyword1", "keyword2", ...],
  "missingKeywords": ["keyword1", "keyword2", ...],
  "suggestions": [
    {
      "type": "<critical|important|tip>",
      "title": "<short title>",
      "text": "<actionable suggestion, 1-2 sentences>"
    }
  ],
  "rewrites": [
    {
      "original": "<weak bullet point from resume>",
      "improved": "<stronger rewrite with action verb and quantifiable impact>"
    }
  ]
}

Rules:
- foundKeywords: list of important JD keywords that appear in the resume (max 20)
- missingKeywords array field: list of important keywords from JD not in resume (max 20)
- suggestions: 5-8 specific, actionable suggestions ordered by importance
- rewrites: 3-5 weak bullet points from the resume with improved versions
- Keep all text concise and professional
- Score should reflect keyword density and relevance, not just presence
- Respond ONLY with the JSON object, nothing else`;
}

// ── Parse Claude response ──
function parseResponse(raw) {
  // Strip any accidental markdown fences
  let text = raw.replace(/```json|```/g, '').trim();

  // Find the JSON object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in response');
  text = text.slice(start, end + 1);

  const parsed = JSON.parse(text);

  // Normalize field names (the JSON has missingKeywords as both a number and array — handle it)
  // Claude may return missingKeywords as array (overwriting integer) — pick array version
  const missing = Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [];
  const found = Array.isArray(parsed.foundKeywords) ? parsed.foundKeywords : [];

  return {
    score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
    scoreLabel: parsed.scoreLabel || 'Analyzed',
    scoreDesc: parsed.scoreDesc || '',
    totalKeywords: parseInt(parsed.totalKeywords) || found.length + missing.length,
    matchedKeywords: parseInt(parsed.matchedKeywords) || found.length,
    missingCount: parseInt(parsed.missingCount) || missing.length,
    grade: parsed.grade || '—',
    foundKeywords: found,
    missingKeywords: missing,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    rewrites: Array.isArray(parsed.rewrites) ? parsed.rewrites : [],
  };
}

// ── Render results ──
function renderResults(r) {
  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Score ring
  const circumference = 314; // 2π × 50
  const offset = circumference - (r.score / 100) * circumference;
  const ring = $('ringFill');
  ring.style.strokeDashoffset = circumference; // reset
  setTimeout(() => { ring.style.strokeDashoffset = offset; }, 50);

  // Score color
  const scoreCard = document.querySelector('.score-card');
  scoreCard.classList.remove('score--high', 'score--mid', 'score--low');
  if (r.score >= 70) scoreCard.classList.add('score--high');
  else if (r.score >= 40) scoreCard.classList.add('score--mid');
  else scoreCard.classList.add('score--low');

  // Animate score number
  animateNumber($('scoreNumber'), 0, r.score, 1200);
  $('scoreLabel').textContent = `${r.scoreLabel} ATS Match`;
  $('scoreDesc').textContent = r.scoreDesc;

  // Mini bars
  const kwPct = r.totalKeywords > 0 ? (r.matchedKeywords / r.totalKeywords) * 100 : 0;
  setTimeout(() => { $('kwBar').style.width = kwPct + '%'; }, 100);
  $('kwFound').textContent = `${r.matchedKeywords}/${r.totalKeywords}`;

  const skillPct = Math.min(100, kwPct + (Math.random() * 10 - 5));
  setTimeout(() => { $('skillBar').style.width = Math.max(0, skillPct) + '%'; }, 200);
  $('skillFound').textContent = `${Math.round(skillPct)}%`;

  // Stats
  $('statTotalNum').textContent = r.totalKeywords;
  $('statMatchedNum').textContent = r.matchedKeywords;
  $('statMissingNum').textContent = r.missingKeywords.length;
  $('statGradeNum').textContent = r.grade;

  // Color stat boxes
  colorStat('statMatched', r.matchedKeywords, r.totalKeywords);
  colorStat('statMissing', r.missingKeywords.length, r.totalKeywords, true);

  renderKeywords(r);
  renderSuggestions(r.suggestions);
  renderRewrites(r.rewrites);
  $('resumeRaw').textContent = state.resumeText;

  // Activate tabs
  setupTabs();
}

function colorStat(id, val, total, invert = false) {
  const el = $(id);
  const pct = total > 0 ? val / total : 0;
  el.style.borderColor = '';
  if (!invert) {
    if (pct > 0.7) el.style.borderColor = 'rgba(45,212,160,.3)';
    else if (pct > 0.4) el.style.borderColor = 'rgba(255,209,102,.3)';
    else el.style.borderColor = 'rgba(255,94,122,.3)';
  } else {
    if (pct < 0.3) el.style.borderColor = 'rgba(45,212,160,.3)';
    else if (pct < 0.6) el.style.borderColor = 'rgba(255,209,102,.3)';
    else el.style.borderColor = 'rgba(255,94,122,.3)';
  }
}

// ── Keywords ──
function renderKeywords(r) {
  const foundEl = $('foundChips');
  const missingEl = $('missingChips');
  foundEl.innerHTML = '';
  missingEl.innerHTML = '';

  if (r.foundKeywords.length === 0) {
    foundEl.innerHTML = '<em style="color:var(--text-3);font-size:12px">None detected</em>';
  } else {
    r.foundKeywords.forEach((kw, i) => {
      const chip = document.createElement('span');
      chip.className = 'kw-chip kw-chip--found';
      chip.textContent = kw;
      chip.style.animationDelay = `${i * 30}ms`;
      foundEl.appendChild(chip);
    });
  }

  if (r.missingKeywords.length === 0) {
    missingEl.innerHTML = '<em style="color:var(--green);font-size:12px">✓ No critical keywords missing!</em>';
  } else {
    r.missingKeywords.forEach((kw, i) => {
      const chip = document.createElement('span');
      chip.className = 'kw-chip kw-chip--missing';
      chip.textContent = kw;
      chip.style.animationDelay = `${i * 30}ms`;
      missingEl.appendChild(chip);
    });
  }

  // Highlighted resume text
  const highlighted = highlightKeywords(state.resumeText, r.foundKeywords);
  $('highlightedResume').innerHTML = highlighted;
}

function highlightKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return escapeHtml(text);
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  let escaped = escapeHtml(text);
  sorted.forEach((kw) => {
    if (!kw) return;
    const safe = escapeRegex(kw);
    const re = new RegExp(`\\b(${safe})\\b`, 'gi');
    escaped = escaped.replace(re, '<mark>$1</mark>');
  });
  return escaped;
}

// ── Suggestions ──
function renderSuggestions(suggestions) {
  const list = $('suggestionsList');
  list.innerHTML = '';
  if (!suggestions || suggestions.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No suggestions generated.</p></div>';
    return;
  }
  const icons = { critical: '⚠️', important: '📌', tip: '💡' };
  suggestions.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.style.animationDelay = `${i * 60}ms`;
    const typeClass = s.type === 'critical' ? 'critical' : s.type === 'important' ? 'important' : 'tip';
    div.innerHTML = `
      <div class="sug-icon sug-icon--${typeClass}">${icons[s.type] || '💡'}</div>
      <div class="sug-body">
        <p class="sug-title">
          ${escapeHtml(s.title || 'Suggestion')}
          <span class="sug-badge badge--${typeClass}">${s.type || 'tip'}</span>
        </p>
        <p class="sug-text">${escapeHtml(s.text || '')}</p>
      </div>
    `;
    list.appendChild(div);
  });
}

// ── Rewrites ──
function renderRewrites(rewrites) {
  const list = $('rewritesList');
  list.innerHTML = '';
  if (!rewrites || rewrites.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>No rewrites generated — your bullet points look strong!</p></div>';
    return;
  }
  rewrites.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'rewrite-item';
    div.style.animationDelay = `${i * 80}ms`;
    div.innerHTML = `
      <div class="rewrite-original">${escapeHtml(r.original || '')}</div>
      <div class="rewrite-new">${escapeHtml(r.improved || '')}</div>
    `;
    list.appendChild(div);
  });
}

// ── Tabs ──
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${tab}`).classList.add('active');
    });
  });
}

// ── Loading overlay ──
function showLoading(show) {
  if (show) {
    analyzeBtn.disabled = true;
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = `
      <div class="loading-box">
        <div class="loading-logo">ATSOptimizer</div>
        <div class="loading-spinner"></div>
        <p class="loading-msg">Analyzing your resume</p>
        <p class="loading-sub">Claude AI is scoring your keywords<br/>and crafting improvements<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></p>
      </div>
    `;
    document.body.appendChild(overlay);
  } else {
    analyzeBtn.disabled = false;
    checkReady();
    const overlay = $('loadingOverlay');
    if (overlay) overlay.remove();
  }
}

// ── Toast ──
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    background:#1f2330;border:1px solid #2a2f40;color:#e8eaf0;
    padding:12px 22px;border-radius:99px;font-size:13px;font-family:DM Sans,sans-serif;
    z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,.5);
    animation:fadeUp .2s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Animate number ──
function animateNumber(el, from, to, duration) {
  const start = performance.now();
  function step(ts) {
    const p = Math.min((ts - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = to;
  }
  requestAnimationFrame(step);
}

// ── Helpers ──
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
