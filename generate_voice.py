#!/usr/bin/env python3
"""
TTS generator using edge-tts CLI (more stable than Python API).
Falls back to Python API if CLI is unavailable.
"""
import asyncio
import subprocess
import sys
import os
import unicodedata

EDGE_TTS_CLI = '/usr/local/bin/edge-tts'

def clean_text(text):
    """Sanitize text so edge-tts doesn't choke on special Unicode."""
    replacements = {
        '\u2018': "'", '\u2019': "'",   # smart single quotes
        '\u201c': '"', '\u201d': '"',   # smart double quotes
        '\u2013': '-', '\u2014': ' - ', # en/em dash
        '\u2026': '...',                 # ellipsis
        '\u00a0': ' ',                   # non-breaking space
        '\u200b': '',                    # zero-width space
        '\u2022': '-',                   # bullet
        '\u00b7': '-',                   # middle dot
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    normalized = unicodedata.normalize('NFKD', text)
    cleaned = ''.join(c for c in normalized if not unicodedata.combining(c))
    return cleaned.strip()

def generate_via_cli(text, voice, audio_out, vtt_out):
    """Use the edge-tts CLI — avoids Python API websocket issues."""
    result = subprocess.run(
        [EDGE_TTS_CLI, '--voice', voice, '--text', text,
         '--write-media', audio_out, '--write-subtitles', vtt_out],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'edge-tts CLI failed')

async def generate_via_api(text, voice, audio_out, vtt_out):
    """Fallback: use Python edge-tts library."""
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
                        submaker.create_sub(
                            (chunk['offset'], chunk['duration']),
                            chunk['text']
                        )
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
    last_err = None

    for attempt in range(5):
        try:
            if use_cli:
                generate_via_cli(text, voice, audio_out, vtt_out)
            else:
                await generate_via_api(text, voice, audio_out, vtt_out)
            return
        except Exception as e:
            last_err = e
            if attempt < 4:
                await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s, 8s

    # CLI failed consistently — try Python API as last resort
    if use_cli:
        try:
            await generate_via_api(text, voice, audio_out, vtt_out)
            return
        except Exception as e:
            last_err = e

    raise last_err

asyncio.run(main())
