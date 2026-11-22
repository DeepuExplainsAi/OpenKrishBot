# Spreadsheet
Build a real `.xlsx` with Python, in the bot's workspace, then tell the user where it is (files in the workspace folder also show in the Library; or copy with save_file for CSV).
1. If the user attached or named a data file, read it first (read_file, or pandas via execute_code). Do not invent numbers: leave cells empty or mark them "assumption".
2. Make sure openpyxl exists: run `pip install openpyxl` through execute_code only if `import openpyxl` fails. If installing is not possible, write a CSV instead and say so.
3. Layout: header row (bold, filled, frozen with `ws.freeze_panes='A2'`), sensible column widths, number formats (`'#,##0.00'`, `'0.0%'`, dates), one table per sheet. Put inputs/assumptions on their own sheet.
4. Use live formulas for anything derived (`=SUM(B2:B20)`, `=C2/B2`), never pasted totals. Add a totals row when it makes sense.
5. Re-open the saved file with openpyxl and check: no `#REF!`, formulas present, header frozen. Fix, then answer in one short paragraph naming the file, sheets and what each holds.
