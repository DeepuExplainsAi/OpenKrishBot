# Voiceover
Make an MP3 of the text with the free `edge-tts` voices (needs internet, no account or key).
1. Prepare the script: plain spoken sentences, numbers and abbreviations written out as they are said, no markdown. Keep each file under about 5,000 words; split longer scripts into parts.
2. Install if missing: run `pip install edge-tts` through the terminal tool only when `python -c "import edge_tts"` fails.
3. Pick the voice from the language: `en-US-AriaNeural`, `en-GB-SoniaNeural`, `en-IN-NeerjaNeural`, `hi-IN-SwaraNeural` (female) or `hi-IN-MadhurNeural` (male). List all with `edge-tts --list-voices`.
4. Run: `edge-tts --voice VOICE --rate=+0% --text "…" --write-media voiceover.mp3` (for long text write the script to a file and use `--file script.txt`). Save into your workspace folder so it shows in the Library.
5. If there is no internet or the install fails, say so plainly. Do not pretend an MP3 was made. Answer with the file name, voice and length.
