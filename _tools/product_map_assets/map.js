/* Static product map. All source content enters the DOM as text. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const states = {
    developing: 'In development', review: 'Development complete · awaiting acceptance',
    accepted: 'Accepted', unknown: 'Incomplete progress data', empty: 'No planned stories'
  };
  let snapshot = null;
  let selected = readHash();
  let visible = [];
  let refreshing = false;
  let returnFocusId = '';
  const array = value => Array.isArray(value) ? value : [];
  const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  function node(tag, value, className) {
    const el = document.createElement(tag);
    if (value != null) el.textContent = text(value);
    if (className) el.setAttribute('class', className);
    return el;
  }
  function state(item) { return Object.hasOwnProperty.call(states, item.state) ? item.state : 'unknown'; }
  function status(item) { return item.status_label || states[state(item)]; }
  function progress(item) {
    if (state(item) === 'empty') return 'No planned stories';
    if (item.progress_label) return text(item.progress_label);
    if (typeof item.progress !== 'number' || !Number.isFinite(item.progress)) return 'Unknown';
    // Round only for display, and do not round unfinished work up to 100%.
    const value = Math.max(0, Math.min(100, item.progress));
    return `${value < 100 ? Math.min(99.9, Math.round(value * 10) / 10) : 100}%`;
  }
  function labelValue(parent, label, value) {
    const row = node('p'); row.append(node('span', `${label} `, 'meta-label'), node('span', value || 'Not reported')); parent.append(row);
  }
  function safeLink(url, title) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return null;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
      const a = node('a', title); a.setAttribute('href', parsed.href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); return a;
    } catch (_) { return null; }
  }
  function readHash() {
    try { return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('component') || ''; }
    catch (_) { return ''; }
  }
  function workerName(worker) { return typeof worker === 'string' ? worker : text(worker && (worker.name || worker.agent || worker.id) || 'Unnamed worker'); }
  function workerStatus(worker) {
    if (!worker || typeof worker !== 'object') return 'Activity unverified';
    const expires = Date.parse(worker.expires_at);
    if (Number.isFinite(expires) && expires <= Date.now()) return 'Expired claim';
    if (worker.active === false || worker.expired) return 'Expired or inactive claim';
    if (worker.historical) return 'Historical claim';
    if (worker.active === true && Number.isFinite(expires)) return 'Reported active';
    return 'Activity unverified';
  }
  // Carbon icons are fixed paths; source names never become SVG or HTML markup.
  const icons = {
    human: ['M16,8a5,5,0,1,0,5,5A5,5,0,0,0,16,8Zm0,8a3,3,0,1,1,3-3A3.0034,3.0034,0,0,1,16,16Z', 'M16,2A14,14,0,1,0,30,16,14.0158,14.0158,0,0,0,16,2ZM10,26.3765V25a3.0033,3.0033,0,0,1,3-3h6a3.0033,3.0033,0,0,1,3,3v1.3765a11.8989,11.8989,0,0,1-12,0Zm13.9925-1.4507A5.0016,5.0016,0,0,0,19,20H13a5.0016,5.0016,0,0,0-4.9925,4.9258,12,12,0,1,1,15.985,0Z'],
    codex: ['M31 16 24 23 22.59 21.59 28.17 16 22.59 10.41 24 9 31 16z', 'M1 16 8 9 9.41 10.41 3.83 16 9.41 21.59 8 23 1 16z', 'M19 4 21 4 13 28 11 28z'],
    agent: ['M18 10H20V12H18z', 'M12 10H14V12H12z', 'M26,20H21V18h1a2.0023,2.0023,0,0,0,2-2V12h2V10H24V8a2.0023,2.0023,0,0,0-2-2H20V2H18V6H14V2H12V6H10A2.0023,2.0023,0,0,0,8,8v2H6v2H8v4a2.0023,2.0023,0,0,0,2,2h1v2H6a2.0023,2.0023,0,0,0-2,2v8H6V22H26v8h2V22A2.0023,2.0023,0,0,0,26,20ZM10,8H22v8H10Zm3,10h6v2H13Z']
  };
  function identity(name, kind, activity, description) {
    const badge = node('span', null, 'identity');
    badge.setAttribute('role', 'img'); badge.setAttribute('aria-label', description); badge.setAttribute('title', description);
    badge.setAttribute('data-harness', kind); badge.setAttribute('data-activity', activity);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const d of icons[kind === 'human' ? 'human' : kind === 'codex' ? 'codex' : 'agent']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
    }
    badge.append(svg, node('span', name, 'identity-label'));
    return badge;
  }
  function storyPeople(story) {
    const row = node('span', null, 'identity-list');
    const assignee = typeof story.assignee === 'object' && story.assignee ? story.assignee.name || story.assignee.displayName : story.assignee;
    if (assignee) row.append(identity(assignee, 'human', 'assigned', `Assignee: ${text(assignee)}. Assignment does not establish current activity.`));
    for (const worker of array(story.workers)) {
      const reported = workerStatus(worker);
      const rawHarness = worker && typeof worker === 'object' ? text(worker.harness).toLowerCase() : '';
      const harness = rawHarness.includes('codex') ? 'codex' : rawHarness.includes('claude') ? 'claude' : 'agent';
      const label = harness === 'codex' ? 'Codex' : harness === 'claude' ? 'Claude' : 'Agent';
      const activity = reported === 'Reported active' ? 'active' : reported.startsWith('Expired') ? 'expired' : 'unverified';
      const name = `${label} · ${workerName(worker)}`;
      row.append(identity(`${name}${activity === 'active' ? '' : ` · ${reported}`}`, harness, activity, `${name} · ${reported}`));
    }
    if (!row.children.length) row.append(node('span', 'No assignee or worker reported', 'unassigned'));
    return row;
  }
  function workers(parent, claims) {
    const list = array(claims);
    const heading = node('p'); heading.append(node('span', 'Reported workers', 'meta-label')); parent.append(heading);
    if (!list.length) { parent.append(node('p', 'No current worker claims reported.')); return; }
    const ul = node('ul', null, 'worker-list');
    for (const worker of list) {
      const li = node('li', `${workerName(worker)} · ${workerStatus(worker)}`);
      if (typeof worker === 'object' && worker) {
        if (worker.observed_at) li.append(node('div', `Observed ${worker.observed_at}`));
        if (worker.expires_at) li.append(node('div', `Expires ${worker.expires_at}`));
        if (worker.source) li.append(node('div', `Source: ${text(worker.source)}`));
      }
      ul.append(li);
    }
    parent.append(ul);
  }
  function diagnosticText(diagnostic) {
    if (typeof diagnostic === 'string') return diagnostic;
    return [diagnostic.severity || diagnostic.level, diagnostic.source, diagnostic.message || diagnostic.code || 'Unspecified data issue'].filter(Boolean).map(text).join(' · ');
  }
  function diagnostics(parent, rows, emptyText) {
    if (!array(rows).length) { if (emptyText) parent.append(node('p', emptyText)); return; }
    const ul = node('ul');
    for (const row of rows) ul.append(node('li', diagnosticText(row)));
    parent.append(ul);
  }
  function basis(component) {
    const total = component.total == null ? array(component.stories).filter(s => s.state !== 'removed').length : component.total;
    if (state(component) === 'empty') return 'No planned stories';
    const development = component.developed != null ? component.developed : component.development_complete == null ? array(component.stories).filter(s => s.progress === 100 && s.state !== 'removed').length : component.development_complete;
    const inReview = array(component.stories).filter(story => story.state === 'review' && story.status_label !== 'Awaiting story review transition').length;
    return `${total} ${total === 1 ? 'story' : 'stories'} · ${development} development complete · ${component.accepted == null ? 'Unknown' : component.accepted} accepted · ${inReview} in review`;
  }
  function makeCard(component) {
    const button = node('button', null, `card ${state(component)}`);
    button.setAttribute('type', 'button'); button.setAttribute('data-component', component.id);
    button.setAttribute('aria-pressed', String(selected === component.id)); button.setAttribute('aria-controls', 'details'); button.setAttribute('aria-haspopup', 'dialog');
    button.append(node('span', component.name || component.id, 'card-title'), node('span', component.description || 'No description recorded.', 'card-description'), node('span', status(component), 'status'));
    const row = node('span', null, 'progress-row');
    row.append(node('span', progress(component), /^\d+(\.\d+)?%$/.test(progress(component)) ? 'progress-value' : 'progress-label'));
    if (state(component) !== 'empty') button.append(row);
    if (typeof component.progress === 'number' && Number.isFinite(component.progress)) {
      const track = node('span', null, 'progress-track'); const fill = node('span', null, 'progress-fill');
      fill.style.width = `${Math.min(100, Math.max(0, component.progress))}%`; fill.style.display = 'block'; track.setAttribute('aria-hidden', 'true'); track.append(fill); button.append(track);
    }
    if (state(component) !== 'empty') button.append(node('span', basis(component), 'basis'));
    if (array(component.stories).length) {
      const stories = node('span', null, 'card-stories');
      for (const story of component.stories) {
        const row = node('span', null, 'card-story');
        row.append(node('span', `${story.id || 'Story'} · ${story.title || 'Untitled story'}`, 'card-story-label'), storyPeople(story));
        stories.append(row);
      }
      button.append(stories);
    }
    button.addEventListener('click', () => select(component.id));
    button.addEventListener('keydown', event => {
      const buttons = $('map-cards').querySelectorAll('button[data-component]'); const index = Array.from(buttons).indexOf(button);
      let next;
      if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % buttons.length;
      else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      if (next != null) { event.preventDefault(); buttons[next].focus(); }
    });
    return button;
  }
  function renderCards() {
    const focusedId = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.component;
    const query = $('search').value.trim().toLocaleLowerCase(); const filter = $('state-filter').value;
    visible = array(snapshot.components).filter(c => (!filter || state(c) === filter) && (!query || [c.name, c.description, ...array(c.stories).flatMap(s => [s.id, s.title])].map(text).join(' ').toLocaleLowerCase().includes(query)));
    $('map-cards').replaceChildren(...visible.map(makeCard));
    if (!visible.length) $('map-cards').append(node('p', array(snapshot.components).length ? 'No components match these filters. Try a different name or status.' : 'No components defined yet. Add product capabilities and story associations to the component registry.', 'empty-message'));
    $('result-count').textContent = `${visible.length} of ${array(snapshot.components).length} components`;
    markSelection();
    if (focusedId) {
      const focused = Array.from($('map-cards').querySelectorAll('button[data-component]')).find(button => button.dataset.component === focusedId);
      if (focused) focused.focus();
    }
    requestAnimationFrame(drawConnections);
  }
  function markSelection() {
    const neighbours = new Set();
    for (const c of array(snapshot && snapshot.components)) for (const edge of array(c.connections)) {
      if (c.id === selected) neighbours.add(edge.to);
      if (edge.to === selected) neighbours.add(c.id);
    }
    for (const card of $('map-cards').querySelectorAll('button[data-component]')) {
      card.setAttribute('aria-pressed', String(card.dataset.component === selected));
      const component = visible.find(c => c.id === card.dataset.component);
      card.setAttribute('class', `card ${state(component)}${neighbours.has(component.id) ? ' neighbour' : ''}`);
    }
  }
  function select(id, updateHash = true) {
    selected = text(id);
    if (updateHash) window.history.replaceState(null, '', `#component=${encodeURIComponent(selected)}`);
    if (!snapshot) return;
    markSelection(); renderDetail(); requestAnimationFrame(drawConnections);
    if (!selected) { if ($('details').open) $('details').close(); return; }
    if (!$('details').open) {
      returnFocusId = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.component || selected;
      document.body.classList.add('modal-open'); $('details').showModal();
    }
    $('close-details').focus();
  }
  function renderStory(story) {
    const article = node('article', null, 'story'); const h = node('h3');
    h.append(safeLink(story.url, `${story.id || 'Story'} · ${story.title || ''}`) || node('span', `${story.id || 'Story'} · ${story.title || ''}`)); article.append(h);
    const removed = story.state === 'removed' || story.removed === true;
    article.append(node('p', removed ? 'Removed from scope · excluded from progress' : `${story.status_label || story.status || status(story)} · ${progress(story)} development`));
    if (story.type) labelValue(article, 'Work type', story.type);
    if (story.original_status && story.original_status !== story.status) labelValue(article, 'Tracker status', story.original_status);
    const assignee = typeof story.assignee === 'object' && story.assignee ? story.assignee.name || story.assignee.displayName : story.assignee;
    labelValue(article, 'Assignee', assignee);
    article.append(storyPeople(story));
    const counts = story.slice_counts;
    if (counts && counts.total > 0 && !removed) article.append(node('p', `${counts.total || 0} planned slices · ${counts.complete || 0} complete · ${counts.in_progress || 0} in progress · ${counts.blocked || 0} blocked · ${counts.not_started || 0} not started · ${counts.unknown || 0} unknown`, 'slice-counts'));
    else if (!removed && story.unsliced) article.append(node('p', 'Explicitly unsliced. Development is counted when the story reaches review.'));
    else if (!removed) article.append(node('p', 'No declared slice plan reported.'));
    const slices = array(story.slices);
    if (slices.length) {
      const list = node('ul', null, 'slice-list');
      for (const slice of slices) {
        const li = node('li', `${slice.title || slice.id} · ${text(slice.status || slice.state || 'unknown')}`);
        if (slice.evidence) li.append(node('div', `Evidence: ${text(slice.evidence)}`)); list.append(li);
      }
      article.append(list);
    }
    if (story.branch) labelValue(article, 'Branch', typeof story.branch === 'object' ? story.branch.name || story.branch.ref : story.branch);
    const pr = typeof story.pr === 'object' && story.pr ? story.pr.url : story.pr;
    const prLink = safeLink(pr, 'Open pull request'); if (prLink) { const row = node('p'); row.append(prLink); article.append(row); }
    workers(article, story.workers);
    if (story.observed_at) labelValue(article, 'Observed', story.observed_at);
    if (story.historical) article.append(node('p', 'Historical facts retained from the last valid observation.', 'notice'));
    diagnostics(article, story.diagnostics);
    return article;
  }
  function renderDetail() {
    const focusedDetail = $('details').open && $('detail-body').contains(document.activeElement);
    const component = array(snapshot.components).find(c => c.id === selected); const body = $('detail-body'); body.replaceChildren();
    if (focusedDetail) $('close-details').focus();
    if (!component) {
      $('detail-title').textContent = selected ? 'Component unavailable' : 'Follow the work';
      body.append(node('p', selected ? 'The selected component is absent from this snapshot. Its URL is retained so a later refresh can restore it.' : 'Select a component to see its stories, slice progress and reported workers.'));
      return;
    }
    $('detail-title').textContent = component.name || component.id;
    body.append(node('p', component.description || 'No description recorded.'), node('p', `${status(component)} · ${progress(component)}`, `status ${state(component)}`), node('p', basis(component)));
    if (component.awaiting_story_review || component.review_transition_pending || array(component.stories).some(story => story.status_label === 'Awaiting story review transition')) body.append(node('p', 'Awaiting story review transition', 'notice'));
    if (component.origin_branch || component.branch) labelValue(body, 'Origin branch', component.origin_branch || component.branch);
    if (component.observed_at) labelValue(body, 'Observed', component.observed_at);
    for (const source of array(component.sources)) labelValue(body, 'Definition source', [source.branch || source.ref, source.sha, source.observed_at].filter(Boolean).join(' · '));
    if (component.historical) body.append(node('p', 'Historical definition retained with its original source age.', 'notice'));
    diagnostics(body, component.diagnostics);
    const edges = [];
    for (const c of array(snapshot.components)) for (const edge of array(c.connections)) {
      if (c.id === selected || edge.to === selected) edges.push({ ...edge, target: c.id === selected ? edge.to : c.id });
    }
    if (edges.length) {
      const section = node('section', null, 'detail-section'); section.append(node('h3', 'Connections'));
      const list = node('ul', null, 'connection-list');
      for (const edge of edges) {
        const target = array(snapshot.components).find(c => c.id === edge.target); const li = node('li'); const button = node('button', `${edge.label || 'Related to'} → ${target ? target.name || target.id : edge.target}${edge.inferred ? ' (inferred)' : ''}`);
        button.setAttribute('type', 'button'); button.addEventListener('click', () => select(edge.target)); li.append(button); list.append(li);
      }
      section.append(list); body.append(section);
    }
    const storySection = node('section', null, 'detail-section'); storySection.append(node('h3', 'Stories & development'));
    for (const story of array(component.stories)) storySection.append(renderStory(story));
    if (!array(component.stories).length) storySection.append(node('p', 'No associated story records in this snapshot.'));
    body.append(storySection);
    if (array(component.references).length) {
      const section = node('section', null, 'detail-section'); section.append(node('h3', 'Related work'));
      section.append(node('p', 'Context links; excluded from story progress.'));
      for (const item of component.references) {
        const row = node('p'); row.append(safeLink(item.url, `${item.id} · ${item.title}`) || node('span', `${item.id} · ${item.title}`));
        row.append(node('span', ` · ${item.type || 'Work item'} · ${item.status || 'Status unknown'}`)); section.append(row);
      }
      body.append(section);
    }
    if (array(component.workers).length) { const section = node('section', null, 'detail-section'); workers(section, component.workers); body.append(section); }
  }
  function renderEvidence() {
    const provenance = $('provenance'); provenance.replaceChildren();
    labelValue(provenance, 'Source observed', snapshot.observed_at || 'Unknown — no source observation recorded');
    labelValue(provenance, 'Site generated', snapshot.generated_at || 'Unknown');
    for (const source of array(snapshot.sources)) {
      const row = node('p'); row.append(node('span', `${[source.name || source.path, source.branch || source.ref].filter(Boolean).join(' · ') || 'Source'} `, 'meta-label'));
      if (source.sha) row.append(node('code', source.sha));
      if (source.observed_at) row.append(node('span', ` · observed ${source.observed_at}`));
      if (source.parsed != null || source.rejected != null) row.append(node('span', ` · ${source.parsed == null ? '?' : source.parsed} parsed · ${source.rejected == null ? '?' : source.rejected} rejected`));
      if (source.historical) row.append(node('span', ' · historical'));
      if (source.error) row.append(node('span', ` · unreadable: ${text(source.error)}`));
      provenance.append(row);
    }
    if (!array(snapshot.sources).length) provenance.append(node('p', 'No source refs or SHAs reported.'));
    $('diagnostics').replaceChildren(); diagnostics($('diagnostics'), snapshot.diagnostics, 'No data-quality issues reported by this snapshot.');
  }
  function drawConnections() {
    const svg = $('connections'); svg.replaceChildren();
    const rect = $('graph').getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const buttons = new Map(Array.from($('map-cards').querySelectorAll('button[data-component]')).map(button => [button.dataset.component, button]));
    const ns = 'http://www.w3.org/2000/svg';
    for (const c of visible) for (const edge of array(c.connections)) {
      if (!buttons.has(edge.to) || edge.to === c.id) continue;
      const a = buttons.get(c.id).getBoundingClientRect(); const b = buttons.get(edge.to).getBoundingClientRect();
      const vertical = Math.abs(a.left - b.left) < Math.abs(a.top - b.top);
      const forward = vertical ? b.top >= a.top : b.left >= a.left;
      const x1 = (vertical ? a.left + a.width / 2 : forward ? a.right : a.left) - rect.left;
      const y1 = (vertical ? forward ? a.bottom : a.top : a.top + a.height / 2) - rect.top;
      const x2 = (vertical ? b.left + b.width / 2 : forward ? b.left : b.right) - rect.left;
      const y2 = (vertical ? forward ? b.top : b.bottom : b.top + b.height / 2) - rect.top;
      const path = document.createElementNS(ns, 'path');
      const middleX = (x1 + x2) / 2; const middleY = (y1 + y2) / 2;
      path.setAttribute('d', vertical ? `M ${x1} ${y1} C ${x1} ${middleY}, ${x2} ${middleY}, ${x2} ${y2}` : `M ${x1} ${y1} C ${middleX} ${y1}, ${middleX} ${y2}, ${x2} ${y2}`);
      path.setAttribute('class', `connection${selected === c.id || selected === edge.to ? ' selected' : ''}`); svg.append(path);
      const label = document.createElementNS(ns, 'text'); label.textContent = `${edge.label || 'Related'}${edge.inferred ? ' (inferred)' : ''}`;
      label.setAttribute('x', middleX); label.setAttribute('y', middleY - 7); label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'connection-label'); svg.append(label);
    }
  }
  function render(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.components)) throw new Error('Unsupported or missing product-map snapshot.');
    const initial = !snapshot;
    snapshot = data;
    $('project-name').textContent = data.project && data.project.name || 'Product map';
    document.title = `${data.project && data.project.name || 'Product'} · Product map`;
    $('summary').textContent = `${data.components.length} product capabilities. Trace the work from development to acceptance.`;
    renderCards(); renderDetail(); renderEvidence();
    if (initial && selected) select(selected, false);
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true; $('refresh').disabled = true; $('update-status').textContent = 'Checking for a newer published snapshot…';
    try {
      const response = await fetch('./data.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
      render(await response.json()); $('update-status').textContent = 'Published snapshot loaded. Source observation times are shown below.';
    } catch (_) {
      $('update-status').textContent = snapshot ? 'Refresh unavailable. Previous snapshot retained; check its source observation time below.' : 'Snapshot unavailable. Build the product map and check data.json or data.js.';
      if (!snapshot) { $('summary').textContent = 'No readable snapshot available.'; $('diagnostics').replaceChildren(node('p', 'The snapshot could not be loaded. This is a source error, not an empty product plan.', 'notice')); }
    } finally { refreshing = false; $('refresh').disabled = false; }
  }
  function start() {
    $('close-details').addEventListener('click', () => $('details').close());
    $('details').addEventListener('close', () => {
      document.body.classList.remove('modal-open');
      const opener = Array.from($('map-cards').querySelectorAll('button[data-component]')).find(card => card.dataset.component === returnFocusId);
      (opener || $('search')).focus();
    });
    $('details').addEventListener('click', event => {
      const rect = $('details').getBoundingClientRect();
      if (event.target === $('details') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) $('details').close();
    });
    $('details').addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from($('details').querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(control => !control.disabled && control.getClientRects().length);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    $('search').addEventListener('input', () => { if (snapshot) renderCards(); });
    $('state-filter').addEventListener('change', () => { if (snapshot) renderCards(); });
    $('refresh').addEventListener('click', refresh);
    if (window.PRODUCT_MAP_DATA) {
      try { render(window.PRODUCT_MAP_DATA); } catch (_) { $('diagnostics').append(node('p', 'The embedded snapshot is invalid.', 'notice')); }
    }
    if (window.location.protocol !== 'file:') { refresh(); window.setInterval(refresh, 60000); }
    else if (!snapshot) { $('summary').textContent = 'No embedded snapshot available. Build the product map to create data.js.'; }
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(drawConnections).observe($('graph'));
    window.addEventListener('resize', () => requestAnimationFrame(drawConnections));
  }
  window.addEventListener('hashchange', () => select(readHash(), false));
  // Also used by the narrow renderer contract harness; no data is executable.
  window.ProductMap = { render, select, refresh, drawConnections };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.ProductMap.start = start;
}());
