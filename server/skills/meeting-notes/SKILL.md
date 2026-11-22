# Meeting notes
1. Find the recording the user means (attached file, or ask for the path). Audio or video both work.
2. Call the `transcribe` tool with its path. It runs Whisper on this computer (first use installs it, which takes a minute) and saves `<file>.transcript.txt`. If the user already gave a transcript, skip this.
3. Read the whole transcript. Do not summarise from the first screen only; long transcripts come back cut in the middle, so read the saved file in parts with `read_file`.
4. Write the notes as `meeting-notes.md` in your workspace folder:
   - **Summary**: 3 to 5 sentences.
   - **Decisions**: what was decided, one line each.
   - **Action items**: `- [ ] owner: task (due date if said)`. If the owner was not said, write "unassigned". Never invent owners or dates.
   - **Open questions**.
   - **Timeline**: topic changes with `[mm:ss]` stamps from the transcript.
5. The transcript has no speaker names. Only name a speaker when the speakers introduce themselves or are addressed by name; otherwise write "someone". Fix obvious mis-heard names using names from the user's memory notes.
6. Reply with the summary and the file name. Offer to email or share the notes only if the user asked.
