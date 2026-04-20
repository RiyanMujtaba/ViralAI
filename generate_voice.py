#!/usr/bin/env python3
import asyncio
import sys

async def main():
    script_file = sys.argv[1]
    voice       = sys.argv[2]
    audio_out   = sys.argv[3]
    vtt_out     = sys.argv[4]

    with open(script_file, 'r', encoding='utf-8') as f:
        text = f.read().strip()

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

asyncio.run(main())
