# Slide deck
Make the deck as ONE self-contained HTML file and save it with save_file (e.g. `deck-<topic>.html`). It opens in any browser; the user can print it to PDF.
1. Unless the user gave all the content, research first (web_search, web_extract). Use the plan tool for a long deck.
2. Outline 6 to 12 slides, one idea each. Title slide first, a closing slide last. Write speaker notes (40 to 120 words) for every slide.
3. Fill this template. Put each slide in a `<section class="slide">`; notes go in `<aside class="notes">` inside it. Do not use external files, fonts or scripts.
```html
<!doctype html><html><head><meta charset="utf-8"><title>TITLE</title><style>
*{box-sizing:border-box}body{margin:0;background:#111;font-family:system-ui,sans-serif}
.slide{display:none;width:100vw;height:100vh;padding:7vh 8vw;background:#fff;color:#1a1a1a;flex-direction:column;justify-content:center}
.slide.on{display:flex}h1{font-size:5vw;margin:0 0 2vh}h2{font-size:3.4vw;margin:0 0 3vh}p,li{font-size:2vw;line-height:1.5}
.sub{font-size:2.2vw;color:#666}.cols{display:flex;gap:4vw}.cols>*{flex:1}.stat{font-size:6vw;font-weight:700;color:#2563eb}
aside.notes{display:none}#bar{position:fixed;bottom:0;left:0;height:4px;background:#2563eb}#n{position:fixed;right:2vw;bottom:1.5vh;color:#888;font-size:1.4vw}
body.notes aside.notes{display:block;position:fixed;left:0;right:0;bottom:0;background:#000d;color:#fff;padding:2vh 4vw;font-size:1.5vw;max-height:30vh;overflow:auto}
@media print{.slide{display:flex;page-break-after:always;height:100vh}#bar,#n{display:none}aside.notes{display:none!important}}
</style></head><body>
<section class="slide"><h1>TITLE</h1><p class="sub">Subtitle</p><aside class="notes">Notes</aside></section>
<section class="slide"><h2>Point</h2><ul><li>One line</li></ul><aside class="notes">Notes</aside></section>
<div id="bar"></div><div id="n"></div>
<script>const s=[...document.querySelectorAll('.slide')];let i=0;
function go(k){i=Math.max(0,Math.min(s.length-1,k));s.forEach((e,j)=>e.classList.toggle('on',j==i));
document.querySelectorAll('aside.notes').forEach(a=>a.style.display=document.body.classList.contains('notes')&&a.parentElement==s[i]?'block':'none');
bar.style.width=(i+1)/s.length*100+'%';n.textContent=(i+1)+' / '+s.length;location.hash=i+1}
addEventListener('keydown',e=>{if(['ArrowRight',' ','PageDown'].includes(e.key))go(i+1);else if(['ArrowLeft','PageUp'].includes(e.key))go(i-1);else if(e.key=='n'){document.body.classList.toggle('notes');go(i)}});
addEventListener('click',e=>go(e.clientX>innerWidth/2?i+1:i-1));go((+location.hash.slice(1)||1)-1)</script></body></html>
```
4. Layouts you can use inside a slide: two columns `<div class="cols"><div>..</div><div>..</div></div>`, a big number `<div class="stat">42%</div><p>what it means</p>`, a quote `<blockquote>`. Keep text short: at most 6 bullets of 12 words. Charts: draw inline `<svg>` (no external images).
5. Finish with one short paragraph: the file name, how to present (arrow keys, `n` shows notes, print for PDF). Do not paste the HTML into the chat.
