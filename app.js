/* ============================================================
   Atlas of Global Energy
   vanilla JS + D3 — three levels: map → country → project
   ============================================================ */

const STATUS_CLASS = {
  'operational': 'operational',
  'under construction': 'building',
  'planned': 'planned'
};

const state = {
  data: null,
  byCountry: new Map(),
  features: [],
  current: { country: null, filter: 'all' }
};

const els = {
  views: {
    map: document.getElementById('view-map'),
    country: document.getElementById('view-country'),
    project: document.getElementById('view-project')
  },
  heroTitle: document.getElementById('hero-title'),
  heroSub: document.getElementById('hero-sub'),
  mapHint: document.getElementById('map-hint'),
  legendText: document.getElementById('legend-text'),
  tooltip: document.getElementById('map-tooltip'),
  select: document.getElementById('country-select'),
  countryName: document.getElementById('country-name'),
  countryMeta: document.getElementById('country-meta'),
  filters: document.getElementById('filters'),
  grid: document.getElementById('project-grid'),
  detail: document.getElementById('detail'),
  backCountryLabel: document.getElementById('back-country-label')
};

/* ---------- boot ---------- */
Promise.all([
  fetch('projects.json').then(r => r.json()),
  fetch('world-110m.json').then(r => r.json())
]).then(([data, world]) => {
  state.data = data;
  data.countries.forEach(c => state.byCountry.set(c.name, c));

  // hero / chrome text
  els.heroTitle.innerHTML = 'The world<br>runs on <span class="accent">energy.</span>';
  els.heroSub.textContent = data.meta.subtitle;
  els.legendText.textContent = data.meta.disclaimer;

  populateSelect(data);
  initMap(world);
  wireNav();
}).catch(err => {
  console.error('Load failed', err);
  els.heroSub.textContent = 'Could not load data. Serve this folder over http (see console).';
});

/* ---------- country dropdown (mobile / fallback) ---------- */
function populateSelect(data) {
  data.countries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(c => {
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = `${displayName(c.name)} · ${c.projects.length}`;
      els.select.appendChild(o);
    });
  els.select.addEventListener('change', e => {
    if (e.target.value) openCountry(e.target.value, true);
  });
}

function displayName(n) {
  return n === 'United States of America' ? 'United States' : n;
}

/* ============================================================
   MAP (level 1)
   ============================================================ */
let mapRefs = null;

function initMap(world) {
  const svg = d3.select('#map');
  const stage = document.getElementById('map-stage');
  const countries = topojson.feature(world, world.objects.countries).features;
  state.features = countries;

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);
  const g = svg.append('g');

  // layers
  const gOcean = g.append('g');
  const gLand = g.append('g');
  const gMark = g.append('g');

  gOcean.append('path').attr('class', 'sphere').datum({ type: 'Sphere' });
  gOcean.append('path').attr('class', 'graticule').datum(d3.geoGraticule10());

  const land = gLand.selectAll('path')
    .data(countries)
    .join('path')
    .attr('class', d => state.byCountry.has(d.properties.name) ? 'country has-projects' : 'country')
    .on('mousemove', (event, d) => {
      if (!state.byCountry.has(d.properties.name)) { hideTip(); return; }
      const c = state.byCountry.get(d.properties.name);
      const [x, y] = d3.pointer(event, stage);
      showTip(x, y, `${displayName(d.properties.name)} · <span class="tt-count">${c.projects.length} projects</span>`);
    })
    .on('mouseenter', (event, d) => {
      if (state.byCountry.has(d.properties.name)) d3.select(event.currentTarget).classed('is-hot', true);
    })
    .on('mouseleave', (event, d) => {
      d3.select(event.currentTarget).classed('is-hot', false);
      hideTip();
    })
    .on('click', (event, d) => {
      if (state.byCountry.has(d.properties.name)) zoomThenOpen(d);
    });

  // glowing project markers
  const markerData = countries.filter(d => state.byCountry.has(d.properties.name));
  const marks = gMark.selectAll('g')
    .data(markerData)
    .join('g')
    .attr('class', 'mark-group')
    .style('pointer-events', 'none');
  marks.append('circle').attr('class', 'marker-pulse');
  marks.append('circle').attr('class', 'marker-glow');
  marks.append('circle').attr('class', 'marker');

  // zoom / pan
  const zoom = d3.zoom()
    .scaleExtent([1, 9])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom).on('dblclick.zoom', null);

  mapRefs = { svg, g, path, projection, land, marks, zoom, stage };
  resizeMap();
  window.addEventListener('resize', debounce(resizeMap, 150));

  // entrance: stagger land fade
  gLand.selectAll('path')
    .style('opacity', 0)
    .transition().duration(700).delay((d, i) => Math.min(i * 1.4, 500))
    .style('opacity', 1);
}

function resizeMap() {
  if (!mapRefs) return;
  const { svg, projection, path, land, marks, stage } = mapRefs;
  const w = stage.clientWidth, h = stage.clientHeight;
  svg.attr('viewBox', `0 0 ${w} ${h}`);
  projection.fitExtent([[20, 20], [w - 20, h - 20]], { type: 'Sphere' });

  svg.selectAll('.sphere, .graticule').attr('d', path);
  land.attr('d', path);

  const r = Math.max(2.4, Math.min(w, h) * 0.006);
  marks.attr('transform', d => {
    const c = path.centroid(d);
    return `translate(${c[0]},${c[1]})`;
  });
  marks.select('.marker').attr('r', r);
  marks.select('.marker-glow').attr('r', r * 3.2);
  marks.select('.marker-pulse').attr('r', r * 1.6);
}

/* zoom toward a country, then reveal its view */
function zoomThenOpen(feature) {
  const { svg, path, zoom, stage } = mapRefs;
  const name = feature.properties.name;
  mapRefs.land.classed('is-hot', false);
  mapRefs.land.filter(d => d === feature).classed('is-hot', true);
  hideTip();

  const w = stage.clientWidth, h = stage.clientHeight;
  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  const dx = x1 - x0, dy = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const scale = Math.min(6, 0.55 / Math.max(dx / w, dy / h));
  const t = d3.zoomIdentity.translate(w / 2, h / 2).scale(scale).translate(-cx, -cy);

  svg.transition().duration(900).ease(d3.easeCubicInOut)
    .call(zoom.transform, t);

  // hand off to the country view partway through the zoom for a soft, overlapping transition
  setTimeout(() => openCountry(name, false), 620);
}

function showTip(x, y, html) {
  els.tooltip.innerHTML = html;
  els.tooltip.style.left = x + 'px';
  els.tooltip.style.top = y + 'px';
  els.tooltip.classList.add('show');
}
function hideTip() { els.tooltip.classList.remove('show'); }

/* ============================================================
   VIEW SWITCHING
   ============================================================ */
let switching = false;
function showView(name) {
  Object.entries(els.views).forEach(([k, el]) => {
    el.classList.toggle('view--active', k === name);
  });
}

function gotoMap() {
  showView('map');
  els.select.value = '';
  // reset zoom + highlight
  if (mapRefs) {
    mapRefs.land.classed('is-hot', false);
    mapRefs.svg.transition().duration(800).ease(d3.easeCubicInOut)
      .call(mapRefs.zoom.transform, d3.zoomIdentity);
  }
}

/* ============================================================
   COUNTRY (level 2)
   ============================================================ */
function openCountry(name, doZoom) {
  const c = state.byCountry.get(name);
  if (!c) return;
  if (switching && state.current.country === name) return;
  switching = true;
  state.current.country = name;
  state.current.filter = 'all';

  els.countryName.textContent = displayName(name);
  els.backCountryLabel.textContent = displayName(name);

  const types = countTypes(c.projects);
  els.countryMeta.textContent =
    `${c.projects.length} projects · ${types.size} types · sample data`;

  buildFilters(c);
  renderProjects(c, 'all');

  if (doZoom && mapRefs) {
    const f = state.features.find(d => d.properties.name === name);
    if (f) {
      const { svg, path, zoom, stage } = mapRefs;
      const w = stage.clientWidth, h = stage.clientHeight;
      const [[x0, y0], [x1, y1]] = path.bounds(f);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const scale = Math.min(6, 0.55 / Math.max((x1 - x0) / w, (y1 - y0) / h));
      svg.call(zoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(scale).translate(-cx, -cy));
    }
  }

  showView('country');
  setTimeout(() => { switching = false; }, 50);
}

function countTypes(projects) {
  return new Set(projects.map(p => p.type));
}

function buildFilters(c) {
  els.filters.innerHTML = '';
  const types = ['all', ...Array.from(countTypes(c.projects)).sort()];
  types.forEach(t => {
    const b = document.createElement('button');
    b.className = 'chip' + (t === 'all' ? ' active' : '');
    b.textContent = t === 'all' ? 'All projects' : t;
    b.addEventListener('click', () => {
      els.filters.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.current.filter = t;
      renderProjects(c, t);
    });
    els.filters.appendChild(b);
  });
}

function renderProjects(c, filter) {
  els.grid.innerHTML = '';
  const list = filter === 'all' ? c.projects : c.projects.filter(p => p.type === filter);

  list.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'card';
    const sc = STATUS_CLASS[p.status] || 'planned';
    card.innerHTML = `
      <div class="card__top">
        <span class="card__type">${p.type}</span>
        <span class="status status--${sc}">${p.status}</span>
      </div>
      <h3 class="card__name">${p.name}</h3>
      <div class="card__cap"><b>${p.capacity}</b><span>capacity</span></div>
      <div class="card__foot">
        <span class="status">${p.location}</span>
        <span class="card__arrow">→</span>
      </div>`;
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
    });
    card.addEventListener('click', () => openProject(c.name, p.id));
    els.grid.appendChild(card);
    // staggered entrance
    requestAnimationFrame(() => setTimeout(() => card.classList.add('in'), i * 55));
  });
}

/* ============================================================
   PROJECT DETAIL (level 3)
   ============================================================ */
function openProject(countryName, projectId) {
  const c = state.byCountry.get(countryName);
  const p = c.projects.find(x => x.id === projectId);
  if (!p) return;

  const sc = STATUS_CLASS[p.status] || 'planned';
  els.detail.innerHTML = `
    <div class="detail__inner">
      <div class="detail__type">${p.type}</div>
      <h1 class="detail__title">${p.name}</h1>
      <div class="detail__where">
        <span>${p.location}, ${displayName(countryName)}</span>
        <span class="status status--${sc}">${p.status}</span>
      </div>
      <p class="detail__desc">${p.description}</p>
      <div class="stats">
        ${stat('Capacity', p.capacity)}
        ${stat('Primary output', p.output, true)}
        ${stat('Operator', p.operator, true)}
        ${stat('First production', p.year)}
      </div>
      <p class="detail__note">${state.data.meta.disclaimer}</p>
    </div>`;
  els.detail.scrollTop = 0;
  showView('project');
}

function stat(label, value, small) {
  return `<div class="stat">
    <div class="stat__label">${label}</div>
    <div class="stat__value${small ? ' small' : ''}">${value}</div>
  </div>`;
}

/* ============================================================
   NAV WIRING
   ============================================================ */
function wireNav() {
  document.querySelectorAll('[data-target="map"]').forEach(b =>
    b.addEventListener('click', gotoMap));
  document.getElementById('back-to-country').addEventListener('click', () => {
    if (state.current.country) openCountry(state.current.country, false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (els.views.project.classList.contains('view--active')) {
      openCountry(state.current.country, false);
    } else if (els.views.country.classList.contains('view--active')) {
      gotoMap();
    }
  });
}

/* ---------- util ---------- */
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
