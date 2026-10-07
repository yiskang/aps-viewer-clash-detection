// clashpanel/ui/render/run.js — Region 2 RUN / STATUS (spec §7.1–§7.3, §13, §14.4).
// Progress only from vm.run.progress (RunProgress fractions/counts + the Panel's own elapsed text): no ETA,
// no throughput, no telemetry (PD-13). The aria-live status node is created once and only its text changes, so
// assistive technology announces updates instead of seeing a new live region on every render.
import { el, rebuild, setText } from '../dom.js';
import { INTENT } from '../../core/intents.js';

const STATE_LABEL = Object.freeze({
  idle: 'Idle', preparing: 'Preparing', planning: 'Planning', running: 'Running',
  stopping: 'Stopping', finalizing: 'Finalizing',
});
const DONE_LABEL = Object.freeze({ completed: 'Completed', cancelled: 'Stopped', failed: 'Failed', invalidated: 'Invalidated' });

const bare = (t) => String(t).replace(/[\s.…]+$/u, '').toLowerCase();

/**
 * One concise status per state (owner decision 2026-10-07): the headline is shown only when it adds something. An idle
 * Panel shows just `Idle` (readiness lives in Test Setup), and a headline that already starts with the state label
 * (`Completed — 491 clashes`, `Running…`, `Stopping… (finishing the current step)`) replaces the label instead of repeating it.
 */
export function visibleStatus(run) {
  const label = stateLabel(run);
  const headline = typeof run.headline === 'string' ? run.headline : '';
  if (run.state === 'idle' || headline === '') return { label, headline: null };
  // A banner below that already says the same thing (e.g. "Stopped before any results") makes the headline redundant.
  if ((run.banners ?? []).some((b) => bare(b.text) === bare(headline))) return { label, headline: null };
  if (bare(headline).startsWith(bare(label))) return { label: null, headline };
  return { label, headline };
}

export function stateLabel(run) {
  if (run.state === 'done') return DONE_LABEL[run.doneKind] ?? 'Done';
  return STATE_LABEL[run.state] ?? run.state;
}

function progressBlock(doc, p) {
  if (!p) return null;
  const determinate = typeof p.fraction === 'number' && Number.isFinite(p.fraction);
  const pct = determinate ? Math.round(Math.min(1, Math.max(0, p.fraction)) * 100) : null;
  const bar = el(doc, 'progress', {
    attrs: {
      max: '1', 'aria-label': 'Run progress',
      'aria-valuemin': determinate ? '0' : null, 'aria-valuemax': determinate ? '100' : null,
      'aria-valuenow': determinate ? String(pct) : null,
      'aria-valuetext': determinate ? `${pct}%` : 'progress not yet known',
    },
  });
  if (determinate) bar.value = Math.min(1, Math.max(0, p.fraction));
  return el(doc, 'div', { class: 'clash-progress' }, [
    bar,
    el(doc, 'span', { class: 'clash-progress-pct', text: determinate ? ` ${pct}%` : '' }),
    el(doc, 'span', { class: 'clash-progress-units', text: ` units ${p.unitsEvaluated}/${p.unitsTotal}` }),
    el(doc, 'span', { class: 'clash-progress-found', text: ` found ${p.resultsFound}` }),
    el(doc, 'span', { class: 'clash-progress-caveats', text: ` caveats ${p.caveatCount}` }),
    el(doc, 'span', { class: 'clash-progress-elapsed', text: ` ${p.elapsedText}` }),
  ]);
}

function countsLine(doc, counts) {
  if (!counts || counts.total === null) return null;
  const parts = [`${counts.total} ${counts.total === 1 ? 'clash' : 'clashes'}`];
  if (counts.filtered !== null && counts.filtered !== undefined) parts.push(`${counts.filtered} match filters`);
  return el(doc, 'p', { class: 'clash-counts', text: parts.join(' · ') });
}

// Badge labels are rendered EXACTLY as T11 describeAxes returns them (already prefixed 'Coverage: …' etc.; the
// pending freshness label already reads 'Freshness: <value> (at seal) — checking freshness…'). Never re-prefixed.
function badgesBlock(doc, badges) {
  if (!badges) return null;
  const fresh = badges.freshness;
  return el(doc, 'ul', { class: 'clash-badges' }, [
    el(doc, 'li', { class: 'clash-badge-coverage', attrs: { 'data-value': badges.coverage.value }, text: badges.coverage.label }),
    el(doc, 'li', { class: 'clash-badge-integrity', attrs: { 'data-value': badges.integrity.value }, text: badges.integrity.label }),
    el(doc, 'li', {
      class: 'clash-badge-freshness',
      attrs: { 'data-value': fresh.value, 'aria-busy': fresh.pending ? 'true' : null },
      text: fresh.label,
    }),
  ]);
}

// Banner.action = {label, intent}: the controller names the exact intent its button dispatches (catalog §4 as
// amended by Part 3). The label is untrusted-safe plain text; the intent is dispatched as a copy.
function bannerBlock(doc, banner, dispatch) {
  const action = banner.action && typeof banner.action.label === 'string' && typeof banner.action.intent?.type === 'string'
    ? banner.action : null;
  return el(doc, 'div', {
    class: `clash-banner clash-banner-${banner.kind}`,
    attrs: { 'data-banner-id': banner.id, role: banner.kind === 'error' ? 'alert' : null },
  }, [
    el(doc, 'p', { class: 'clash-banner-text', text: banner.text }),
    Array.isArray(banner.details) && banner.details.length > 0
      ? el(doc, 'ul', { class: 'clash-banner-details' }, banner.details.map((d) => el(doc, 'li', { text: d })))
      : null,
    action
      ? el(doc, 'button', {
        attrs: { type: 'button', 'data-key': `banner-${banner.id}-action` },
        text: action.label,
        on: { click: () => dispatch({ ...action.intent }) },
      })
      : null,
  ]);
}

// "Copy diagnostics": dispatch(DIAGNOSTICS_COPY) RESOLVES with the full plain-JSON string (or null); the view
// copies it with the Clipboard API when the page offers one. No clipboard ⇒ nothing is copied, nothing throws.
async function copyDiagnostics(doc, dispatch) {
  const text = await dispatch({ type: INTENT.DIAGNOSTICS_COPY });
  const clipboard = doc.defaultView?.navigator?.clipboard;
  if (typeof text !== 'string' || typeof clipboard?.writeText !== 'function') return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function diagnosticsBlock(doc, diagnostics, dispatch) {
  if (!diagnostics || diagnostics.available !== true) return null;
  return el(doc, 'div', { class: 'clash-diagnostics' }, [
    el(doc, 'ul', { class: 'clash-diagnostics-preview' }, (diagnostics.preview ?? []).map((line) => el(doc, 'li', { text: line }))),
    el(doc, 'button', {
      attrs: { type: 'button', 'data-key': 'diagnostics-copy' },
      text: 'Copy diagnostics',
      on: { click: () => { void copyDiagnostics(doc, dispatch); } },
    }),
  ]);
}

// Spec §8.4 Run details: a native <details> disclosure of label/value rows (plain text).
function detailsBlock(doc, details, wasOpen) {
  if (!details || !Array.isArray(details.lines) || details.lines.length === 0) return null;
  return el(doc, 'details', { class: 'clash-run-details', props: { open: wasOpen } }, [
    el(doc, 'summary', { attrs: { 'data-key': 'run-details' }, text: 'Run details' }),
    el(doc, 'dl', {}, details.lines.flatMap((line) => [
      el(doc, 'dt', { text: line.label }),
      el(doc, 'dd', { text: line.value }),
    ])),
  ]);
}

export function renderRun(root, run, dispatch, doc) {
  let body = null;
  let status = null;
  for (const child of root.children) {
    if (child.classList.contains('clash-run-body')) body = child;
    else if (child.classList.contains('clash-status')) status = child;
  }
  if (!body) {
    body = el(doc, 'div', { class: 'clash-run-body' });
    root.insertBefore(body, root.firstChild);
  }
  if (!status) {
    status = el(doc, 'div', { class: 'clash-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    root.appendChild(status);
  }
  // The disclosure's open state is presentational DOM state: carried over a re-render, never sent anywhere.
  const detailsWasOpen = body.querySelector('.clash-run-details')?.open === true;
  rebuild(body, doc, () => {
    const done = run.state === 'done';
    body.appendChild(el(doc, 'div', { class: 'clash-run-actions' }, [
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'run-start', disabled: !run.canRun },
        text: 'Run clash test',
        on: { click: () => dispatch({ type: INTENT.RUN_START }) },
      }),
      el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'run-stop', disabled: !run.canStop },
        text: 'Stop',
        on: { click: () => dispatch({ type: INTENT.RUN_STOP }) },
      }),
      done ? el(doc, 'button', {
        attrs: { type: 'button', 'data-key': 'results-clear' },
        text: 'Clear results',
        on: { click: () => dispatch({ type: INTENT.RESULTS_CLEAR }) },
      }) : null,
    ]));
    const shown = visibleStatus(run);
    body.appendChild(el(doc, 'p', { class: 'clash-run-state', attrs: { 'data-state': run.state } }, [
      shown.label ? el(doc, 'span', { class: 'clash-run-state-label', text: shown.label }) : null,
      shown.headline ? el(doc, 'span', { class: 'clash-run-headline', text: shown.label ? ` · ${shown.headline}` : shown.headline }) : null,
    ]));
    if (run.waitingForOtherRun) body.appendChild(el(doc, 'p', { class: 'clash-run-waiting', text: 'Waiting for another run to finish…' }));
    const progress = progressBlock(doc, run.progress);
    if (progress) body.appendChild(progress);
    const counts = countsLine(doc, run.counts);
    if (counts) body.appendChild(counts);
    const badges = badgesBlock(doc, run.badges);
    if (badges) body.appendChild(badges);
    if (run.banners.length > 0) {
      body.appendChild(el(doc, 'div', { class: 'clash-banners' }, run.banners.map((b) => bannerBlock(doc, b, dispatch))));
    }
    const diagnostics = diagnosticsBlock(doc, run.diagnostics, dispatch);
    if (diagnostics) body.appendChild(diagnostics);
    const details = detailsBlock(doc, run.details, detailsWasOpen);
    if (details) body.appendChild(details);
  });
  if (status.textContent !== (run.statusLive ?? '')) setText(status, run.statusLive);
}
