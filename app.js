// app.js
// Backlog Atlas — Personal Game Backlog Tracker (Single-user, LocalStorage)
// SPA with hash-based routing, sorting/filtering, tag system, details view, and import/export.

(() => {
  'use strict';

  // ========== CONSTANTS ==========
  const LS_KEYS = {
    games: 'ba.games',
    tags: 'ba.tags',
    prefs: 'ba.prefs',
  };

  const PLATFORMS = [
    '3DS', 'GCN', 'iOS', 'NDS', 'PC', 'PS3', 'PS4', 'PS5', 'Switch', 'Switch 2', 'Wii'
  ];

  const STATUSES = [
    'Unplayed', 'In Progress', 'Paused', 'Played', 'Abandoned', 'Continuous'
  ];
  const STATUS_ORDER = Object.fromEntries(STATUSES.map((s, i) => [s, i]));

  const PLAYTIMES = [
    'Quick (0-10 hours)',
    'Short (10-20 hours)',
    'Average (20-40 hours)',
    'Long (40-60 hours)',
    'Very Long (60-100 hours)',
    'Marathon (100+ hours)'
  ];
  const PLAYTIME_ORDER = Object.fromEntries(PLAYTIMES.map((p, i) => [p, i]));

  const PLACEHOLDER_COVER = (title = 'Cover') =>
    `https://placehold.co/600x900/0b1220/9aa3b2?text=${encodeURIComponent(title)}`;

  const DEFAULT_PREFS = {
    theme: 'system', // 'system' | 'light' | 'dark'
    sortField: 'title',
    sortDir: 'asc', // 'asc' | 'desc'
    view: 'grid', // 'grid' | 'list'
    filters: { platforms: [], statuses: [], playtimes: [], tags: [], favoritesOnly: false },
    search: '',
    lastRoute: '/games',
    samplesOffered: false,
    samplesLoaded: false
  };

  // ========== UTILITIES ==========
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = () => Date.now();
  const fmtDate = (iso) => {
    if (!iso) return 'Unknown';
    const d = new Date(iso);
    if (isNaN(d)) return 'Unknown';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const debounce = (fn, delay = 250) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), delay);
    };
  };
  const lightenColor = (hex, amount = 0.85) => {
    // amount: 0..1 mix with white
    try {
      let h = hex.replace('#', '');
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const num = parseInt(h, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      const nr = Math.round(r + (255 - r) * amount);
      const ng = Math.round(g + (255 - g) * amount);
      const nb = Math.round(b + (255 - b) * amount);
      return `rgb(${nr}, ${ng}, ${nb})`;
    } catch { return hex; }
  };
  const randomPastel = () => {
    const hue = Math.floor(Math.random() * 360);
    return hslToHex(hue, 70, 75);
  };
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  // ========== STORAGE LAYER ==========
  const Storage = {
    getGames() {
      const parsed = safeParse(localStorage.getItem(LS_KEYS.games), []);
      return Array.isArray(parsed) ? parsed : [];
    },
    setGames(games) {
      localStorage.setItem(LS_KEYS.games, JSON.stringify(games));
    },
    getTags() {
      const parsed = safeParse(localStorage.getItem(LS_KEYS.tags), []);
      return Array.isArray(parsed) ? parsed : [];
    },
    setTags(tags) {
      localStorage.setItem(LS_KEYS.tags, JSON.stringify(tags));
    },
    getPrefs() {
      const saved = safeParse(localStorage.getItem(LS_KEYS.prefs), null);
      if (!saved || typeof saved !== 'object') return { ...DEFAULT_PREFS };
      // Merge defaults for any newly introduced keys
      return { ...DEFAULT_PREFS, ...saved, filters: { ...DEFAULT_PREFS.filters, ...(saved.filters || {}) } };
    },
    setPrefs(prefs) {
      localStorage.setItem(LS_KEYS.prefs, JSON.stringify(prefs));
    },
    exportData() {
      return JSON.stringify({
        schema: 1,
        exportedAt: new Date().toISOString(),
        games: this.getGames(),
        tags: this.getTags(),
        prefs: this.getPrefs()
      }, null, 2);
    },
    async importData(json) {
      const data = safeParse(json, null);
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON');
      if (!Array.isArray(data.games) || !Array.isArray(data.tags)) throw new Error('Missing arrays');
      // Basic validation/sanitization
      const games = data.games.map(sanitizeGame).filter(Boolean);
      const tags = data.tags.map(sanitizeTag).filter(Boolean);
      const prefs = { ...DEFAULT_PREFS, ...(data.prefs || {}) };
      localStorage.setItem(LS_KEYS.games, JSON.stringify(games));
      localStorage.setItem(LS_KEYS.tags, JSON.stringify(tags));
      localStorage.setItem(LS_KEYS.prefs, JSON.stringify(prefs));
    },
    reset() {
      localStorage.removeItem(LS_KEYS.games);
      localStorage.removeItem(LS_KEYS.tags);
      localStorage.removeItem(LS_KEYS.prefs);
    }
  };

  function sanitizeGame(g) {
    if (!g || typeof g !== 'object') return null;
    return {
      id: g.id || uid(),
      title: String(g.title || '').trim().slice(0, 300),
      platform: PLATFORMS.includes(g.platform) ? g.platform : 'PC',
      releaseDate: g.releaseDate || '',
      status: STATUSES.includes(g.status) ? g.status : 'Unplayed',
      playtime: PLAYTIMES.includes(g.playtime) ? g.playtime : 'Average (20-40 hours)',
      tagIds: Array.isArray(g.tagIds) ? g.tagIds.filter(Boolean) : [],
      notes: typeof g.notes === 'string' ? g.notes : '',
      favorite: !!g.favorite,
      imageUrl: typeof g.imageUrl === 'string' ? g.imageUrl : '',
      dateAdded: Number.isFinite(g.dateAdded) ? g.dateAdded : now(),
      dateUpdated: Number.isFinite(g.dateUpdated) ? g.dateUpdated : now()
    };
  }
  function sanitizeTag(t) {
    if (!t || typeof t !== 'object') return null;
    const name = String(t.name || '').trim().slice(0, 60);
    if (!name) return null;
    return {
      id: t.id || uid(),
      name,
      color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.color || '') ? t.color : randomPastel(),
      emoji: (t.emoji || '').slice(0, 2)
    };
  }
  function safeParse(str, fallback) {
    // Ensure missing keys or empty strings return fallback, not null
    if (str == null || str === '') return fallback;
    try {
      const v = typeof str === 'string' ? JSON.parse(str) : JSON.parse(String(str));
      return (v == null ? fallback : v);
    } catch {
      return fallback;
    }
  }

  // ========== STATE ==========
  const state = {
    games: [],
    tags: [],
    prefs: { ...DEFAULT_PREFS },
    filtersWorking: null, // temp staging filter values while panel open
    currentRoute: { path: '/games', param: null },
    formDraft: null, // temp cache when navigating away
    quickMenuOpenFor: null
  };

  // ========== DOM REFERENCES ==========
  const refs = {
    // header
    homeBtn: $('#homeBtn'),
    addGameBtn: $('#addGameBtn'),
    filterToggleBtn: $('#filterToggleBtn'),
    themeToggleBtn: $('#themeToggleBtn'),
    tagsBtn: $('#tagsBtn'),
    settingsBtn: $('#settingsBtn'),
    globalSearch: $('#globalSearch'),
    clearSearchBtn: $('#clearSearchBtn'),

    // toolbar
    sortField: $('#sortField'),
    sortDirBtn: $('#sortDirBtn'),
    viewGridBtn: $('#viewGridBtn'),
    viewListBtn: $('#viewListBtn'),
    gamesCount: $('#gamesCount'),
    activeFiltersSummary: $('#activeFiltersSummary'),

    // filters panel
    filtersPanel: $('#filtersPanel'),
    filterPlatforms: $('#filterPlatforms'),
    filterStatuses: $('#filterStatuses'),
    filterPlaytimes: $('#filterPlaytimes'),
    filterTags: $('#filterTags'),
    filterFavoritesOnly: $('#filterFavoritesOnly'),
    clearFiltersBtn: $('#clearFiltersBtn'),
    applyFiltersBtn: $('#applyFiltersBtn'),

    // main views
    viewGames: $('#view-games'),
    gamesContainer: $('#gamesContainer'),
    emptyState: $('#emptyState'),
    emptyAddBtn: $('#emptyAddBtn'),
    gameCardTemplate: $('#gameCardTemplate'),

    quickActionsMenu: $('#quickActionsMenu'),

    // details view
    viewDetails: $('#view-details'),
    detailsFavBtn: $('#detailsFavBtn'),
    editGameBtn: $('#editGameBtn'),
    detailsCover: $('#detailsCover'),
    detailsRibbon: $('#detailsRibbon'),
    detailsTitle: $('#detailsTitle'),
    detailsPlatform: $('#detailsPlatform'),
    detailsReleaseDate: $('#detailsReleaseDate'),
    detailsStatus: $('#detailsStatus'),
    detailsPlaytime: $('#detailsPlaytime'),
    detailsTags: $('#detailsTags'),
    detailsStatusSelect: $('#detailsStatusSelect'),
    detailsSaveStatusBtn: $('#detailsSaveStatusBtn'),
    detailsNotes: $('#detailsNotes'),
    saveNotesBtn: $('#saveNotesBtn'),
    notesSavedIndicator: $('#notesSavedIndicator'),

    // form view
    viewForm: $('#view-form'),
    gameForm: $('#gameForm'),
    formTitle: $('#formTitle'),
    titleInput: $('#titleInput'),
    platformSelect: $('#platformSelect'),
    releaseDateInput: $('#releaseDateInput'),
    statusSelect: $('#statusSelect'),
    playtimeSelect: $('#playtimeSelect'),
    tagQuickAdd: $('#tagQuickAdd'),
    tagOptions: $('#tagOptions'),
    tagSelected: $('#tagSelected'),
    manageTagsFromFormBtn: $('#manageTagsFromFormBtn'),
    notesInput: $('#notesInput'),
    favoriteInput: $('#favoriteInput'),
    imageUrlInput: $('#imageUrlInput'),
    imagePreview: $('#imagePreview'),
    cancelFormBtn: $('#cancelFormBtn'),
    fabAdd: $('#fabAdd'),

    // tags manager
    viewTags: $('#view-tags'),
    addTagBtn: $('#addTagBtn'),
    tagsList: $('#tagsList'),
    tagRowTemplate: $('#tagRowTemplate'),

    // settings
    viewSettings: $('#view-settings'),
    themeSelect: $('#themeSelect'),
    exportBtn: $('#exportBtn'),
    importBtn: $('#importBtn'),
    importFile: $('#importFile'),
    loadSamplesBtn: $('#loadSamplesBtn'),
    resetDataBtn: $('#resetDataBtn'),
    storageInfo: $('#storageInfo'),

    // misc
    toastContainer: $('#toastContainer'),
    confirmDialog: $('#confirmDialog'),
    confirmMessage: $('#confirmMessage'),
  };

  // ========== TOASTS ==========
  function toast(message, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    refs.toastContainer.appendChild(el);
    const t = setTimeout(() => {
      el.classList.add('hide');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      el.remove(); // fallback
      clearTimeout(t);
    }, opts.duration || 1800);
  }

  // ========== CONFIRM DIALOG ==========
  function confirmDialog(message, { okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
    // Fallback for browsers without <dialog> support
    if (!refs.confirmDialog || typeof refs.confirmDialog.showModal !== 'function') {
      const ok = window.confirm(message);
      return Promise.resolve(ok);
    }
    refs.confirmMessage.textContent = message;
    const okBtn = refs.confirmDialog.querySelector('button.btn.danger') || refs.confirmDialog.querySelector('button[value="ok"]');
    if (okBtn) okBtn.classList.toggle('danger', !!danger);
    return new Promise(resolve => {
      refs.confirmDialog.returnValue = 'cancel';
      refs.confirmDialog.showModal();
      refs.confirmDialog.addEventListener('close', function handler() {
        refs.confirmDialog.removeEventListener('close', handler);
        resolve(refs.confirmDialog.returnValue === 'ok');
      }, { once: true });
    });
  }

  // ========== ROUTER ==========
  function parseHash() {
    let hash = location.hash.slice(1);
    if (!hash) return { path: '/games', param: null };
    const parts = hash.split('/').filter(Boolean);
    const path = `/${parts[0] || 'games'}`;
    const param = parts[1] || null;
    return { path, param };
  }

  function go(path) {
    if (!path.startsWith('#')) location.hash = `#${path}`;
    else location.hash = path;
  }

  function route() {
    state.currentRoute = parseHash();
    const { path, param } = state.currentRoute;
    // Hide all routes
    $$('.route').forEach(s => s.hidden = true);
    switch (path) {
      case '/games':
        refs.viewGames.hidden = false;
        // Save last route
        state.prefs.lastRoute = '/games';
        savePrefs();
        renderGames();
        refs.viewGames.focus();
        break;
      case '/game':
        refs.viewDetails.hidden = false;
        if (!param) { go('/games'); break; }
        renderDetails(param);
        refs.viewDetails.focus();
        break;
      case '/form':
        refs.viewForm.hidden = false;
        renderForm(param || null);
        refs.viewForm.focus();
        break;
      case '/tags':
        refs.viewTags.hidden = false;
        renderTagsManager();
        refs.viewTags.focus();
        break;
      case '/settings':
        refs.viewSettings.hidden = false;
        renderSettings();
        refs.viewSettings.focus();
        break;
      default:
        go('/games');
    }
    // Close quick menu and filters when navigating
    hideQuickMenu();
    closeFiltersPanel();
  }

  // ========== INIT ==========
  function init() {
    // Load state
    state.games = Storage.getGames().map(sanitizeGame);
    state.tags = Storage.getTags().map(sanitizeTag);
    state.prefs = Storage.getPrefs();

    // Populate static selects
    populateSelect(refs.platformSelect, PLATFORMS);
    populateSelect(refs.statusSelect, STATUSES);
    populateSelect(refs.playtimeSelect, PLAYTIMES);
    populateSelect(refs.detailsStatusSelect, STATUSES);

    // Apply prefs to UI
    refs.sortField.value = state.prefs.sortField;
    refs.sortDirBtn.dataset.dir = state.prefs.sortDir;
    syncSortDirBtnIcon();
    setViewMode(state.prefs.view);
    refs.globalSearch.value = state.prefs.search || '';
    refs.themeSelect.value = state.prefs.theme;
    applyTheme(state.prefs.theme);

    // Filters UI initial render
    buildFiltersUIFromPrefs();

    // Event listeners
    attachGlobalEvents();
    attachListEvents();
    attachDetailsEvents();
    attachFormEvents();
    attachTagsManagerEvents();
    attachSettingsEvents();

    // Initial route
    window.addEventListener('hashchange', route);
    route();

    // Offer sample data on first run
    if (!state.prefs.samplesOffered && state.games.length === 0) {
      state.prefs.samplesOffered = true;
      savePrefs();
      offerSamples();
    }

    updateStorageInfo();
  }

  function offerSamples() {
    confirmDialog('Load sample data to explore Backlog Atlas?', { danger: false }).then(yes => {
      if (yes) {
        loadSampleData();
        toast('Sample data loaded');
        go('/games');
      }
    });
  }

  // ========== THEME ==========
  function applyTheme(theme) {
    const html = document.documentElement;
    html.removeAttribute('data-theme');
    if (theme === 'light') html.setAttribute('data-theme', 'light');
    else if (theme === 'dark') html.setAttribute('data-theme', 'dark');
    // Toggle icon
    const use = refs.themeToggleBtn.querySelector('use');
    if (!use) return;
    if (theme === 'dark') use.setAttribute('href', '#icon-moon');
    else use.setAttribute('href', '#icon-sun');
  }

  function toggleTheme() {
    const cur = state.prefs.theme;
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    state.prefs.theme = next;
    savePrefs();
    applyTheme(next);
    toast(`Theme: ${next}`);
    refs.themeSelect.value = next;
  }

  // ========== FILTERS UI ==========
  function buildFiltersUIFromPrefs() {
    // When (re)opening the panel, clone prefs.filters to working set
    state.filtersWorking = JSON.parse(JSON.stringify(state.prefs.filters));
    // Build chip groups
    renderFilterChips(refs.filterPlatforms, PLATFORMS, state.filtersWorking.platforms, 'platform');
    renderFilterChips(refs.filterStatuses, STATUSES, state.filtersWorking.statuses, 'status');
    renderFilterChips(refs.filterPlaytimes, PLAYTIMES, state.filtersWorking.playtimes, 'playtime');
    renderFilterTagChips();
    refs.filterFavoritesOnly.checked = !!state.filtersWorking.favoritesOnly;
    updateActiveFiltersSummary();
  }

  function openFiltersPanel() {
    buildFiltersUIFromPrefs(); // ensure chips reflect current prefs
    refs.filtersPanel.hidden = false;
    refs.filterToggleBtn.setAttribute('aria-expanded', 'true');
  }
  function closeFiltersPanel() {
    refs.filtersPanel.hidden = true;
    refs.filterToggleBtn.setAttribute('aria-expanded', 'false');
  }

  function renderFilterChips(container, items, selected, type) {
    container.innerHTML = '';
    items.forEach(val => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip button';
      chip.textContent = val;
      chip.setAttribute('data-type', type);
      chip.setAttribute('data-value', val);
      if (selected.includes(val)) chip.classList.add('active');
      chip.addEventListener('click', () => {
        const arr = state.filtersWorking[`${type}s`]; // platforms|statuses|playtimes
        const idx = arr.indexOf(val);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(val);
        chip.classList.toggle('active');
      });
      container.appendChild(chip);
    });
  }

  function renderFilterTagChips() {
    const container = refs.filterTags;
    container.innerHTML = '';
    state.tags.forEach(tag => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip button tag';
      chip.setAttribute('data-type', 'tag');
      chip.setAttribute('data-id', tag.id);
      chip.style.borderColor = tag.color;
      chip.style.backgroundColor = lightenColor(tag.color, 0.9);

      const emoji = document.createElement('span');
      emoji.className = 'emoji';
      emoji.textContent = tag.emoji || '🏷️';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = tag.name;

      chip.appendChild(emoji);
      chip.appendChild(name);

      if (state.filtersWorking.tags.includes(tag.id)) chip.classList.add('active');
      chip.addEventListener('click', () => {
        const arr = state.filtersWorking.tags;
        const idx = arr.indexOf(tag.id);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(tag.id);
        chip.classList.toggle('active');
      });

      container.appendChild(chip);
    });
  }

  function applyFiltersFromWorking() {
    state.prefs.filters = JSON.parse(JSON.stringify(state.filtersWorking));
    savePrefs();
    updateActiveFiltersSummary();
    renderGames();
    closeFiltersPanel();
  }

  function clearFiltersWorking() {
    state.filtersWorking = { platforms: [], statuses: [], playtimes: [], tags: [], favoritesOnly: false };
    buildFiltersUIFromPrefs();
  }

  function updateActiveFiltersSummary() {
    const f = state.prefs.filters;
    const parts = [];
    if (f.platforms.length) parts.push(`Platform: ${f.platforms.join(', ')}`);
    if (f.statuses.length) parts.push(`Status: ${f.statuses.join(', ')}`);
    if (f.playtimes.length) parts.push(`Playtime: ${f.playtimes.length} selected`);
    if (f.tags.length) {
      const names = f.tags.map(id => state.tags.find(t => t.id === id)?.name || 'Unknown');
      parts.push(`Tags: ${names.join(', ')}`);
    }
    if (f.favoritesOnly) parts.push('Favorites only');
    if (state.prefs.search) parts.push(`Search: “${state.prefs.search}”`);
    refs.activeFiltersSummary.textContent = parts.length ? parts.join(' • ') : 'No filters';
  }

  // ========== SORT / VIEW ==========
  function setViewMode(mode) {
    state.prefs.view = mode;
    savePrefs();
    if (mode === 'grid') {
      refs.viewGridBtn.setAttribute('aria-pressed', 'true');
      refs.viewListBtn.setAttribute('aria-pressed', 'false');
      refs.gamesContainer.classList.add('grid');
      refs.gamesContainer.classList.remove('list');
    } else {
      refs.viewGridBtn.setAttribute('aria-pressed', 'false');
      refs.viewListBtn.setAttribute('aria-pressed', 'true');
      refs.gamesContainer.classList.remove('grid');
      refs.gamesContainer.classList.add('list');
    }
  }

  function syncSortDirBtnIcon() {
    const use = refs.sortDirBtn.querySelector('use');
    if (!use) return;
    // We reuse same icon, just update aria and data
    refs.sortDirBtn.title = state.prefs.sortDir === 'asc' ? 'Ascending' : 'Descending';
  }

  // ========== GAMES LIST RENDERING ==========
  function renderGames() {
    const filtered = getFilteredGames();
    const sorted = sortGames(filtered, state.prefs.sortField, state.prefs.sortDir);
    refs.gamesContainer.innerHTML = '';

    if (sorted.length === 0) {
      refs.gamesCount.textContent = '0';
      refs.emptyState.hidden = false;
      const titleEl = refs.emptyState.querySelector('h2');
      const descEl = refs.emptyState.querySelector('p');
      if (state.games.length === 0) {
        titleEl.textContent = 'No games yet';
        descEl.textContent = 'Add your first game to start tracking your backlog.';
      } else {
        titleEl.textContent = 'No results';
        descEl.textContent = 'Try clearing filters or adjusting your search.';
      }
      return;
    } else {
      refs.emptyState.hidden = true;
    }

    const frag = document.createDocumentFragment();
    const tpl = refs.gameCardTemplate.content;

    sorted.forEach(game => {
      const card = tpl.cloneNode(true);
      const art = card.querySelector('.cover img');
      const a = card.querySelector('.cover-link');
      const ribbon = card.querySelector('.ribbon');
      const favBtn = card.querySelector('.fav-btn');
      const title = card.querySelector('.title');
      const platform = card.querySelector('.platform-badge');
      const statusChip = card.querySelector('.status-chip');
      const playtimeChip = card.querySelector('.playtime-chip');
      const tagsRow = card.querySelector('.tags-row');
      const moreBtn = card.querySelector('.more-btn');

      a.href = `#/game/${game.id}`;

      setImage(art, game.imageUrl || PLACEHOLDER_COVER(game.title), `Cover art for ${game.title}`);
      art.addEventListener('error', () => {
        setImage(art, PLACEHOLDER_COVER(game.title));
      });

      ribbon.dataset.status = game.status;
      ribbon.textContent = game.status;
      title.textContent = game.title;
      platform.textContent = game.platform;

      statusChip.textContent = game.status;
      statusChip.classList.add('status-chip');
      statusChip.dataset.status = game.status;

      playtimeChip.textContent = game.playtime;
      playtimeChip.classList.add('playtime-chip');

      // Tags
      tagsRow.innerHTML = '';
      const tagMap = getTagMap();
      (game.tagIds || []).map(id => tagMap.get(id)).filter(Boolean).forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.style.borderColor = tag.color;
        chip.style.backgroundColor = lightenColor(tag.color, 0.92);
        const e = document.createElement('span');
        e.className = 'emoji';
        e.textContent = tag.emoji || '🏷️';
        const n = document.createElement('span');
        n.className = 'name';
        n.textContent = tag.name;
        chip.appendChild(e);
        chip.appendChild(n);
        tagsRow.appendChild(chip);
      });

      // Favorite
      favBtn.setAttribute('aria-pressed', String(!!game.favorite));
      if (game.favorite) favBtn.closest('.game-card')?.classList.add('favorited');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleFavorite(game.id);
      });

      // Quick actions
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showQuickMenuFor(game.id, moreBtn);
      });

      frag.appendChild(card);
    });

    refs.gamesContainer.appendChild(frag);
    refs.gamesCount.textContent = String(sorted.length);
  }

  function getFilteredGames() {
    const f = state.prefs.filters;
    const q = (state.prefs.search || '').trim().toLowerCase();
    const tagMap = getTagMap();

    return state.games.filter(g => {
      if (f.platforms.length && !f.platforms.includes(g.platform)) return false;
      if (f.statuses.length && !f.statuses.includes(g.status)) return false;
      if (f.playtimes.length && !f.playtimes.includes(g.playtime)) return false;
      if (f.tags.length && !g.tagIds?.some(id => f.tags.includes(id))) return false;
      if (f.favoritesOnly && !g.favorite) return false;
      if (q) {
        const hay = [
          g.title,
          g.notes,
          ...((g.tagIds || []).map(id => tagMap.get(id)?.name || ''))
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sortGames(arr, field, dir) {
    const mul = dir === 'desc' ? -1 : 1;
    return arr.slice().sort((a, b) => {
      let va, vb;
      switch (field) {
        case 'title':
          va = a.title.toLowerCase(); vb = b.title.toLowerCase();
          return mul * va.localeCompare(vb);
        case 'releaseDate':
          va = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
          vb = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
          return mul * (va - vb);
        case 'platform':
          va = PLATFORMS.indexOf(a.platform); vb = PLATFORMS.indexOf(b.platform);
          return mul * (va - vb);
        case 'status':
          va = STATUS_ORDER[a.status] ?? 0; vb = STATUS_ORDER[b.status] ?? 0;
          return mul * (va - vb);
        case 'playtime':
          va = PLAYTIME_ORDER[a.playtime] ?? 0; vb = PLAYTIME_ORDER[b.playtime] ?? 0;
          return mul * (va - vb);
        case 'dateAdded':
          va = a.dateAdded || 0; vb = b.dateAdded || 0;
          return mul * (va - vb);
        case 'dateUpdated':
          va = a.dateUpdated || 0; vb = b.dateUpdated || 0;
          return mul * (va - vb);
        case 'favorite':
          va = a.favorite ? 1 : 0; vb = b.favorite ? 1 : 0;
          return mul * (va - vb);
        default:
          return 0;
      }
    });
  }

  // ========== QUICK ACTIONS MENU ==========
  function showQuickMenuFor(gameId, anchorBtn) {
    const menu = refs.quickActionsMenu;
    state.quickMenuOpenFor = gameId;
    // Position
    const rect = anchorBtn.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 200)}px`;
    menu.style.top = `${rect.bottom + 6 + window.scrollY}px`;
    menu.hidden = false;

    const onDocClick = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        hideQuickMenu();
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') hideQuickMenu();
    };
    document.addEventListener('click', onDocClick, { once: true });
    window.addEventListener('scroll', hideQuickMenu, { once: true });
    document.addEventListener('keydown', onEsc, { once: true });

    menu.onclick = (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      handleQuickAction(gameId, action);
      hideQuickMenu();
    };
  }
  function hideQuickMenu() {
    refs.quickActionsMenu.hidden = true;
    state.quickMenuOpenFor = null;
  }
  function handleQuickAction(gameId, action) {
    const g = state.games.find(g => g.id === gameId);
    if (!g) return;
    if (action === 'cycleStatus') {
      const idx = (STATUS_ORDER[g.status] ?? 0);
      const next = STATUSES[(idx + 1) % STATUSES.length];
      updateGame(gameId, { status: next });
      toast(`Status: ${next}`);
    } else if (action === 'markPlayed') {
      updateGame(gameId, { status: 'Played' });
      toast('Marked Played');
    } else if (action === 'toggleFavorite') {
      updateGame(gameId, { favorite: !g.favorite });
      toast(g.favorite ? 'Removed Favorite' : 'Favorited');
    } else if (action === 'edit') {
      go(`#/form/${gameId}`);
    } else if (action === 'delete') {
      confirmDialog(`Delete “${g.title}”? This action cannot be undone.`, { danger: true }).then(yes => {
        if (!yes) return;
        deleteGame(gameId);
        toast('Game deleted');
      });
    }
  }

  // ========== IMAGE HELPERS ==========
  function setImage(imgEl, src, alt = '') {
    imgEl.src = src || '';
    imgEl.alt = alt;
  }

  // ========== DETAILS VIEW ==========
  function renderDetails(id) {
    const g = state.games.find(x => x.id === id);
    if (!g) { toast('Game not found'); go('/games'); return; }

    setImage(refs.detailsCover, g.imageUrl || PLACEHOLDER_COVER(g.title), `Cover art: ${g.title}`);
    refs.detailsCover.onerror = () => setImage(refs.detailsCover, PLACEHOLDER_COVER(g.title), `Cover art: ${g.title}`);
    refs.detailsRibbon.dataset.status = g.status;
    refs.detailsRibbon.textContent = g.status;

    refs.detailsTitle.textContent = g.title;
    refs.detailsPlatform.textContent = g.platform;
    refs.detailsReleaseDate.textContent = fmtDate(g.releaseDate);
    refs.detailsStatus.textContent = g.status;
    refs.detailsStatus.dataset.status = g.status;
    refs.detailsPlaytime.textContent = g.playtime;

    // Tags
    const tagMap = getTagMap();
    refs.detailsTags.innerHTML = '';
    g.tagIds?.map(id => tagMap.get(id)).filter(Boolean).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.style.borderColor = tag.color;
      chip.style.backgroundColor = lightenColor(tag.color, 0.9);
      const e = document.createElement('span'); e.className = 'emoji'; e.textContent = tag.emoji || '🏷️';
      const n = document.createElement('span'); n.className = 'name'; n.textContent = tag.name;
      chip.append(e, n);
      refs.detailsTags.appendChild(chip);
    });

    // Favorite
    refs.detailsFavBtn.setAttribute('aria-pressed', String(!!g.favorite));
    refs.detailsFavBtn.onclick = () => {
      updateGame(id, { favorite: !g.favorite });
      renderDetails(id); // refresh detail
      toast(g.favorite ? 'Removed Favorite' : 'Favorited');
    };

    // Status quick select
    populateSelect(refs.detailsStatusSelect, STATUSES);
    refs.detailsStatusSelect.value = g.status;
    refs.detailsSaveStatusBtn.onclick = () => {
      const newStatus = refs.detailsStatusSelect.value;
      updateGame(id, { status: newStatus });
      renderDetails(id);
      toast(`Status: ${newStatus}`);
    };

    // Notes
    refs.detailsNotes.value = g.notes || '';
    setNotesSavedIndicator(true);

    // Create a single debounced saver per render
    const saveDebounced = debounce(() => {
      updateGame(id, { notes: refs.detailsNotes.value });
      setNotesSavedIndicator(true);
    }, 800);

    const saveNow = () => {
      updateGame(id, { notes: refs.detailsNotes.value });
      setNotesSavedIndicator(true);
      toast('Notes saved');
    };
    refs.saveNotesBtn.onclick = () => saveNow();
    refs.detailsNotes.oninput = () => {
      setNotesSavedIndicator(false);
      saveDebounced();
    };

    // Edit btn
    refs.editGameBtn.onclick = () => go(`#/form/${id}`);

    // Back buttons in this view (plus global handler)
    $$('.backBtn', refs.viewDetails).forEach(btn => {
      btn.onclick = () => history.length > 1 ? history.back() : go('/games');
    });
  }

  // debouncedNotesSave removed; per-render debouncer is defined inside renderDetails

  function setNotesSavedIndicator(saved) {
    refs.notesSavedIndicator.textContent = saved ? 'Saved' : 'Unsaved changes…';
    refs.notesSavedIndicator.classList.toggle('muted', saved);
  }

  // ========== FORM VIEW ==========
  let currentFormGameId = null;
  let selectedTagIds = new Set();

  function renderForm(id = null) {
    currentFormGameId = id;
    state.formDraft = null; // clear any cached draft if navigating in fresh
    // Populate options that can change (tags)
    renderFormTagOptions();

    if (id) {
      const g = state.games.find(x => x.id === id);
      if (!g) { toast('Game not found'); go('/games'); return; }
      refs.formTitle.textContent = `Edit Game`;
      refs.titleInput.value = g.title || '';
      refs.platformSelect.value = g.platform || 'PC';
      refs.releaseDateInput.value = g.releaseDate || '';
      refs.statusSelect.value = g.status || 'Unplayed';
      refs.playtimeSelect.value = g.playtime || 'Average (20-40 hours)';
      refs.notesInput.value = g.notes || '';
      refs.favoriteInput.checked = !!g.favorite;
      refs.imageUrlInput.value = g.imageUrl || '';
      setImage(refs.imagePreview, g.imageUrl || PLACEHOLDER_COVER(g.title), 'Cover preview');

      selectedTagIds = new Set(g.tagIds || []);
      renderFormSelectedTags();
    } else {
      refs.formTitle.textContent = 'Add Game';
      refs.gameForm.reset();
      selectedTagIds = new Set();
      setImage(refs.imagePreview, '');
      refs.tagQuickAdd.value = '';
      renderFormSelectedTags();
    }

    // Back buttons
    $$('.backBtn', refs.viewForm).forEach(btn => {
      btn.onclick = () => history.length > 1 ? history.back() : go('/games');
    });
  }

  function attachFormEvents() {
    refs.imageUrlInput.addEventListener('input', () => {
      const url = refs.imageUrlInput.value.trim();
      if (url) {
        setImage(refs.imagePreview, url, 'Cover preview');
        refs.imagePreview.onerror = () => setImage(refs.imagePreview, PLACEHOLDER_COVER(refs.titleInput.value || 'Cover'), 'Cover preview');
      } else {
        setImage(refs.imagePreview, '');
      }
    });

    refs.manageTagsFromFormBtn.addEventListener('click', () => {
      // Cache simple draft (so you don't lose typed fields)
      state.formDraft = collectFormData();
      go('#/tags');
    });

    refs.tagQuickAdd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = refs.tagQuickAdd.value.trim();
        if (!name) return;
        // Find existing tag by case-insensitive name
        let tag = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (!tag) {
          // Create new tag
          tag = { id: uid(), name, color: randomPastel(), emoji: '' };
          state.tags.push(tag);
          Storage.setTags(state.tags);
          renderFilterTagChips(); // keep filters list in sync
          toast(`Tag “${name}” created`);
        }
        selectedTagIds.add(tag.id);
        renderFormSelectedTags();
        renderFormTagOptions();
        refs.tagQuickAdd.value = '';
      }
    });

    refs.tagQuickAdd.addEventListener('input', () => {
      renderFormTagOptions(refs.tagQuickAdd.value.trim().toLowerCase());
    });

    refs.gameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = collectFormData();
      if (!data.title) {
        toast('Please enter a title');
        refs.titleInput.focus();
        return;
      }
      if (!PLATFORMS.includes(data.platform)) {
        toast('Please select a platform');
        refs.platformSelect.focus();
        return;
      }
      if (!STATUSES.includes(data.status)) {
        toast('Please select a status');
        refs.statusSelect.focus();
        return;
      }
      if (!PLAYTIMES.includes(data.playtime)) {
        toast('Please select a playtime');
        refs.playtimeSelect.focus();
        return;
      }

      if (currentFormGameId) {
        updateGame(currentFormGameId, {
          ...data,
          tagIds: Array.from(selectedTagIds)
        });
        toast('Game updated');
        go(`#/game/${currentFormGameId}`);
      } else {
        const newGame = {
          id: uid(),
          ...data,
          tagIds: Array.from(selectedTagIds),
          dateAdded: now(),
          dateUpdated: now()
        };
        state.games.push(newGame);
        Storage.setGames(state.games);
        toast('Game added');
        go(`#/game/${newGame.id}`);
      }
    });

    refs.cancelFormBtn.addEventListener('click', () => {
      history.length > 1 ? history.back() : go('/games');
    });

    // When returning from tags manager, restore draft if any
    window.addEventListener('hashchange', () => {
      const { path } = parseHash();
      if (path === '/form' && state.formDraft) {
        fillFormFromDraft(state.formDraft);
        state.formDraft = null;
      }
    });
  }

  function collectFormData() {
    return {
      title: refs.titleInput.value.trim(),
      platform: refs.platformSelect.value,
      releaseDate: refs.releaseDateInput.value,
      status: refs.statusSelect.value,
      playtime: refs.playtimeSelect.value,
      notes: refs.notesInput.value,
      favorite: !!refs.favoriteInput.checked,
      imageUrl: refs.imageUrlInput.value.trim()
    };
  }

  function fillFormFromDraft(draft) {
    refs.titleInput.value = draft.title || '';
    refs.platformSelect.value = draft.platform || 'PC';
    refs.releaseDateInput.value = draft.releaseDate || '';
    refs.statusSelect.value = draft.status || 'Unplayed';
    refs.playtimeSelect.value = draft.playtime || 'Average (20-40 hours)';
    refs.notesInput.value = draft.notes || '';
    refs.favoriteInput.checked = !!draft.favorite;
    refs.imageUrlInput.value = draft.imageUrl || '';
    setImage(refs.imagePreview, draft.imageUrl || '');
  }

  function renderFormTagOptions(filter = '') {
    refs.tagOptions.innerHTML = '';
    const normalized = filter.toLowerCase();
    state.tags
      .filter(t => !normalized || t.name.toLowerCase().includes(normalized) || (t.emoji || '').includes(normalized))
      .forEach(tag => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip button tag';
        chip.style.borderColor = tag.color;
        chip.style.backgroundColor = lightenColor(tag.color, 0.9);
        const e = document.createElement('span'); e.className = 'emoji'; e.textContent = tag.emoji || '🏷️';
        const n = document.createElement('span'); n.className = 'name'; n.textContent = tag.name;
        chip.append(e, n);
        if (selectedTagIds.has(tag.id)) chip.classList.add('active');
        chip.addEventListener('click', () => {
          if (selectedTagIds.has(tag.id)) selectedTagIds.delete(tag.id);
          else selectedTagIds.add(tag.id);
          renderFormSelectedTags();
          renderFormTagOptions(refs.tagQuickAdd.value.trim());
        });
        refs.tagOptions.appendChild(chip);
      });

    if (filter && refs.tagOptions.children.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.padding = '6px 4px';
      hint.textContent = `Press Enter to create “${filter}”`;
      refs.tagOptions.appendChild(hint);
    }
  }

  function renderFormSelectedTags() {
    refs.tagSelected.innerHTML = '';
    const tagMap = getTagMap();
    Array.from(selectedTagIds).map(id => tagMap.get(id)).filter(Boolean).forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'chip tag';
      chip.style.borderColor = tag.color;
      chip.style.backgroundColor = lightenColor(tag.color, 0.9);
      const e = document.createElement('span'); e.className = 'emoji'; e.textContent = tag.emoji || '🏷️';
      const n = document.createElement('span'); n.className = 'name'; n.textContent = tag.name;
      const x = document.createElement('button'); x.type = 'button'; x.className = 'icon-btn small'; x.title = 'Remove';
      x.innerHTML = `<svg class="icon"><use href="#icon-close"></use></svg>`;
      x.addEventListener('click', () => {
        selectedTagIds.delete(tag.id);
        renderFormSelectedTags();
        renderFormTagOptions(refs.tagQuickAdd.value.trim());
      });
      chip.append(e, n, x);
      refs.tagSelected.appendChild(chip);
    });
  }

  // ========== TAGS MANAGER ==========
  function renderTagsManager() {
    refs.tagsList.innerHTML = '';
    const tpl = refs.tagRowTemplate.content;
    state.tags.forEach(tag => {
      const row = tpl.cloneNode(true);
      const el = row.querySelector('.tag-row');
      el.dataset.id = tag.id;
      const color = el.querySelector('.tag-color');
      const name = el.querySelector('.tag-name');
      const emoji = el.querySelector('.tag-emoji');
      const saveBtn = el.querySelector('.save-tag');
      const deleteBtn = el.querySelector('.delete-tag');

      color.value = tag.color;
      name.value = tag.name;
      emoji.value = tag.emoji || '';

      saveBtn.addEventListener('click', () => {
        const newTag = {
          ...tag,
          color: color.value,
          name: name.value.trim() || 'Tag',
          emoji: emoji.value.trim()
        };
        updateTag(newTag);
        toast('Tag saved');
      });

      deleteBtn.addEventListener('click', () => {
        const usage = state.games.filter(g => g.tagIds?.includes(tag.id)).length;
        const msg = usage > 0
          ? `Delete tag “${tag.name}”? It’s used on ${usage} game(s). It will be removed from those games.`
          : `Delete tag “${tag.name}”?`;
        confirmDialog(msg, { danger: true }).then(yes => {
          if (!yes) return;
          deleteTag(tag.id);
          toast('Tag deleted');
          renderTagsManager();
        });
      });

      refs.tagsList.appendChild(row);
    });
  }

  function attachTagsManagerEvents() {
    refs.addTagBtn.addEventListener('click', () => {
      const newTag = { id: uid(), name: 'New Tag', color: randomPastel(), emoji: '' };
      state.tags.push(newTag);
      Storage.setTags(state.tags);
      renderTagsManager();
      renderFormTagOptions();
      renderFilterTagChips();
    });

    // Back button is handled globally by .backBtn listeners in each view via route()
    $$('.backBtn', refs.viewTags).forEach(btn => {
      btn.onclick = () => history.length > 1 ? history.back() : go('/games');
    });
  }

  function updateTag(updated) {
    const idx = state.tags.findIndex(t => t.id === updated.id);
    if (idx === -1) return;
    state.tags[idx] = sanitizeTag(updated);
    Storage.setTags(state.tags);
    renderFormTagOptions();
    renderFilterTagChips();
    // Also update games list to render new tag names/colors
    renderGames();
  }

  function deleteTag(id) {
    state.tags = state.tags.filter(t => t.id !== id);
    Storage.setTags(state.tags);
    // Remove from games
    state.games.forEach(g => {
      if (g.tagIds?.includes(id)) {
        g.tagIds = g.tagIds.filter(tid => tid !== id);
        g.dateUpdated = now();
      }
    });
    Storage.setGames(state.games);
    renderFormTagOptions();
    renderFilterTagChips();
    renderGames();
  }

  // ========== SETTINGS ==========
  function renderSettings() {
    refs.themeSelect.value = state.prefs.theme;
    updateStorageInfo();
  }

  function attachSettingsEvents() {
    refs.themeSelect.addEventListener('change', () => {
      state.prefs.theme = refs.themeSelect.value;
      savePrefs();
      applyTheme(state.prefs.theme);
      toast(`Theme: ${state.prefs.theme}`);
    });

    refs.exportBtn.addEventListener('click', () => {
      const data = Storage.exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `backlog-atlas-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    refs.importBtn.addEventListener('click', () => refs.importFile.click());
    refs.importFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ok = await confirmDialog('Importing will replace your current data. Continue?', { danger: true });
      if (!ok) return;
      try {
        await Storage.importData(text);
        // Reload state
        state.games = Storage.getGames();
        state.tags = Storage.getTags();
        state.prefs = Storage.getPrefs();
        applyTheme(state.prefs.theme);
        buildFiltersUIFromPrefs();
        renderGames();
        toast('Import complete');
        go('/games');
      } catch (err) {
        console.error(err);
        toast('Import failed: invalid file');
      } finally {
        refs.importFile.value = '';
        updateStorageInfo();
      }
    });

    refs.loadSamplesBtn.addEventListener('click', () => {
      confirmDialog('Load sample data? This adds examples without removing your current data.').then(ok => {
        if (!ok) return;
        loadSampleData(false);
        toast('Sample data loaded');
        renderGames();
        updateStorageInfo();
      });
    });

    refs.resetDataBtn.addEventListener('click', () => {
      confirmDialog('Reset ALL data? This cannot be undone.', { danger: true }).then(ok => {
        if (!ok) return;
        Storage.reset();
        // Fresh state
        state.games = [];
        state.tags = [];
        state.prefs = { ...DEFAULT_PREFS };
        savePrefs();
        applyTheme(state.prefs.theme);
        buildFiltersUIFromPrefs();
        renderGames();
        toast('All data reset');
        go('/games');
        updateStorageInfo();
      });
    });
  }

  function updateStorageInfo() {
    const sizes = [LS_KEYS.games, LS_KEYS.tags, LS_KEYS.prefs]
      .map(k => (localStorage.getItem(k) || '').length);
    const bytes = sizes.reduce((a, b) => a + b, 0);
    const kb = (bytes / 1024).toFixed(1);
    refs.storageInfo.textContent = `Storage: approx. ${kb} KB used • ${state.games.length} games • ${state.tags.length} tags`;
  }

  // ========== GLOBAL EVENTS ==========
  function attachGlobalEvents() {
    refs.homeBtn.addEventListener('click', () => go('/games'));
    refs.addGameBtn.addEventListener('click', () => go('/form'));
    refs.fabAdd.addEventListener('click', () => go('/form'));
    refs.emptyAddBtn.addEventListener('click', () => go('/form'));
    refs.tagsBtn.addEventListener('click', () => go('/tags'));
    refs.settingsBtn.addEventListener('click', () => go('/settings'));
    refs.themeToggleBtn.addEventListener('click', toggleTheme);

    // Search
    const onSearch = debounce(() => {
      state.prefs.search = refs.globalSearch.value.trim();
      savePrefs();
      updateActiveFiltersSummary();
      renderGames();
    }, 200);
    refs.globalSearch.addEventListener('input', onSearch);
    refs.clearSearchBtn.addEventListener('click', () => {
      refs.globalSearch.value = '';
      state.prefs.search = '';
      savePrefs();
      updateActiveFiltersSummary();
      renderGames();
      refs.globalSearch.focus();
    });

    // Sort
    refs.sortField.addEventListener('change', () => {
      state.prefs.sortField = refs.sortField.value;
      savePrefs();
      renderGames();
    });
    refs.sortDirBtn.addEventListener('click', () => {
      state.prefs.sortDir = state.prefs.sortDir === 'asc' ? 'desc' : 'asc';
      refs.sortDirBtn.dataset.dir = state.prefs.sortDir;
      savePrefs();
      syncSortDirBtnIcon();
      renderGames();
    });

    // View toggles
    refs.viewGridBtn.addEventListener('click', () => setViewMode('grid'));
    refs.viewListBtn.addEventListener('click', () => setViewMode('list'));

    // Filters
    refs.filterToggleBtn.addEventListener('click', () => {
      const open = refs.filtersPanel.hidden;
      if (open) openFiltersPanel(); else closeFiltersPanel();
    });
    refs.applyFiltersBtn.addEventListener('click', applyFiltersFromWorking);
    refs.clearFiltersBtn.addEventListener('click', () => {
      clearFiltersWorking();
      applyFiltersFromWorking();
    });
    refs.filterFavoritesOnly.addEventListener('change', () => {
      state.filtersWorking.favoritesOnly = !!refs.filterFavoritesOnly.checked;
    });

    // Generic back buttons in all views
    $$('.backBtn').forEach(btn => {
      btn.addEventListener('click', () => history.length > 1 ? history.back() : go('/games'));
    });
  }

  function attachListEvents() {
    // Delegated events are already attached per card in renderGames for fav/more.
  }

  function attachDetailsEvents() {
    // All handlers registered in renderDetails. Nothing global needed here.
  }

  // ========== GAME OPERATIONS ==========
  function updateGame(id, patch) {
    const idx = state.games.findIndex(g => g.id === id);
    if (idx === -1) return;
    const cur = state.games[idx];
    const next = { ...cur, ...patch, dateUpdated: now() };
    state.games[idx] = sanitizeGame(next);
    Storage.setGames(state.games);
    renderGames();
    updateStorageInfo();
  }

  function deleteGame(id) {
    state.games = state.games.filter(g => g.id !== id);
    Storage.setGames(state.games);
    renderGames();
    updateStorageInfo();
    // If deleting from details, go back
    const { path, param } = state.currentRoute;
    if (path === '/game' && param === id) {
      go('/games');
    }
  }

  function toggleFavorite(id) {
    const g = state.games.find(g => g.id === id);
    if (!g) return;
    updateGame(id, { favorite: !g.favorite });
    // details page button state is refreshed by renderDetails when active
  }

  // ========== HELPERS ==========
  function populateSelect(select, arr) {
    select.innerHTML = '';
    arr.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      select.appendChild(opt);
    });
  }

  function getTagMap() {
    return new Map(state.tags.map(t => [t.id, t]));
  }

  function savePrefs() {
    Storage.setPrefs(state.prefs);
  }

  // ========== SAMPLE DATA ==========
  function loadSampleData(clearFirst = true) {
    // Optional: don't clear existing; we will add if not present
    const samplesTags = [
      { id: uid(), name: 'JRPG', color: '#a78bfa', emoji: '🗡️' },
      { id: uid(), name: 'Co-op', color: '#34d399', emoji: '🤝' },
      { id: uid(), name: 'Indie', color: '#60a5fa', emoji: '🌱' },
      { id: uid(), name: 'Metroidvania', color: '#f59e0b', emoji: '🕹️' },
      { id: uid(), name: 'Backlog', color: '#94a3b8', emoji: '📚' }
    ];
    // Build tag map by name to stable ids
    const existingByName = new Map(state.tags.map(t => [t.name.toLowerCase(), t]));
    const ensuredTags = samplesTags.map(st => {
      const found = existingByName.get(st.name.toLowerCase());
      if (found) return found;
      state.tags.push(st);
      return st;
    });

    const tagIdByName = Object.fromEntries(ensuredTags.map(t => [t.name, t.id]));
    const nowTs = now();

    const samplesGames = [
      {
        title: 'Celestial Odyssey',
        platform: 'PC',
        releaseDate: '2023-06-02',
        status: 'In Progress',
        playtime: 'Average (20-40 hours)',
        tagIds: [tagIdByName['Indie'], tagIdByName['Backlog']],
        notes: 'Space-fantasy ARPG with stellar soundtrack.',
        favorite: true,
        imageUrl: PLACEHOLDER_COVER('Celestial Odyssey'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 15,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 1
      },
      {
        title: 'Dungeon Pals',
        platform: 'Switch',
        releaseDate: '2022-09-15',
        status: 'Played',
        playtime: 'Short (10-20 hours)',
        tagIds: [tagIdByName['Co-op']],
        notes: 'Beat it with a friend on local co-op.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Dungeon Pals'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 30,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 28
      },
      {
        title: 'Echoes of Aeterna',
        platform: 'PS5',
        releaseDate: '2024-05-10',
        status: 'Unplayed',
        playtime: 'Long (40-60 hours)',
        tagIds: [tagIdByName['JRPG'], tagIdByName['Backlog']],
        notes: 'Highly rated turn-based JRPG.',
        favorite: true,
        imageUrl: PLACEHOLDER_COVER('Echoes of Aeterna'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 7,
        dateUpdated: nowTs - 1000 * 60 * 60 * 3
      },
      {
        title: 'Metro Shade',
        platform: 'PS4',
        releaseDate: '2019-03-12',
        status: 'Paused',
        playtime: 'Average (20-40 hours)',
        tagIds: [tagIdByName['Metroidvania'], tagIdByName['Backlog']],
        notes: 'Paused at Chapter 4 boss. Consider lowering difficulty.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Metro Shade'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 60,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 20
      },
      {
        title: 'Island Run',
        platform: 'iOS',
        releaseDate: '2021-07-22',
        status: 'Continuous',
        playtime: 'Quick (0-10 hours)',
        tagIds: [tagIdByName['Indie']],
        notes: 'Perfect for short sessions. Season 3 ongoing.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Island Run'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 120,
        dateUpdated: nowTs - 1000 * 60 * 60 * 2
      },
      {
        title: 'Retro Kart GP',
        platform: 'Wii',
        releaseDate: '2008-04-10',
        status: 'Played',
        playtime: 'Short (10-20 hours)',
        tagIds: [tagIdByName['Co-op']],
        notes: 'Unlocked Mirror Mode. Great couch co-op.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Retro Kart GP'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 365,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 300
      },
      {
        title: 'Mystic Quest DX',
        platform: '3DS',
        releaseDate: '2016-10-30',
        status: 'Abandoned',
        playtime: 'Average (20-40 hours)',
        tagIds: [tagIdByName['JRPG']],
        notes: 'Got stuck on the desert temple puzzle.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Mystic Quest DX'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 200,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 170
      },
      {
        title: 'Pixel Detective',
        platform: 'NDS',
        releaseDate: '2010-02-18',
        status: 'In Progress',
        playtime: 'Short (10-20 hours)',
        tagIds: [tagIdByName['Indie'], tagIdByName['Backlog']],
        notes: 'Case 3 of 5. Charming pixel art.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Pixel Detective'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 40,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 2
      },
      {
        title: 'Galaxy Builder',
        platform: 'PC',
        releaseDate: '2020-11-05',
        status: 'In Progress',
        playtime: 'Marathon (100+ hours)',
        tagIds: [tagIdByName['Indie']],
        notes: 'Sandbox colony sim. Endless goals.',
        favorite: true,
        imageUrl: PLACEHOLDER_COVER('Galaxy Builder'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 400,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 1
      },
      {
        title: 'Snowbound Saga',
        platform: 'PS3',
        releaseDate: '2012-12-04',
        status: 'Unplayed',
        playtime: 'Long (40-60 hours)',
        tagIds: [tagIdByName['Backlog']],
        notes: 'Bought used; disc condition: good.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Snowbound Saga'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 10,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 10
      },
      {
        title: 'Starbound Stories 2',
        platform: 'Switch 2',
        releaseDate: '2025-03-21',
        status: 'Unplayed',
        playtime: 'Very Long (60-100 hours)',
        tagIds: [tagIdByName['JRPG'], tagIdByName['Backlog']],
        notes: 'Day-one patch recommended.',
        favorite: true,
        imageUrl: PLACEHOLDER_COVER('Starbound Stories 2'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 3,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 1
      },
      {
        title: 'Wave Racer Redux',
        platform: 'GCN',
        releaseDate: '2003-08-15',
        status: 'Played',
        playtime: 'Quick (0-10 hours)',
        tagIds: [tagIdByName['Co-op']],
        notes: 'Arcade vibes. Still holds up.',
        favorite: false,
        imageUrl: PLACEHOLDER_COVER('Wave Racer Redux'),
        dateAdded: nowTs - 1000 * 60 * 60 * 24 * 650,
        dateUpdated: nowTs - 1000 * 60 * 60 * 24 * 640
      }
    ];

    // Persist tags in case we added any
    Storage.setTags(state.tags);

    if (clearFirst) {
      state.games = samplesGames.map(sanitizeGame);
    } else {
      const existingKeys = new Set(state.games.map(g => `${g.title.toLowerCase()}|${g.platform}`));
      samplesGames.forEach(s => {
        const key = `${s.title.toLowerCase()}|${s.platform}`;
        if (!existingKeys.has(key)) {
          state.games.push(sanitizeGame(s));
          existingKeys.add(key);
        }
      });
    }

    Storage.setGames(state.games);
    state.prefs.samplesLoaded = true;
    savePrefs();
    buildFiltersUIFromPrefs();
    renderGames();
    updateStorageInfo();
  }

  // Override renderFilterChips to correct pluralization for "status" -> "statuses"
  // This supersedes the earlier definition via function hoisting.
  function renderFilterChips(container, items, selected, type) {
    container.innerHTML = '';
    const key = type === 'status' ? 'statuses'
              : type === 'platform' ? 'platforms'
              : type === 'playtime' ? 'playtimes'
              : `${type}s`;
    items.forEach(val => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip button';
      chip.textContent = val;
      chip.setAttribute('data-type', type);
      chip.setAttribute('data-value', val);
      if (selected.includes(val)) chip.classList.add('active');
      chip.addEventListener('click', () => {
        const arr = state.filtersWorking[key];
        const idx = arr.indexOf(val);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(val);
        chip.classList.toggle('active');
      });
      container.appendChild(chip);
    });
  }

  // Boot the app
  init();

})(); // end IIFE
