require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const { exec, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const Groq    = require('groq-sdk');
const multer  = require('multer');

const app  = express();
const PORT = process.env.PORT || 3002;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PYTHON      = '/usr/local/Cellar/python@3.11/3.11.15/Frameworks/Python.framework/Versions/3.11/bin/python3.11';
const PYPATH      = '/usr/local/lib/python3.11/site-packages';
const YTDLP       = `PYTHONPATH="${PYPATH}" "${PYTHON}" -m yt_dlp --no-check-certificates`;
const FFMPEG      = 'ffmpeg';
const PEXELS_KEY  = process.env.PEXELS_API_KEY || '';
const FFPROBE  = 'ffprobe';
const VOICE_PY     = path.join(__dirname, 'generate_voice.py');
const RESHAPE_PY   = path.join(__dirname, 'reshape_arabic.py');

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

// Reshape Arabic text for ffmpeg drawtext (FreeType has no Arabic shaping/RTL support)
function reshapeArabic(text) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [RESHAPE_PY], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim() || text)); // fallback to original on failure
    proc.on('error', () => resolve(text));
    proc.stdin.write(text, 'utf8');
    proc.stdin.end();
  });
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
  stars: {
    label: 'Stars', emoji: '🌟',
    queries: [
      'ytsearch1:night sky stars timelapse 4k no music no commentary',
      'ytsearch1:milky way galaxy stars 4k relaxing no music',
      'ytsearch1:starry night sky 4k timelapse no music calm',
      'ytsearch1:dark night sky stars ambient 4k no commentary',
    ]
  },
  rain: {
    label: 'Rain Night', emoji: '🌧️',
    queries: [
      'ytsearch1:rain on window night dark relaxing 4k no music',
      'ytsearch1:rainy night dark aesthetic 4k no music ambient',
      'ytsearch1:heavy rain dark night 4k relaxing no commentary',
      'ytsearch1:rain sounds dark window aesthetic no music',
    ]
  },
  candles: {
    label: 'Candlelight', emoji: '🕯️',
    queries: [
      'ytsearch1:candlelight dark aesthetic 4k relaxing no music',
      'ytsearch1:candle flame dark ambient 4k no music no commentary',
      'ytsearch1:candlelight mood dark room 4k ambient no music',
      'ytsearch1:fireplace candles dark aesthetic no music 4k',
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
  const { script, voice, caption_style, bg_source, bg_preset, bg_yt_url,
          overlay_text, overlay_pos, overlay_size, overlay_color } = req.body;

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
      await run(`${FFMPEG} -y -stream_loop -1 -t ${dur} -i "${bgFile}" -i "${audioFile}" -stream_loop -1 -t ${dur} -i "${musicFile}" -filter_complex "[0:v]crop=if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw):if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9):(iw-if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw))/2:(ih-if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9))/2,scale=1080:1920,setsar=1[v];[1:a]volume=1.0[voice];[2:a]volume=0.12[music];[voice][music]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    } else {
      await run(`${FFMPEG} -y -stream_loop -1 -t ${dur} -i "${bgFile}" -i "${audioFile}" -filter_complex "[0:v]crop=if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw):if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9):(iw-if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw))/2:(ih-if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9))/2,scale=1080:1920,setsar=1[v];[1:a]volume=1.0[a]" -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    }

    // 7. Pass 2 — burn subtitles onto the rendered video
    if (cues.length > 0) {
      await run(`${FFMPEG} -y -i "${tmpVid}" -vf "ass='${assFile}'" -c:v libx264 -preset fast -crf 22 -c:a copy "${outFile}"`);
      tryDelete(tmpVid);
    } else {
      fs.renameSync(tmpVid, outFile);
    }

    // 8. Optional text overlay
    if (overlay_text && overlay_text.trim()) {
      const withOv = path.join(OUTPUTS, `${id}_video.mp4`);
      const preOv  = path.join(OUTPUTS, `${id}_preov.mp4`);
      fs.renameSync(outFile, preOv);
      await applyOverlay(preOv, withOv, overlay_text, overlay_pos, overlay_size, overlay_color);
    }

    // 9. Cleanup
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
  const { url, start, end, caption, caption_style, add_captions, cap_position,
          overlay_text, overlay_pos, overlay_size, overlay_color } = req.body;
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
      await run(`${FFMPEG} -y -i "${rawFile}" -stream_loop -1 -t ${dur} -i "${musicFile}" -filter_complex "[0:v]crop=if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw):if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9):(iw-if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw))/2:(ih-if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9))/2,scale=1080:1920,setsar=1[v];[0:a]volume=1.0[orig];[1:a]volume=0.15[music];[orig][music]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    } else {
      await run(`${FFMPEG} -y -i "${rawFile}" -filter_complex "[0:v]crop=if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw):if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9):(iw-if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw))/2:(ih-if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9))/2,scale=1080:1920,setsar=1[v]" -map "[v]" -map "0:a?" -t ${dur} -c:v libx264 -preset fast -crf 22 -c:a aac -ar 44100 -b:a 192k "${tmpVid}"`);
    }

    // Pass 2: burn subtitles if any
    if (hasCaptions) {
      await run(`${FFMPEG} -y -i "${tmpVid}" -vf "ass='${assFile}'" -c:v libx264 -preset fast -crf 22 -c:a copy "${outFile}"`);
      tryDelete(tmpVid);
    } else {
      fs.renameSync(tmpVid, outFile);
    }

    // Optional text overlay
    if (overlay_text && overlay_text.trim()) {
      const withOv = path.join(OUTPUTS, `${id}_clip.mp4`);
      const preOv  = path.join(OUTPUTS, `${id}_preov.mp4`);
      fs.renameSync(outFile, preOv);
      await applyOverlay(preOv, withOv, overlay_text, overlay_pos, overlay_size, overlay_color);
    }

    [rawFile, assFile, musicFile, path.join(UPLOADS, `${id}_tmp.mp4`)].forEach(tryDelete);
    res.json({ video: `/outputs/${id}_clip.mp4` });

  } catch (err) {
    [rawFile, assFile, musicFile, path.join(UPLOADS, `${id}_tmp.mp4`)].forEach(tryDelete);
    res.status(500).json({ error: err.message });
  }
});

// ── Islamic Reels ─────────────────────────────────────────────

function httpsGetJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ViralAI/1.0', ...headers } }, (res) => {
      // follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return httpsGetJSON(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const PEXELS_QUERIES = {
  stars:   'starry night sky dark',
  rain:    'rain dark night',
  candles: 'candles flame dark',
  space:   'galaxy space milky way',
  nature:  'dark forest nature peaceful',
};

function pexelsDownload(fileUrl, dst) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, res => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`Pexels download HTTP ${res.statusCode}`));
        const out = fs.createWriteStream(dst);
        res.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(fileUrl);
  });
}

// ── Islamic Music ─────────────────────────────────────────────
const AMBIENT_FILTERS = {
  rain:      (d) => `anoisesrc=c=pink:a=0.9:d=${d},lowpass=f=900,highpass=f=80`,
  heavyrain: (d) => `anoisesrc=c=white:a=0.95:d=${d},lowpass=f=1400,highpass=f=60`,
  river:     (d) => `anoisesrc=c=white:a=0.8:d=${d},lowpass=f=1200,highpass=f=200`,
  ocean:     (d) => `anoisesrc=c=pink:a=0.85:d=${d},lowpass=f=500,highpass=f=40`,
  waterfall: (d) => `anoisesrc=c=white:a=0.9:d=${d},lowpass=f=4000,highpass=f=300`,
  wind:      (d) => `anoisesrc=c=brown:a=0.9:d=${d},lowpass=f=350`,
  storm:     (d) => `anoisesrc=c=brown:a=0.95:d=${d},lowpass=f=180`,
  forest:    (d) => `anoisesrc=c=pink:a=0.5:d=${d},highpass=f=600,lowpass=f=7000`,
  night:     (d) => `anoisesrc=c=white:a=0.35:d=${d},highpass=f=2500,lowpass=f=6000`,
  calm:      (d) => `sine=frequency=432:d=${d}`,
  deep:      (d) => `sine=frequency=174:d=${d}`,
  peace:     (d) => `sine=frequency=528:d=${d}`,
};

async function buildMusicTrack(musicType, musicUrl, duration, dst) {
  if (musicType === 'none' || (!musicType && !musicUrl)) return null;

  if (musicUrl && musicUrl.trim()) {
    // Download custom URL with curl
    try {
      await run(`curl -L --max-time 60 --silent -o "${dst}" "${musicUrl.trim()}"`);
      return dst;
    } catch { return null; }
  }

  const filterFn = AMBIENT_FILTERS[musicType];
  if (!filterFn) return null;
  await run(`${FFMPEG} -y -f lavfi -i "${filterFn(duration)}" -t ${duration} -ar 44100 "${dst}"`);
  return dst;
}

async function downloadIslamicBg(preset, dst) {
  if (!PEXELS_KEY) {
    // Fallback: solid dark background if no Pexels key
    await run(`${FFMPEG} -y -f lavfi -i "color=c=0x0a0a1a:s=1080x1920:r=30" -t 120 -c:v libx264 -preset fast -crf 28 "${dst}"`);
    return;
  }
  const query = PEXELS_QUERIES[preset] || PEXELS_QUERIES.stars;
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait&size=medium`;
  const data = await httpsGetJSON(url, { Authorization: PEXELS_KEY });
  if (!data.videos || !data.videos.length) throw new Error('No Pexels videos found for preset: ' + preset);

  const video = data.videos[Math.floor(Math.random() * Math.min(data.videos.length, 10))];
  // Prefer HD portrait files ≥720p
  const files = [...video.video_files].sort((a, b) => b.height - a.height);
  const file  = files.find(f => f.height >= 720 && f.width < f.height) || files[0];
  await pexelsDownload(file.link, dst);
}

// Short, impactful Quran verses (hand-picked ayah numbers for Instagram appeal)
const ISLAMIC_VERSE_POOL = [
  94,    // Surah Ash-Sharh (94:5-6) — "With hardship comes ease"
  2286,  // Al-Baqarah 2:286 — "Allah does not burden a soul beyond that it can bear"
  3200,  // Al-Imran 3:200 — patience
  6410,  // Az-Zumar — trust Allah
  3159,  // Aal-Imran — tawakkul
  2153,  // Al-Baqarah 2:153 — "Allah is with the patient"
  3173,  // Aal-Imran 3:173 — "Allah is sufficient for us"
  65003, // use random below
];

app.get('/api/islamic-verse', async (req, res) => {
  try {
    // Pick a random ayah (total 6236 ayahs in the Quran)
    const ayahNum = Math.floor(Math.random() * 6236) + 1;
    const data = await httpsGetJSON(
      `https://api.alquran.cloud/v1/ayah/${ayahNum}/editions/quran-uthmani,quran-simple,en.sahih`
    );
    if (data.code !== 200) throw new Error('Quran API error: ' + data.status);

    const uthmani = data.data[0];
    const simple  = data.data[1];
    const english = data.data[2];

    res.json({
      ayahNum,
      arabic:          uthmani.text,   // Uthmani for verse card display
      arabicSimple:    simple.text,    // Simple for TTS + subtitles (GeezaPro compatible)
      translation:     english.text,
      surah:           uthmani.surah.englishName,
      surahArabic:     uthmani.surah.name,
      numberInSurah:   uthmani.numberInSurah,
      revelationType:  uthmani.surah.revelationType,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Islamic drawtext — FreeType direct, no libass/fontconfig
const FONT_EN = '/System/Library/Fonts/Helvetica.ttc';
const FONT_AR = '/System/Library/Fonts/GeezaPro.ttc'; // macOS system Arabic font

function safeDT(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g,  '\u2019')
    .replace(/:/g,  '\\:')
    .replace(/,/g,  '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/=/g,  '\\=')
    .replace(/;/g,  '\\;');
}

function buildIslamicDrawtext(introCues, arabicCues, engCues, surah, numberInSurah) {
  const parts = [];

  const dt = (font, text, x, y, size, color, borderW, s, e) =>
    `drawtext=fontfile='${font}':text='${safeDT(text)}':fontcolor=${color}:fontsize=${size}` +
    `:x=${x}:y=${y}:borderw=${borderW}:bordercolor=black@0.95:fix_bounds=1` +
    `:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'`;

  const cx = '(w-text_w)/2';

  // "VERSE OF THE DAY" — centered vertically, elegant gold
  for (const c of introCues)
    parts.push(dt(FONT_EN, c.text, cx, 'h*0.44', 72, '0xFFD700', 5, c.start, c.end));

  // Arabic verse — large white, upper area (centered)
  for (const c of arabicCues)
    parts.push(dt(FONT_AR, c.text, cx, 'h*0.25', 105, '0xFFFFFF', 8, c.start, c.end));

  // English translation — white, center of screen
  for (const c of engCues)
    parts.push(dt(FONT_EN, c.text, cx, 'h*0.54', 60, '0xFFFFFF', 5, c.start, c.end));

  // Surah reference — small gold label, lower third, shown during English
  if (surah && engCues.length > 0) {
    const s = engCues[0].start;
    const e = engCues[engCues.length - 1].end;
    const label = `Surah ${surah}  |  Verse ${numberInSurah}`;
    parts.push(dt(FONT_EN, label, cx, 'h*0.82', 38, '0xFFD700', 3, s, e));
  }

  return parts.join(',');
}

function groupCues(cues, size) {
  const out = [];
  for (let i = 0; i < cues.length; i += size) {
    const g = cues.slice(i, i + size);
    out.push({ start: g[0].start, end: g[g.length - 1].end, text: g.map(c => c.text).join(' ') });
  }
  return out;
}

app.post('/api/create-islamic', async (req, res) => {
  const { arabic, arabicSimple, translation, surah, numberInSurah, bg_preset, voice,
          overlay_text, overlay_pos, overlay_size, overlay_color,
          music_type, music_url } = req.body;
  // Use simple Arabic for TTS + subtitles (standard chars, GeezaPro compatible)
  const arabicForVideo = arabicSimple || arabic;
  if (!translation || !arabic) return res.status(400).json({ error: 'Verse data required' });

  const id       = uuidv4();
  const engVoice = voice || 'en-US-AriaNeural';
  const preset   = bg_preset || 'stars';

  const p    = (suf) => path.join(UPLOADS, `${id}${suf}`);
  const fOut = path.join(OUTPUTS, `${id}_islamic.mp4`);

  const fIntroScript  = p('_s0.txt');
  const fArabicScript = p('_s1.txt');
  const fEngScript    = p('_s2.txt');
  const fIntroAudio   = p('_a0.mp3');
  const fArabicAudio  = p('_a1.mp3');
  const fEngAudio     = p('_a2.mp3');
  const fIntroVtt     = p('_v0.vtt');
  const fArabicVtt    = p('_v1.vtt');
  const fEngVtt       = p('_v2.vtt');
  const fArabicSlow   = p('_a1slow.wav');
  const fCombined     = p('_combined.wav');
  const fMusicRaw     = p('_music.wav');
  const fWithMusic    = p('_narr_music.wav');
  const fTmp          = p('_vid.mp4');

  const allTmp = [fIntroScript,fArabicScript,fEngScript,fIntroAudio,fArabicAudio,
    fEngAudio,fIntroVtt,fArabicVtt,fEngVtt,fArabicSlow,fCombined,fMusicRaw,fWithMusic,fTmp];

  try {
    // 1. Write scripts
    fs.writeFileSync(fIntroScript,  'Verse of the Day.', 'utf8');
    fs.writeFileSync(fArabicScript, arabicForVideo, 'utf8');
    fs.writeFileSync(fEngScript,    `Surah ${surah}, verse ${numberInSurah}. ${translation}`, 'utf8');

    // 2. TTS — three parts
    const tts = (script, v, audio, vtt) =>
      run(`PYTHONPATH="${PYPATH}" "${PYTHON}" "${VOICE_PY}" "${script}" "${v}" "${audio}" "${vtt}"`);

    await tts(fIntroScript,  engVoice,            fIntroAudio,  fIntroVtt);
    await tts(fArabicScript, 'ar-SA-HamedNeural', fArabicAudio, fArabicVtt);
    await tts(fEngScript,    engVoice,             fEngAudio,    fEngVtt);

    // 3. Slow Arabic recitation to 78% speed → save as WAV (no codec restriction)
    await run(`${FFMPEG} -y -i "${fArabicAudio}" -filter:a "atempo=0.78" "${fArabicSlow}"`);

    // 4. Get durations (use slowed Arabic)
    const getDur = async (f) => parseFloat(
      await run(`${FFPROBE} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${f}"`)
    );
    const introDur  = await getDur(fIntroAudio);
    const arabicDur = await getDur(fArabicSlow);
    const engDur    = await getDur(fEngAudio);

    // 5. Concat intro + slowed arabic + english into one WAV
    await run(
      `${FFMPEG} -y -i "${fIntroAudio}" -i "${fArabicSlow}" -i "${fEngAudio}" ` +
      `-filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]" ` +
      `-map "[out]" "${fCombined}"`
    );

    const totalDur = introDur + arabicDur + engDur + 2.5;

    // 5b. Mix background music if requested
    const musicFile = await buildMusicTrack(music_type, music_url, totalDur, fMusicRaw);
    let finalAudio = fCombined;
    if (musicFile) {
      await run(
        `${FFMPEG} -y -i "${fCombined}" -i "${musicFile}" ` +
        `-filter_complex "[0:a]volume=1.0[narr];[1:a]volume=0.30,atrim=0:${totalDur.toFixed(3)}[mus];[narr][mus]amix=inputs=2:duration=first[out]" ` +
        `-map "[out]" -ar 44100 "${fWithMusic}"`
      );
      finalAudio = fWithMusic;
    }

    // 6. Build subtitles — write to /tmp for a clean short path (avoids filter escaping issues)
    const arabicOffset = introDur;
    const engOffset    = introDur + arabicDur;

    const shiftCues = (vttFile, offset, size) =>
      groupCues(
        parseVTT(fs.readFileSync(vttFile, 'utf8'))
          .map(c => ({ start: c.start + offset, end: c.end + offset, text: c.text })),
        size
      );

    const introCues  = [{ start: 0.1, end: introDur, text: 'VERSE OF THE DAY' }];

    // Use original Arabic text (not VTT) and reshape for ffmpeg's LTR-only drawtext
    const arabicWords  = arabicForVideo.trim().split(/\s+/).filter(Boolean);
    const rawGroups    = [];
    for (let i = 0; i < arabicWords.length; i += 3)
      rawGroups.push(arabicWords.slice(i, i + 3).join(' '));
    const arabicSlotDur  = arabicDur / (rawGroups.length || 1);
    const reshapedGroups = await Promise.all(rawGroups.map(g => reshapeArabic(g)));
    const arabicCues     = reshapedGroups.map((text, i) => ({
      start: arabicOffset + i * arabicSlotDur + 0.15,
      end:   arabicOffset + (i + 1) * arabicSlotDur - 0.15,
      text,
    }));

    const engCues = shiftCues(fEngVtt, engOffset, 5);

    const dtFilter = buildIslamicDrawtext(introCues, arabicCues, engCues, surah, numberInSurah);

    // 7. Download dark bg via Pexels (no yt-dlp needed)
    const bgFile = path.join(UPLOADS, `${id}_bg.mp4`);
    await downloadIslamicBg(preset, bgFile);
    allTmp.push(bgFile);

    // 8. Render video + audio (darken bg)
    await run(
      `${FFMPEG} -y -stream_loop -1 -t ${totalDur} -i "${bgFile}" -i "${finalAudio}" ` +
      `-filter_complex "[0:v]crop=if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw):if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9):(iw-if(gt(iw*16\\,ih*9)\\,ih*9/16\\,iw))/2:(ih-if(gt(iw*16\\,ih*9)\\,ih\\,iw*16/9))/2,scale=1080:1920,setsar=1,eq=brightness=-0.1:saturation=0.5[v]" ` +
      `-map "[v]" -map "1:a" -t ${totalDur} -c:v libx264 -preset fast -crf 20 -c:a aac -ar 44100 -b:a 192k "${fTmp}"`
    );

    // 9. Burn subtitles + optional custom overlay in one single pass
    let vfFilter = dtFilter;
    if (overlay_text && overlay_text.trim()) {
      const ovLines     = overlay_text.trim().split('\n');
      const ovProcessed = await Promise.all(ovLines.map(l => isArabic(l) ? reshapeArabic(l) : Promise.resolve(l)));
      const ovFilter    = overlayDrawtext(
        ovProcessed.join('\n'),
        overlay_pos || 'center',
        parseInt(overlay_size) || 65,
        overlay_color || '0xFFFFFF'
      );
      vfFilter = dtFilter + ',' + ovFilter;
    }

    await spawnRun([
      'ffmpeg', '-y', '-i', fTmp,
      '-vf', vfFilter,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'copy', fOut
    ]);

    allTmp.forEach(tryDelete);
    res.json({ video: `/outputs/${id}_islamic.mp4` });

  } catch (err) {
    allTmp.forEach(tryDelete);
    res.status(500).json({ error: err.message });
  }
});

// ── Text Overlay ──────────────────────────────────────────────
const OV_POS = {
  'top-left':  { x: '80',           y: '80' },
  'top':       { x: '(w-text_w)/2', y: '80' },
  'top-right': { x: 'w-text_w-80',  y: '80' },
  'mid-left':  { x: '80',           y: '(h-text_h)/2' },
  'center':    { x: '(w-text_w)/2', y: '(h-text_h)/2' },
  'mid-right': { x: 'w-text_w-80',  y: '(h-text_h)/2' },
  'bot-left':  { x: '80',           y: 'h-text_h-120' },
  'bottom':    { x: '(w-text_w)/2', y: 'h-text_h-120' },
  'bot-right': { x: 'w-text_w-80',  y: 'h-text_h-120' },
};

function isArabic(text) {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

const BOTTOM_POS = new Set(['bot-left', 'bottom', 'bot-right']);

function overlayDrawtext(text, pos, size, color) {
  const c       = OV_POS[pos] || OV_POS.center;
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean);
  const spacing = Math.round(size * 1.35);
  const isBot   = BOTTOM_POS.has(pos);

  return lines.map((line, i) => {
    const font = isArabic(line) ? FONT_AR : FONT_EN;
    const safe = line
      .replace(/\\/g, '\\\\').replace(/'/g, '\u2019')
      .replace(/:/g, '\\:').replace(/,/g, '\\,')
      .replace(/\[/g, '\\[').replace(/\]/g, '\\]')
      .replace(/=/g, '\\=').replace(/;/g, '\\;');
    // Stack lines: bottom positions go upward, others go downward
    const offset = isBot ? -(lines.length - 1 - i) * spacing : i * spacing;
    const yExpr  = offset === 0 ? c.y : `(${c.y})${offset > 0 ? '+' : ''}${offset}`;
    return `drawtext=fontfile='${font}':text='${safe}':fontcolor=${color}:fontsize=${size}:x=${c.x}:y=${yExpr}:borderw=5:bordercolor=black@0.85:fix_bounds=1`;
  }).join(',');
}

function spawnRun(args) {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] = args;
    const proc = spawn(cmd, rest, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) reject(new Error(stderr));
      else resolve();
    });
    proc.on('error', reject);
  });
}

async function applyOverlay(src, dst, text, pos, size, color) {
  if (!text || !text.trim()) { fs.renameSync(src, dst); return; }
  // Reshape any Arabic lines so ffmpeg drawtext renders them correctly
  const lines = text.trim().split('\n');
  const processed = await Promise.all(lines.map(l => isArabic(l) ? reshapeArabic(l) : Promise.resolve(l)));
  const filter = overlayDrawtext(processed.join('\n'), pos || 'center', parseInt(size) || 80, color || '0xFFFFFF');
  await spawnRun([
    'ffmpeg', '-y', '-i', src,
    '-vf', filter,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'copy', dst
  ]);
  tryDelete(src);
}

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
