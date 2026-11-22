# Chart
1. Get the data: from the user's message, an attached file (CSV/XLSX: read with pandas via execute_code), or research. Never invent data points.
2. Pick the chart that answers the question: bars to compare categories, lines for change over time, scatter for relationships, pie only for 2 to 5 parts of a whole. Sort bars by value. One message per chart: the title says the takeaway ("Sales doubled in Q3"), not the topic.
3. Make it with matplotlib (`pip install matplotlib` only if the import fails). If that is impossible, write an inline SVG by hand. Rules: label axes with units, no gridline clutter, start bars at zero, one accent colour plus grey, readable font sizes (at least 11pt), `plt.tight_layout()`, save at `dpi=200`.
4. Save the PNG (and the cleaned data as CSV) into your workspace folder so they show in the Library. Look at the result if you can (open the file) and fix overlaps or clipped labels.
5. Answer with the file name and the one-sentence takeaway.
