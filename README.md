# ViralAI 🎬

An AI-powered short-form video creator. Generate viral scripts, add AI voiceover, burn karaoke-style subtitles, and clip the best moments from any YouTube video — all in the browser.

## Features

### Script + Video Generator
- Generate viral scripts on any topic with Groq AI (Llama 3)
- Free AI voiceover via edge-tts (no API cost)
- Karaoke-style word-highlighted subtitles burned into video
- Preset background videos (Minecraft parkour, Subway Surfers, etc.) auto-downloaded via yt-dlp
- 9-position caption placement grid
- Unique script every time (randomised angle, tone, seed)

### YouTube Clipper
- Paste any YouTube URL and get AI clip suggestions based on the real transcript
- Embedded YouTube player — watch and mark exact start/end points yourself
- Burns your selected clip with subtitles and background video
- Adjustable caption position

## Tech Stack
- Node.js + Express
- Groq API (Llama 3.3 70B)
- edge-tts (Python, free TTS)
- yt-dlp (YouTube transcript + video download)
- ffmpeg (two-pass video rendering + subtitle burning)
- YouTube IFrame Player API

## Requirements
- Node.js 18+
- Python 3.10+ with edge-tts: `pip install edge-tts`
- ffmpeg installed and in PATH
- yt-dlp installed: `pip install yt-dlp`
- Groq API key (free at console.groq.com)

## Getting Started

```bash
git clone https://github.com/RiyanMujtaba/ViralAI
cd ViralAI
npm install
cp .env.example .env   # add your GROQ_API_KEY
npm start
```

Open http://localhost:3002

---
Made by [Riyan Mujtaba](https://riyanmujtaba.github.io)