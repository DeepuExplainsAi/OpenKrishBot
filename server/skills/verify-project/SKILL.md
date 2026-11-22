# Verify a project
Never say something works until a command you ran shows it.
1. Find how the project checks itself: package.json scripts, Makefile, pyproject, README. Prefer its own test, lint and typecheck commands over writing new ones.
2. Run them with the terminal tool, and read the real output. A command that prints nothing or exits non-zero is not a pass.
3. If a server or app is involved, start it in the background, wait for its ready line or a health URL, hit one real endpoint, then stop only the process you started.
4. Report: what you ran, what passed, what failed (first error line), what you could not check. Fix failures that are yours, then run again.
