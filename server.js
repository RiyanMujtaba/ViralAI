require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const Groq    = require('groq-sdk');
const multer  = require('multer');

const app  = express();
const PORT = process.env.PORT || 3002;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PYTHON   = '/usr/local/Cellar/python@3.11/3.11.15/Frameworks/Python.framework/Versions/3.11/bin/python3.11';
const PYPATH   = '/usr/local/lib/python3.11/site-packages';
const YTDLP    = `PYTHONPATH="${PYPATH}" "${PYTHON}" -m yt_dlp --no-check-certificates`;
const FFMPEG   = 'ffmpeg';
const FFPROBE  = 'ffprobe';
const VOICE_PY = path.join(__dirname, 'generate_voice.py');

const OUTPUTS = path.join(__dirname, 'public', 'outputs');
const UPLOADS = path.join(__dirname, 'public', 'uploads');

[OUTPUTS, UPLOADS].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
  destination: UPLOADS,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 200 * 1024 * 1024, timeout: 300000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function tryDelete(f) {
  try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
}

// Robust JSON extractor — handles trailing commas, smart quotes, extra text
function extractJSON(text) {
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  // Replace smart/curly quotes with straight quotes
  text = text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON found in AI response');
  // Walk to matching closing brace
  let depth = 0, i = start, inStr = false, esc = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (esc)               { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"')           { inStr = !inStr; continue; }
    if (inStr)               continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  let json = text.slice(start, i + 1);
  json = json.replace(/,(\s*[}\]])/g, '$1');   // trailing commas
  // Convert mm:ss timestamp values to seconds  e.g. "start": 1:39  →  "start": 99
  json = json.replace(/"(start|end)":\s*"?(\d+):(\d+)"?/g,
    (_, key, m, s) => `"${key}": ${parseInt(m) * 60 + parseInt(s)}`
  );
  // Escape unescaped newlines/tabs inside string values
  json = json.replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) =>
    '"' + inner.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, ' ') + '"'
  );
  return JSON.parse(json);
}

// ── Preset Backgrounds ────────────────────────────────────────
const PRESETS = {
  minecraft:  {
    label: 'Minecraft Parkour', emoji: '⛏️',
    queries: [
      'ytsearch1:minecraft parkour satisfying no commentary 2024',
      'ytsearch1:minecraft parkour challenge map gameplay',
      'ytsearch1:minecraft dropper challenge no commentary',
      'ytsearch1:minecraft parkour world record attempt',
    ]
  },
  subway: {
    label: 'Subway Surfers', emoji: '🛹',
    queries: [
      'ytsearch1:subway surfers gameplay no commentary long 2024',
      'ytsearch1:subway surfers high score gameplay',
      'ytsearch1:subway surfers world tour gameplay no commentary',
      'ytsearch1:subway surfers new york gameplay no commentary',
    ]
  },
  gta: {
    label: 'GTA V', emoji: '🚗',
    queries: [
      'ytsearch1:GTA 5 free roam gameplay no commentary 4k',
      'ytsearch1:GTA V city driving gameplay no commentary',
      'ytsearch1:GTA 5 stunts compilation no commentary',
      'ytsearch1:GTA V online gameplay no commentary 2024',
    ]
  },
  satisfying: {
    label: 'Satisfying', emoji: '✨',
    queries: [
      'ytsearch1:oddly satisfying compilation kinetic sand 2024',
      'ytsearch1:most satisfying videos compilation no music',
      'ytsearch1:satisfying slime ASMR compilation no talking',
      'ytsearch1:satisfying crushing compilation no commentary',
    ]
  },
  cooking: {
    label: 'Cooking ASMR', emoji: '🍳',
    queries: [
      'ytsearch1:satisfying cooking compilation no talking 2024',
      'ytsearch1:satisfying food prep asmr no music',
      'ytsearch1:knife skills satisfying cooking asmr',
      'ytsearch1:japanese street food compilation no commentary',
    ]
  },
  temple: {
    label: 'Temple Run', emoji: '🏃',
    queries: [
      'ytsearch1:temple run 2 gameplay no commentary 2024',
      'ytsearch1:temple run endless gameplay no commentary',
      'ytsearch1:geometry dash gameplay no commentary',
      'ytsearch1:sonic dash gameplay no commentary',
    ]
  },
  nature: {
    label: 'Nature 4K', emoji: '🌿',
    queries: [
      'ytsearch1:relaxing 4k nature scenery no music no commentary',
      'ytsearch1:beautiful forest rain 4k relaxing video',
      'ytsearch1:ocean waves 4k relaxing no music',
      'ytsearch1:4k nature walk no commentary relaxing',
    ]
  },
  space: {
    label: 'Space', emoji: '🚀',
    queries: [
      'ytsearch1:earth from space nasa 4k no music',
      'ytsearch1:relaxing space journey 4k no commentary',
      'ytsearch1:milky way timelapse 4k no music',
      'ytsearch1:space ambient 4k no commentary no music',
    ]
  },
};

app.get('/api/presets', (req, res) => {
  res.json({ presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, emoji: p.emoji })) });
});

// ── Voices ────────────────────────────────────────────────────
const VOICES = [
  { id: 'en-US-GuyNeural',     name: 'Guy',     accent: 'American',   gender: 'male'   },
  { id: 'en-US-DavisNeural',   name: 'Davis',   accent: 'American',   gender: 'male'   },
  { id: 'en-US-JennyNeural',   name: 'Jenny',   accent: 'American',   gender: 'female' },
  { id: 'en-US-AriaNeural',    name: 'Aria',    accent: 'American',   gender: 'female' },
  { id: 'en-GB-RyanNeural',    name: 'Ryan',    accent: 'British',    gender: 'male'   },
  { id: 'en-GB-SoniaNeural',   name: 'Sonia',   accent: 'British',    gender: 'female' },
  { id: 'en-AU-WilliamNeural', name: 'William', accent: 'Australian', gender: 'male'   },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', accent: 'Australian', gender: 'female' },
  { id: 'en-US-AndrewNeural',  name: 'Andrew',  accent: 'American',   gender: 'male'   },
  { id: 'en-US-EmmaNeural',    name: 'Emma',    accent: 'American',   gender: 'female' },
];

app.get('/api/voices', (req, res) => res.json({ voices: VOICES }));

// ── Generate Script ───────────────────────────────────────────
app.post('/api/generate-script', async (req, res) => {
  const { topic, style } = req.body;

  const styleGuide = {
    story:      'a gripping short story with a hook, buildup, and satisfying twist ending',
    reddit:     'a first-person Reddit-style story, conversational and relatable, like reading a top Reddit post',
    facts:      '6-8 rapid fire mind-blowing facts that most people dont know, delivered with energy',
    horror:     'a short horror story with creeping dread and a terrifying ending',
    motivation: 'raw motivational speech, no BS, hits different, speaks to real struggles',
    gaming:     'an exciting gaming/Minecraft story told by an enthusiastic gamer',
    gossip:     'juicy celebrity or internet drama, like telling your friend something wild you just found out',
  };

  const guide = styleGuide[style] || styleGuide.story;

  // Randomize angle and opening so every script feels different
  const angles = [
    'starting with the most shocking detail first',
    'like you just found out and can\'t believe it yourself',
    'building slowly then hitting with a gut-punch twist',
    'with dark humor and irony throughout',
    'with urgent energy like breaking news',
    'from the perspective of an insider who knows too much',
    'by dropping the ending hint first then revealing how we got there',
    'with an opening so wild they have to keep watching',
  ];
  const openings = [
    'Start with a question that makes them stop scrolling.',
    'Start with a statement so bold it sounds like a lie.',
    'Start mid-scene like something already happened.',
    'Start with a number or stat that sounds impossible.',
    'Start with "Nobody talks about this."',
    'Start with a whisper-level detail that becomes huge.',
  ];
  const randomAngle   = angles[Math.floor(Math.random() * angles.length)];
  const randomOpening = openings[Math.floor(Math.random() * openings.length)];
  const seed = Math.random().toString(36).slice(2, 8); // force unique output

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Write ${guide} about: "${topic || 'something interesting and trending'}".
Angle: ${randomAngle}
Opening rule: ${randomOpening}
Variation seed: ${seed}

STRICT RULES:
- 60-80 seconds when read aloud (roughly 150-200 words)
- NEVER start with "Imagine", "Picture this", "Have you ever", or generic openers
- Short sentences. Max 12 words per sentence. Punchy.
- Sound 100% natural when spoken out loud — no weird phrasing
- No hashtags. No "like and subscribe". No emojis.
- End with something memorable that makes them want to share it
- Make it completely different from any script you might have written before
- Output ONLY the spoken script. Nothing else.`
      }],
      temperature: 1.05
    });

    res.json({ script: result.choices[0].message.content.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── VTT Parser ────────────────────────────────────────────────
function vttToSeconds(t) {
  const parts = t.trim().split(':');
  if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
}

function toASSTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
}

function parseVTT(content) {
  const cues = [];
  for (const block of content.split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [s, e] = timeLine.split('-->');
    const text = lines.filter(l => !l.includes('-->') && l.trim() && !l.match(/^\d+$/))
      .join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) cues.push({ start: vttToSeconds(s), end: vttToSeconds(e), text });
  }
  return cues;
}

function buildASS(cues, style = 'default') {
  // Group into 3-word chunks for TikTok-style word-by-word captions
  const grouped = [];
  let i = 0;
  while (i < cues.length) {
    const group = cues.slice(i, i + 3);
    grouped.push({
      start: group[0].start,
      end:   group[group.length - 1].end,
      text:  group.map(c => c.text).join(' ').toUpperCase()
    });
    i += 3;
  }

  // Alignment 5 = center of screen (horizontal + vertical center)
  // MarginV here is ignored for center alignment but set anyway
  const fontStyles = {
    default: { font: 'Arial',       size: 115, color: '&H00FFFFFF', outline: 6, shadow: 2, align: 5 },
    bold:    { font: 'Arial Black', size: 120, color: '&H00FFFFFF', outline: 8, shadow: 0, align: 5 },
    yellow:  { font: 'Arial',       size: 115, color: '&H0000FFFF', outline: 6, shadow: 2, align: 5 },
    minimal: { font: 'Arial',       size: 90,  color: '&H00FFFFFF', outline: 3, shadow: 1, align: 5 },
  };

  const s = fontStyles[style] || fontStyles.default;

  // BackColour &H60000000 = semi-transparent black box behind text for readability
  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.font},${s.size},${s.color},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,${s.outline},${s.shadow},${s.align},60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  for (const line of grouped) {
    ass += `Dialogue: 0,${toASSTime(line.start)},${toASSTime(line.end)},Default,,0,0,0,,${line.text}\n`;
  }
  return ass;
}

// ── Download preset/youtube bg ────────────────────────────────
async function downloadBg(source, id, dur) {
  const bgFile = path.join(UPLOADS, `${id}_bg.mp4`);
  let query;

  if (source.type === 'preset') {
    const preset = PRESETS[source.preset];
    if (!preset) throw new Error('Unknown preset');
    // Pick a RANDOM query from the array every time → different video each run
    const queries = preset.queries;
    query = queries[Math.floor(Math.random() * queries.length)];
  } else if (source.type === 'youtube') {
    query = source.url;
  } else {
    throw new Error('Invalid bg source');
  }

  // Wide random start offset (60–600s) so same preset always looks different
  const startOffset = Math.floor(Math.random() * 540) + 60;
  const endOffset   = startOffset + Math.ceil(dur) + 10;

  await run(`${YTDLP} -f "best[height<=720][ext=mp4]/best[height<=720]/best" --download-sections "*${startOffset}-${endOffset}" --force-keyframes-at-cuts -o "${bgFile}" "${query}"`);

  return bgFile;
}

// ── Create Video (AI Short) ───────────────────────────────────
app.post('/api/create', upload.fields([
  { name: 'background', maxCount: 1 },
  { name: 'music',      maxCount: 1 }
]), async (req, res) => {
  const { script, voice, caption_style, bg_source, bg_preset, bg_yt_url } = req.body;

  if (!script) return res.status(400).json({ error: 'Script is required' });
  if (!voice)  return res.status(400).json({ error: 'Voice is required' });

  const id        = uuidv4();
  const scriptTmp = path.join(UPLOADS, `${id}_script.txt`);
  const audioFile = path.join(UPLOADS, `${id}_audio.mp3`);
  const vttFile   = path.join(UPLOADS, `${id}_subs.vtt`);
  const assFile   = path.join(UPLOADS, `${id}_subs.ass`);
  const musicFile = req.files?.music?.[0]?.path || null;
  const outFile   = path.join(OUTPUTS, `${id}_video.mp4`);

  let bgFile = req.files?.background?.[0]?.path || null;
  let downloadedBg = false;

  try {
    // 1. Write script
    fs.writeFileSync(scriptTmp, script, 'utf8');

    // 2. Generate voice + VTT
    await run(`PYTHONPATH="${PYPATH}" "${PYTHON}" "${VOICE_PY}" "${scriptTmp}" "${voice}" "${audioFile}" "${vttFile}"`);

    // 3. Get audio duration
    const durOut = await run(`${FFPROBE} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioFile}"`);
    const dur = parseFloat(durOut) + 0.5;

    // 4. Download bg if no upload
    if (!bgFile) {
      if (bg_source === 'preset' && bg_preset) {
        bgFile = await downloadBg({ type: 'preset', preset: bg_preset }, id, dur);
        downloadedBg = true;
      } else if (bg_source === 'youtube' && bg_yt_url) {
        bgFile = await downloadBg({ type: 'youtube', url: bg_yt_url }, id, dur);
        downloadedBg = true;
      } else {
        return res.status(400).json({ error: 'No background video provided' });
      }
    }

    // 5. Build ASS captions
    const vttContent = fs.readFileSync(vttFile, 'utf8');
    const cues = parseVTT(vttContent);
    fs.writeFileSync(assFile, buildASS(cues, caption_style || 'default'));

    // 6. Pass 1 — crop video + mix audio (no subtitles yet)
    const tmpVid = path.join(UPLOADS, `${id}_tmp.mp4`);
    if (musicFile) {
      await run(`${FFMPEG} -y -stream_loop -1 -t ${dur} -i "${bgFile}" -i "${audioFile}" -stream_loop -1 -t ${dur} -i "${musicFile}" -filter_complex "[0:v]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1[v];[1:a]volume=1.0[voice];[2:a]volume=0.12[music];[voice][music]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    } else {
      await run(`${FFMPEG} -y -stream_loop -1 -t ${dur} -i "${bgFile}" -i "${audioFile}" -filter_complex "[0:v]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1[v];[1:a]volume=1.0[a]" -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    }

    // 7. Pass 2 — burn subtitles onto the rendered video
    if (cues.length > 0) {
      await run(`${FFMPEG} -y -i "${tmpVid}" -vf "ass='${assFile}'" -c:v libx264 -preset fast -crf 22 -c:a copy "${outFile}"`);
      tryDelete(tmpVid);
    } else {
      fs.renameSync(tmpVid, outFile);
    }

    // 8. Cleanup
    [scriptTmp, audioFile, vttFile, assFile, musicFile].forEach(tryDelete);
    if (downloadedBg) tryDelete(bgFile);
    else tryDelete(bgFile);

    res.json({ video: `/outputs/${id}_video.mp4` });

  } catch (err) {
    [scriptTmp, audioFile, vttFile, assFile, musicFile].forEach(tryDelete);
    if (downloadedBg && bgFile) tryDelete(bgFile);
    res.status(500).json({ error: err.message });
  }
});

// ── YouTube Clipper ───────────────────────────────────────────

// Parse YouTube's auto-generated VTT (has embedded word timestamps + duplicated lines)
function parseYTTranscript(vttContent) {
  const seen = new Set();
  const lines = [];
  for (const block of vttContent.split(/\n\n+/)) {
    const blines = block.trim().split('\n');
    const timeLine = blines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const startStr = timeLine.split('-->')[0].trim();
    const secs = vttToSeconds(startStr);
    const text = blines
      .filter(l => !l.includes('-->') && !l.match(/^\d+$/) && l.trim() && !l.startsWith('WEBVTT') && !l.startsWith('Kind') && !l.startsWith('Language') && !l.startsWith('NOTE'))
      .join(' ')
      .replace(/<[^>]+>/g, '')  // remove <00:00:00.000> and <c> tags
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 3) continue;
    // YouTube VTT repeats lines — deduplicate by content
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push({ t: Math.round(secs), text });
  }
  return lines;
}

function fmtSecs(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

app.post('/api/yt-info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const tmpId  = uuidv4();
  const subOut = path.join(UPLOADS, tmpId);

  try {
    // Get video metadata
    const raw  = await run(`${YTDLP} --dump-json --no-playlist "${url}"`);
    const info = JSON.parse(raw);

    // Try to download auto-generated subtitles (en)
    let transcript = [];
    try {
      await run(`${YTDLP} --write-auto-sub --sub-lang "en" --skip-download --sub-format vtt --no-playlist -o "${subOut}" "${url}"`);
      // yt-dlp writes to subOut.en.vtt
      const subFile = `${subOut}.en.vtt`;
      if (fs.existsSync(subFile)) {
        const vttRaw = fs.readFileSync(subFile, 'utf8');
        transcript = parseYTTranscript(vttRaw);
        tryDelete(subFile);
      }
    } catch (_) { /* no subs available — fall through */ }

    res.json({
      title:      info.title,
      duration:   info.duration,
      thumbnail:  info.thumbnail,
      uploader:   info.uploader,
      transcript, // array of { t: seconds, text: string }
      hasTranscript: transcript.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/yt-suggest', async (req, res) => {
  const { url, title, duration, transcript, exclude, seed } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const dur = duration || 0;
    let prompt;

    if (transcript && transcript.length > 0) {
      // We have the REAL transcript — AI can find actual funny/interesting moments
      // Limit to ~300 lines max to stay within tokens
      const lines = transcript.slice(0, 300);
      const transcriptText = lines.map(l => `[${fmtSecs(l.t)}] ${l.text}`).join('\n');
      const excludeNote = exclude && exclude.length
        ? `\nDo NOT suggest clips near these already-suggested timestamps: ${exclude.join(', ')}. Pick completely different moments.\n`
        : '';

      prompt = `This is the REAL transcript from a YouTube video titled "${title || 'Unknown'}" (${Math.floor(dur/60)}m long):

${transcriptText}

${excludeNote}
Based on the ACTUAL transcript above, find 4 genuinely funny, shocking, or viral-worthy moments to clip.

RULES:
- Only use timestamps that appear in the transcript above — these are REAL timestamps
- Pick moments where something actually interesting/funny/surprising is said or happens
- Start the clip slightly BEFORE the key moment so there's context
- End RIGHT after the moment lands — tight cut, no trailing silence
- Clips can be any length — a 5 second reaction or a 2 minute story, whatever fits
- caption: 4-5 words, lowercase, no punctuation, gen z style (e.g. "bro said what", "this actually happened")
- hook: explain what specifically makes THIS moment hit — reference the actual content
- CRITICAL: start and end MUST be plain integers in seconds. NEVER use mm:ss format. e.g. 99 not 1:39

Respond with JSON only, no markdown:
{
  "clips": [
    { "title": "clip title", "start": 45, "end": 58, "hook": "why this specific moment is funny/viral", "caption": "bro said what" },
    ...
  ]
}`;
    } else {
      // No transcript — be honest, use best guesses based on title/duration
      const excludeNote = exclude && exclude.length
        ? `\nDo NOT suggest near these timestamps: ${exclude.join(', ')}.\n`
        : '';
      const seedNote = seed ? `\nVariation: ${seed}\n` : '';

      prompt = `YouTube video: "${title || 'Unknown'}" — ${Math.floor(dur/60)}m ${dur%60}s long.
No transcript available. Suggest 4 clips based on typical structure of this type of video.
${excludeNote}${seedNote}
RULES:
- Clips can be ANY length
- Spread suggestions across different parts of the video
- Be honest that these are estimated — pick moments that typically go viral in this type of content
- caption: 4-5 words lowercase no punctuation gen z style
- CRITICAL: start and end MUST be plain integers in seconds. NEVER use mm:ss format. e.g. 99 not 1:39

Respond with JSON only:
{
  "clips": [
    { "title": "clip title", "start": 45, "end": 58, "hook": "what probably happens here", "caption": "gen z caption", "estimated": true },
    ...
  ]
}`;
    }

    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
    });

    const text = result.choices[0].message.content.trim();
    const parsed = extractJSON(text);

    if (dur) {
      parsed.clips = parsed.clips.map(c => ({
        ...c,
        start: Math.max(0, Math.min(c.start, dur - 3)),
        end:   Math.min(c.end, dur),
      }));
    }

    res.json({ ...parsed, hasTranscript: !!(transcript && transcript.length) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/yt-clip', upload.fields([{ name: 'music', maxCount: 1 }]), async (req, res) => {
  const { url, start, end, caption, caption_style, add_captions, cap_position } = req.body;
  if (!url)   return res.status(400).json({ error: 'URL required' });
  if (!start) return res.status(400).json({ error: 'Start time required' });
  if (!end)   return res.status(400).json({ error: 'End time required' });

  const id       = uuidv4();
  const rawFile  = path.join(UPLOADS, `${id}_raw.mp4`);
  const assFile  = path.join(UPLOADS, `${id}_subs.ass`);
  const outFile  = path.join(OUTPUTS, `${id}_clip.mp4`);
  const musicFile = req.files?.music?.[0]?.path || null;

  try {
    const s   = parseFloat(start);
    const e   = parseFloat(end);
    const dur = e - s;

    // Download clip segment
    await run(
      `${YTDLP} -f "best[height<=720][ext=mp4]/best[height<=720]/best" \
       --download-sections "*${s}-${e}" \
       --force-keyframes-at-cuts \
       -o "${rawFile}" \
       "${url}"`
    );

    // Build simple caption ASS if requested
    let hasCaptions = false;
    if (add_captions === 'true' && caption) {
      const words = caption.toUpperCase().split(' ');
      const chunks = [];
      for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(' '));
      const chunkDur = dur / chunks.length;

      // ASS alignment: 7=top-left 8=top-center 9=top-right
      //                4=mid-left  5=center     6=mid-right
      //                1=bot-left  2=bot-center 3=bot-right
      const posAlign = {
        'top-left':7,'top':8,'top-right':9,
        'mid-left':4,'center':5,'mid-right':6,
        'bot-left':1,'bottom':2,'bot-right':3,
      };
      const align   = posAlign[cap_position] ?? 2;
      const marginV = (align >= 7) ? 100 : (align >= 4) ? 0 : 120; // top/mid/bot margins

      const fontStyles = {
        default: { font: 'Arial',       size: 80,  color: '&H00FFFFFF', outline: 4, shadow: 2 },
        bold:    { font: 'Arial Black', size: 85,  color: '&H00FFFFFF', outline: 5, shadow: 0 },
        yellow:  { font: 'Arial',       size: 80,  color: '&H0000FFFF', outline: 4, shadow: 2 },
        minimal: { font: 'Arial',       size: 65,  color: '&H00FFFFFF', outline: 2, shadow: 1 },
      };
      const st = fontStyles[caption_style] || fontStyles.default;

      let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${st.font},${st.size},${st.color},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,${st.outline},${st.shadow},${align},60,60,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
      chunks.forEach((chunk, idx) => {
        const cs = idx * chunkDur, ce = cs + chunkDur;
        ass += `Dialogue: 0,${toASSTime(cs)},${toASSTime(ce)},Default,,0,0,0,,${chunk}\n`;
      });
      fs.writeFileSync(assFile, ass);
      hasCaptions = true;
    }

    // Pass 1: crop to 9:16 + mix audio
    const tmpVid = path.join(UPLOADS, `${id}_tmp.mp4`);
    if (musicFile) {
      await run(`${FFMPEG} -y -i "${rawFile}" -stream_loop -1 -t ${dur} -i "${musicFile}" -filter_complex "[0:v]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1[v];[0:a]volume=1.0[orig];[1:a]volume=0.15[music];[orig][music]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    } else {
      await run(`${FFMPEG} -y -i "${rawFile}" -filter_complex "[0:v]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1[v]" -map "[v]" -map "0:a?" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    }

    // Pass 2: burn subtitles if any
    if (hasCaptions) {
      await run(`${FFMPEG} -y -i "${tmpVid}" -vf "ass='${assFile}'" -c:v libx264 -preset fast -crf 22 -c:a copy "${outFile}"`);
      tryDelete(tmpVid);
    } else {
      fs.renameSync(tmpVid, outFile);
    }

    [rawFile, assFile, musicFile, path.join(UPLOADS, `${id}_tmp.mp4`)].forEach(tryDelete);
    res.json({ video: `/outputs/${id}_clip.mp4` });

  } catch (err) {
    [rawFile, assFile, musicFile, path.join(UPLOADS, `${id}_tmp.mp4`)].forEach(tryDelete);
    res.status(500).json({ error: err.message });
  }
});

// ── Cleanup old files ─────────────────────────────────────────
setInterval(() => {
  [OUTPUTS, UPLOADS].forEach(dir => {
    try {
      fs.readdirSync(dir).forEach(f => {
        const fp = path.join(dir, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp);
      });
    } catch {}
  });
}, 600000);

app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════╗`);
  console.log(`║  ViralAI  —  port ${PORT}        ║`);
  console.log(`╚═══════════════════════════════╝\n`);
  console.log(`Open: http://localhost:${PORT}\n`);
});
