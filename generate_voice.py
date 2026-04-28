#!/usr/bin/env python3
"""
TTS generator with three layers:
1. edge-tts CLI  (best quality, requires network)
2. edge-tts Python API  (fallback, same service)
3. macOS 'say' command  (offline, always works)
"""
import asyncio
import subprocess
import sys
import os
import unicodedata

EDGE_TTS_CLI = '/usr/local/bin/edge-tts'

# edge-tts voice → macOS say voice
VOICE_MAP = {
    'en-US-GuyNeural':     'Alex',
    'en-US-DavisNeural':   'Alex',
    'en-US-AndrewNeural':  'Alex',
    'en-US-JennyNeural':   'Samantha',
    'en-US-AriaNeural':    'Samantha',
    'en-US-EmmaNeural':    'Samantha',
    'en-GB-RyanNeural':    'Daniel',
    'en-GB-SoniaNeural':   'Daniel',
    'en-AU-WilliamNeural': 'Karen',
    'en-AU-NatashaNeural': 'Karen',
    'ar-SA-HamedNeural':   'Maged',
    'ar-SA-ZariyahNeural': 'Maged',
}

def clean_text(text):
    replacements = {
        '\u2018': "'", '\u2019': "'",
        '\u201c': '"', '\u201d': '"',
        '\u2013': '-', '\u2014': ' - ',
        '\u2026': '...',
        '\u00a0': ' ',
        '\u200b': '',
        '\u2022': '-',
        '\u00b7': '-',
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    normalized = unicodedata.normalize('NFKD', text)
    return ''.join(c for c in normalized if not unicodedata.combining(c)).strip()

def format_vtt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f'{h:02d}:{m:02d}:{s:06.3f}'

def approx_vtt(words, duration):
    """Generate approximate word-timed VTT from word list + total duration."""
    if not words:
        return 'WEBVTT\n\n'
    groups = [' '.join(words[i:i+3]) for i in range(0, len(words), 3)]
    chunk = duration / len(groups)
    out = 'WEBVTT\n\n'
    for i, g in enumerate(groups):
        out += f'{format_vtt_time(i*chunk)} --> {format_vtt_time((i+1)*chunk)}\n{g}\n\n'
    return out

def get_duration(path):
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True
    )
    return float(r.stdout.strip())

def generate_via_cli(text, voice, audio_out, vtt_out):
    """edge-tts CLI — preferred method."""
    r = subprocess.run(
        [EDGE_TTS_CLI, '--voice', voice, '--text', text,
         '--write-media', audio_out, '--write-subtitles', vtt_out],
        capture_output=True, text=True, timeout=60
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or 'edge-tts CLI failed')

async def generate_via_api(text, voice, audio_out, vtt_out):
    """edge-tts Python API — second option."""
    import edge_tts
    communicate = edge_tts.Communicate(text, voice)
    submaker    = edge_tts.SubMaker()
    with open(audio_out, 'wb') as af:
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                af.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                try:
                    submaker.feed(chunk)
                except (TypeError, AttributeError):
                    try:
                        submaker.create_sub((chunk['offset'], chunk['duration']), chunk['text'])
                    except Exception:
                        pass
    try:
        subs = submaker.get_subs()
    except AttributeError:
        try:
            subs = submaker.generate_subs()
        except Exception:
            subs = 'WEBVTT\n\n'
    with open(vtt_out, 'w', encoding='utf-8') as sf:
        sf.write(subs)

def generate_via_say(text, voice, audio_out, vtt_out):
    """macOS say — offline, always works."""
    mac_voice = VOICE_MAP.get(voice, 'Samantha')
    aiff = audio_out.replace('.mp3', '.aiff').replace('.wav', '.aiff')
    if not aiff.endswith('.aiff'):
        aiff += '.aiff'

    subprocess.run(['say', '-v', mac_voice, '-o', aiff, '--', text],
                   check=True, capture_output=True)
    subprocess.run(['ffmpeg', '-y', '-i', aiff, audio_out],
                   check=True, capture_output=True)
    try:
        os.unlink(aiff)
    except Exception:
        pass

    dur = get_duration(audio_out)
    with open(vtt_out, 'w', encoding='utf-8') as f:
        f.write(approx_vtt(text.split(), dur))

async def main():
    script_file = sys.argv[1]
    voice       = sys.argv[2]
    audio_out   = sys.argv[3]
    vtt_out     = sys.argv[4]

    with open(script_file, 'r', encoding='utf-8') as f:
        raw = f.read().strip()
    text = clean_text(raw)
    if not text:
        raise ValueError('Script is empty after cleaning')

    use_cli = os.path.isfile(EDGE_TTS_CLI)

    # ── Try edge-tts (CLI then API) up to 3 attempts each ────────
    last_err = None
    for attempt in range(3):
        try:
            if use_cli:
                generate_via_cli(text, voice, audio_out, vtt_out)
            else:
                await generate_via_api(text, voice, audio_out, vtt_out)
            return
        except Exception as e:
            last_err = e
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)

    # If CLI failed, also try Python API once
    if use_cli:
        try:
            await generate_via_api(text, voice, audio_out, vtt_out)
            return
        except Exception as e:
            last_err = e

    # ── Fallback: macOS say (never fails) ─────────────────────────
    generate_via_say(text, voice, audio_out, vtt_out)

asyncio.run(main())
