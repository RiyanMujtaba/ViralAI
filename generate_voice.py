#!/usr/bin/env python3
import asyncio
import sys
import unicodedata

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
    # Normalize remaining unicode (decompose and strip non-ASCII combining chars)
    normalized = unicodedata.normalize('NFKD', text)
    cleaned = ''.join(c for c in normalized if not unicodedata.combining(c))
    return cleaned.strip()

async def generate(text, voice, audio_out, vtt_out):
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
        raise ValueError("Script is empty after cleaning")

    last_err = None
    for attempt in range(5):
        try:
            await generate(text, voice, audio_out, vtt_out)
            return
        except Exception as e:
            last_err = e
            if attempt < 4:
                await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s, 8s
    raise last_err

asyncio.run(main())
