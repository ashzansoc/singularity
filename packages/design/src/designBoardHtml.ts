/**
 * Singularity Design Canvas — Figma-like board from Design Spec.
 * No external login / onboarding — opens directly in the IDE webview.
 */

import type { DesignSpecification } from './designSpec.js';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildDesignBoardHtml(
  spec: DesignSpecification,
  options: {
    notes?: string;
  } = {},
): string {
  const bg = spec.visual_identity.color.background;
  const fg = spec.visual_identity.color.foreground;
  const accent = spec.visual_identity.color.accent;
  const muted = spec.visual_identity.color.muted;
  const border = spec.visual_identity.color.border;
  const display = spec.typography.display.family;
  const body = spec.typography.body.family;
  const sections = spec.information_architecture.sections ?? [];
  const avoid = (spec.design_anti_patterns?.explicitly_prohibited ?? []).slice(0, 8);
  const notes = options.notes ?? '';
  const heroVisual =
    spec.hero.visual_concept?.purpose ||
    spec.design_strategy.central_idea.visual_metaphor ||
    spec.hero.strategy;
  const ctaLabel = spec.hero.cta?.primary || spec.product.primary_user_action;

  const frames = sections
    .map((sec, i) => {
      const isHero = i === 0 || /hero/i.test(sec.id);
      return `
      <article class="frame" data-section="${esc(sec.id)}">
        <header class="frame-chrome">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="frame-title">${esc(sec.id)}</span>
        </header>
        <div class="frame-canvas" style="background:${esc(bg)};color:${esc(fg)}">
          ${
            isHero
              ? `<div class="hero">
                  <p class="eyebrow">${esc(spec.product.category)}</p>
                  <h2 style="font-family:'${esc(display)}',serif">${esc(spec.product.name)}</h2>
                  <p class="lede">${esc(spec.design_strategy.central_idea.statement)}</p>
                  <div class="hero-visual" style="border-color:${esc(accent)}">
                    <span>${esc(heroVisual)}</span>
                  </div>
                  <button class="cta" style="background:${esc(accent)};color:${esc(bg)}">${esc(ctaLabel)}</button>
                </div>`
              : `<div class="section-body">
                  <h3 style="font-family:'${esc(display)}',serif">${esc(sec.id)}</h3>
                  <p>${esc(sec.purpose)}</p>
                  <div class="wire" style="border-color:${esc(border)};background:${esc(muted)}22"></div>
                </div>`
          }
        </div>
        <footer class="frame-foot">${esc(sec.purpose)}</footer>
      </article>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Design Canvas — ${esc(spec.product.name)}</title>
<style>
  :root {
    --bg: #121316;
    --panel: #1c1e24;
    --text: #ececef;
    --muted: #93939c;
    --accent: #6c8cff;
    --border: #2e313a;
    --font: "IBM Plex Sans", "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); }
  body { display: flex; flex-direction: column; }
  .topbar {
    display: flex; align-items: center; gap: 12px; padding: 10px 16px;
    border-bottom: 1px solid var(--border); background: var(--panel); flex-shrink: 0;
  }
  .brand { font-weight: 650; letter-spacing: 0.02em; font-size: 13px; }
  .brand span { color: var(--muted); font-weight: 400; margin-left: 8px; }
  .actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
  .status { font-size: 11px; color: var(--muted); }
  .btn {
    border: 1px solid var(--border); background: #2a2d36; color: var(--text);
    padding: 8px 14px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
  }
  .btn.primary { background: var(--accent); border-color: transparent; color: #0b1020; font-weight: 650; }
  .btn.ghost { background: transparent; }
  .main { flex: 1; min-height: 0; display: flex; }
  .side {
    width: 260px; flex-shrink: 0; border-right: 1px solid var(--border);
    background: var(--panel); padding: 14px; overflow: auto; font-size: 12px;
  }
  .side h4 { margin: 0 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
  .swatch { width: 34px; height: 34px; border-radius: 6px; border: 1px solid #0004; }
  .meta p { margin: 0 0 10px; color: var(--muted); line-height: 1.4; }
  .meta strong { color: var(--text); font-weight: 560; display: block; margin-bottom: 2px; }
  .avoid { margin: 0 0 14px; padding-left: 16px; color: var(--muted); }
  .avoid li { margin-bottom: 4px; }
  textarea {
    width: 100%; min-height: 100px; resize: vertical;
    background: #14161b; color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 8px; font: inherit;
  }
  .board-wrap { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .board {
    flex: 1; overflow: auto; padding: 40px 36px;
    display: flex; gap: 32px; align-items: flex-start;
    background:
      linear-gradient(90deg, #ffffff07 1px, transparent 1px),
      linear-gradient(#ffffff07 1px, transparent 1px);
    background-size: 20px 20px; background-color: #0e0f12;
  }
  .frame {
    width: 390px; flex-shrink: 0; border-radius: 12px; overflow: hidden;
    border: 1px solid var(--border); box-shadow: 0 18px 50px #0008;
    background: #0a0b0e;
  }
  .frame-chrome {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    background: #22252e; font-size: 11px; color: var(--muted);
  }
  .dots { display: flex; gap: 4px; }
  .dots i { width: 8px; height: 8px; border-radius: 50%; background: #555; display: block; }
  .frame-canvas { min-height: 520px; padding: 22px; font-family: "${esc(body)}", sans-serif; }
  .frame-foot {
    padding: 8px 12px; font-size: 11px; color: var(--muted);
    border-top: 1px solid var(--border); background: #16181e;
  }
  .hero h2 { font-size: 30px; margin: 6px 0 10px; line-height: 1.12; }
  .eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; margin: 0; }
  .lede { font-size: 14px; line-height: 1.45; opacity: 0.85; margin: 0 0 16px; }
  .hero-visual {
    border: 2px dashed; border-radius: 8px; min-height: 180px;
    display: grid; place-items: center; padding: 16px; margin-bottom: 16px; font-size: 13px; text-align: center;
  }
  .cta { border: 0; border-radius: 6px; padding: 10px 16px; font-weight: 600; cursor: default; }
  .section-body h3 { margin: 0 0 8px; font-size: 20px; }
  .section-body p { margin: 0 0 14px; opacity: 0.8; font-size: 13px; }
  .wire { height: 140px; border: 1px solid; border-radius: 8px; }
</style>
</head>
<body>
  <div class="topbar">
    <div class="brand">Design Canvas <span>${esc(spec.product.name)}</span></div>
    <div class="actions">
      <span class="status" id="status">Review art direction · then lock Final Design</span>
      <button class="btn ghost" id="btnSkip" type="button">Skip &amp; code</button>
      <button class="btn" id="btnSaveNotes" type="button">Save notes</button>
      <button class="btn primary" id="btnFinal" type="button">Final Design</button>
    </div>
  </div>
  <div class="main">
    <aside class="side">
      <h4>Palette</h4>
      <div class="swatches">
        <div class="swatch" title="background" style="background:${esc(bg)}"></div>
        <div class="swatch" title="foreground" style="background:${esc(fg)}"></div>
        <div class="swatch" title="accent" style="background:${esc(accent)}"></div>
        <div class="swatch" title="muted" style="background:${esc(muted)}"></div>
        <div class="swatch" title="border" style="background:${esc(border)}"></div>
      </div>
      <div class="meta">
        <p><strong>Concept</strong>${esc(spec.design_strategy.concept)}</p>
        <p><strong>Metaphor</strong>${esc(spec.design_strategy.central_idea.visual_metaphor)}</p>
        <p><strong>Type</strong>${esc(display)} / ${esc(body)}</p>
        <p><strong>Feel</strong>${esc((spec.product.brand_personality.should_feel || []).join(', '))}</p>
      </div>
      <h4>Avoid</h4>
      <ul class="avoid">${avoid.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
      <h4>Notes for coding</h4>
      <textarea id="notes" placeholder="Tweaks for the implementer…">${esc(notes)}</textarea>
    </aside>
    <section class="board-wrap">
      <div class="board">${frames || '<p style="color:#888">No sections in Spec.</p>'}</div>
    </section>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btnFinal').addEventListener('click', () => {
      vscode.postMessage({
        type: 'finalDesign',
        notes: document.getElementById('notes').value || '',
      });
    });
    document.getElementById('btnSkip').addEventListener('click', () => {
      vscode.postMessage({
        type: 'skipDesign',
        notes: document.getElementById('notes').value || '',
      });
    });
    document.getElementById('btnSaveNotes').addEventListener('click', () => {
      vscode.postMessage({
        type: 'saveNotes',
        notes: document.getElementById('notes').value || '',
      });
    });
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'status' && msg.text) {
        const status = document.getElementById('status');
        if (status) status.textContent = msg.text;
      }
    });
  </script>
</body>
</html>`;
}
