/* =========================
   Helpers
========================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const navLinks = $$('[data-view]');
const views = $$('.view');

let map;
let markersLayer;
let shops = [];

let lastFocusedElement = null;
let restoreFocusToPopupStar = false;
let restoreFocusToPopupClose = false;

let markerRefs = [];
let detailOpenedFromShopId = null;
let suppressNextPopupCloseFocus = false;

let popupClosedViaX = false;

// ===== Help-Function =====
function focusNextMarkerAfter(shopId) {
  const currentId = Number(shopId);
  const idx = markerRefs.findIndex(entry => Number(entry.shopId) === currentId);

  if (idx === -1 || markerRefs.length === 0) return;

  const nextEntry = markerRefs[idx + 1] || markerRefs[0];
  const nextIcon = nextEntry?.marker?._icon;

  if (nextIcon && typeof nextIcon.focus === 'function') {
    nextIcon.focus();
  }
}

// ===== TOP-DÖNER (global) =====
let topPollTimer = null;
let lastTopSignature = '';

function formatPriceEUR(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(2).replace('.', ',') + ' €';
}

const DEFAULT_SHOP_IMAGE = 'src/selfmade.jpg';

const HARDCODED_SHOP_IMAGES = {
  "Rüyam Gemüse Kebap": "src/ruyam.jpg",
  "Mustafa's Gemüse Kebap": "src/mustafas.jpg",
  "Oggi's Gemüsekebab": "src/oggis.jpg",
  "Zagros": "src/zagros.jpg",
  "Ehl-i Kebap by Et Dünyasi": "src/ehl-i.jpg",
  "Pamfilya": "src/pamfilya.jpg",
  "Ugur Imbiss": "src/ugur.jpg",
  "Muca Kebap": "src/muca.jpg",
  "k.bap Döner": "src/kbap.jpg",
  "Bistro Legende": "src/legende.jpg"
};

function getShopImage(shop) {
  if (!shop) return DEFAULT_SHOP_IMAGE;

  const isUser = (shop.is_user_created === 1) || (shop.is_user_created === "1");
  if (isUser) return DEFAULT_SHOP_IMAGE;

  return HARDCODED_SHOP_IMAGES[shop.name] || DEFAULT_SHOP_IMAGE;
}

function buildTopCard(shop) {
  let prices = [];
  try {
    prices = shop.prices_json ? JSON.parse(shop.prices_json) : [];
  } catch (_) {
    prices = [];
  }

  if (!Array.isArray(prices)) prices = [];

  const donerEntry = prices.find(p => {
    const label = String(p?.label || '').toLowerCase();
    return label === 'döner' || label === 'doener' || label === 'doner';
  });

  const durumEntry = prices.find(p => {
    const label = String(p?.label || '').toLowerCase();
    return label === 'dürüm' || label === 'durum';
  });

  const doner = donerEntry?.price ?? null;
  const durum = durumEntry?.price ?? null;

  const ratingText = (shop.rating ?? shop.rating === 0) ? `⭐ ${shop.rating}` : '⭐ —';
  const waitText = shop.wait_time ? `⏱ ${shop.wait_time}` : '⏱ —';

  return `
    <div class="flip-card">
      <div class="flip-card-inner">
        <div class="flip-card-front">
          <h3>${shop.name ?? 'Unbekannt'}</h3>
          <p>${ratingText}</p>
          <br>
          <p class="press-here">--hier klicken--</p>
        </div>
        <div class="flip-card-back">
          <p>Döner: ${formatPriceEUR(doner)}</p>
          <p>Dürüm: ${formatPriceEUR(durum)}</p>
          <p>${waitText}</p>
        </div>
      </div>
    </div>
  `;
}

function normalizePrices(prices) {
  if (!Array.isArray(prices)) return [];

  return prices
    .map(entry => {
      // Bereits korrektes Format: { label, price }
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const label = String(entry.label || '').trim();
        const priceNum = Number(
          String(entry.price ?? '')
            .replace(',', '.')
            .replace(/[^\d.]/g, '')
        );

        if (!label) return null;

        return {
          label,
          price: Number.isFinite(priceNum) ? priceNum : null
        };
      }

      // Altes String-Format: "Döner: 7,50 €"
      if (typeof entry === 'string') {
        const text = entry.trim();
        if (!text) return null;

        const match = text.match(/^(.+?)\s*[:\-]\s*([\d.,]+)\s*(?:€|eur)?$/i);

        if (match) {
          const label = match[1].trim();
          const priceNum = Number(match[2].replace(',', '.'));
          return {
            label,
            price: Number.isFinite(priceNum) ? priceNum : null
          };
        }

        return { label: text, price: null };
      }

      return null;
    })
    .filter(Boolean);
}

function parsePricesFromTextarea(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(.+?)\s*[:\-]\s*([\d.,]+)\s*(?:€|eur)?$/i);

      if (match) {
        return {
          label: match[1].trim(),
          price: Number(match[2].replace(',', '.'))
        };
      }

      return {
        label: line,
        price: null
      };
    });
}

async function loadTopDoner() {
  const grid = document.getElementById('topGrid');
  const hint = document.getElementById('topEmptyHint');
  if (!grid) return;

  try {
    const res = await fetch('http://localhost:3000/shops/top?limit=3');
    const data = await res.json();

    if (!res.ok) return;

    // Signatur zum "nur bei Änderung neu rendern"
    const sig = (data || [])
      .map(s => `${s.id}:${s.rating ?? 'null'}:${s.rating_count ?? 0}`)
      .join('|');

    if (sig === lastTopSignature) return;
    lastTopSignature = sig;

    if (!data || data.length === 0) {
      grid.innerHTML = '';
      if (hint) hint.classList.remove('hidden');
      return;
    }

    if (hint) hint.classList.add('hidden');
    grid.innerHTML = data.map(buildTopCard).join('');
    wireFlipCards(grid);
  } catch (e) {
    console.error(e);
  }
}

function startTopPolling() {
  stopTopPolling();
  loadTopDoner();
  topPollTimer = setInterval(loadTopDoner, 10000); 
}

function stopTopPolling() {
  if (topPollTimer) {
    clearInterval(topPollTimer);
    topPollTimer = null;
  }
}

// aktive Map-Popup-Referenz (für Live-Update von Stern & Rating)
let activePopupMarker = null;
let activePopupShopId = null;

const APP_SETTINGS_KEY = 'kebapmaps_app_settings_v1';

let vueApp = null;

function syncVueState(partial = {}) {
  if (!vueApp) return;
  if (Object.prototype.hasOwnProperty.call(partial, 'currentView')) vueApp.currentView = partial.currentView;
  if (Object.prototype.hasOwnProperty.call(partial, 'authButtonText')) vueApp.authButtonText = partial.authButtonText;
  if (Object.prototype.hasOwnProperty.call(partial, 'isLoggedIn')) vueApp.isLoggedIn = partial.isLoggedIn;
}

function mountVueApp() {
  if (!window.Vue || !document.getElementById('navApp')) return;

  const initialView = location.hash.replace('#', '') || 'home';

  vueApp = Vue.createApp({
    data() {
      return {
        currentView: initialView,
        authButtonText: 'Login',
        isLoggedIn: false
      };
    },
    methods: {
      navigateTo(view) {
        if (!view) return;
        showView(view);
        history.pushState({}, '', `#${view}`);
      },

      handleAuthClick() {
        if (!currentUser) {
          openAuthModal();
        }
      },

      handleSettingsClick() {
        if (currentUser) {
          openSettingsModal();
        }
      }
    }
  }).mount('#navApp');
}

function getAppSettings() {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function setAppSettings(obj) {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(obj || {}));
}

/* =========================
   AUTH + FAVORITES (Backend)
========================= */
const AUTH_TOKEN_KEY = 'kebapmaps_token_v1';
let authToken = null;
let currentUser = null;

// Favoriten-IDs aus Backend (pro User)
let favIds = [];

function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

function setAuth(token, user) {
  authToken = token || null;
  currentUser = user || null;

  // Kein Persistieren! (Reload = ausgeloggt)
  // localStorage wird bewusst nicht verwendet.

  updateNavAuthUI();
  syncVueState({
    authButtonText: currentUser ? currentUser.username : 'Login',
    isLoggedIn: !!currentUser
  });
  applyLoginGates();
}

function isFavorite(shopId) {
  return favIds.includes(Number(shopId));
}

async function loadFavoritesFromBackend() {
  if (!authToken) {
    favIds = [];
    return;
  }
  try {
    const res = await fetch('http://localhost:3000/me/favorites', {
      headers: { ...authHeaders() }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Fehler beim Laden der Favoriten');
    favIds = Array.isArray(data.ids) ? data.ids.map(Number) : [];
  } catch (e) {
    console.error(e);
    favIds = [];
  }
}

/* =========================
   Popup Live Updates
========================= */
function updateOpenPopupStar() {
  if (!activePopupMarker || !activePopupMarker.isPopupOpen?.() || activePopupShopId == null) return;

  const popup = activePopupMarker.getPopup?.();
  const el = popup?.getElement?.();
  if (!el) return;

  const btn = el.querySelector('.fav-btn');
  if (!btn) return;

  const favNow = isFavorite(activePopupShopId);
  btn.classList.toggle('is-fav', favNow);
  btn.textContent = favNow ? '★' : '☆';
  btn.title = favNow ? 'Aus Favoriten entfernen' : 'Als Favorit speichern';
}

function updateOpenPopupRating(newRating) {
  if (!activePopupMarker || !activePopupMarker.isPopupOpen?.() || activePopupShopId == null) return;

  const popup = activePopupMarker.getPopup?.();
  const el = popup?.getElement?.();
  if (!el) return;

  const ratingEl = el.querySelector('.popup-rating-value');
  if (!ratingEl) return;

  ratingEl.textContent = `⭐${String(newRating)}`;
}

/* =========================
   Favorites Toggle (Backend)
========================= */
async function toggleFavorite(shopId, source = 'normal') {
  const id = Number(shopId);

  if (!authToken) return;

  try {
    const res = await fetch(`http://localhost:3000/me/favorites/${id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ source: source === 'community' ? 'community' : 'normal' })
    });
    const data = await res.json();

    if (!res.ok) {
      setAuth(null, null);
      favIds = [];
      return;
    }

    if (data.is_fav) {
      if (!favIds.includes(id)) favIds.push(id);
    } else {
      favIds = favIds.filter(x => x !== id);
    }

    updateOpenPopupStar();
    renderSearchResults();

    if ($('#community')?.classList.contains('active')) renderCommunity();
    if ($('#favorites')?.classList.contains('active')) renderFavorites();
    if ($('#review')?.classList.contains('active')) renderReview();
  } catch (err) {
    console.error(err);
  }
}

function toggleFavoriteFromPopup(event, btn, shopId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  toggleFavorite(shopId);

  const fav = isFavorite(shopId);

  if (btn) {
    btn.textContent = fav ? '★' : '☆';
    btn.classList.toggle('is-fav', fav);
    btn.title = fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern';
    btn.setAttribute('aria-label', fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern');
  }

  if (activePopupMarker && activePopupShopId === shopId) {
    const shop = allShops.find(s => Number(s.id) === Number(shopId));
    if (shop) {
      activePopupMarker.setPopupContent(makePopupHTML(shop));

      setTimeout(() => {
        const popupEl = activePopupMarker.getPopup()?.getElement();
        const detailsBtn = popupEl?.querySelector('.popup-btn');
        detailsBtn?.focus();
      }, 0);
    }
  }
}

window.toggleFavorite = toggleFavorite;
window.toggleFavoriteFromPopup = toggleFavoriteFromPopup;

/* =========================
   AUTH MODALS / NAV UI
========================= */
function updateNavAuthUI() {
  const authBtn = $('#navAuthBtn');
  const settingsBtn = $('#navSettingsBtn');
  if (!authBtn || !settingsBtn) return;

  if (currentUser) {
    authBtn.textContent = currentUser.username;
    settingsBtn.classList.remove('hidden');
  } else {
    authBtn.textContent = 'Login';
    settingsBtn.classList.add('hidden');
  }
}

async function restoreSessionIfPossible() {
  if (!authToken) {
    setAuth(null, null);
    return;
  }

  try {
    const res = await fetch('http://localhost:3000/auth/me', {
      headers: { ...authHeaders() }
    });
    const data = await res.json();

    if (!res.ok) {
      setAuth(null, null);
      return;
    }

    setAuth(authToken, data.user);
    if ($('#community')?.classList.contains('active')) {
      await loadCommunity();
    }
  } catch (e) {
    console.error(e);
    setAuth(null, null);
  }
}

function switchAuthTab(which) {
  const tabLogin = $('#authTabLogin');
  const tabRegister = $('#authTabRegister');
  const paneLogin = $('#authLoginPane');
  const paneRegister = $('#authRegisterPane');

  const isLogin = which === 'login';

  tabLogin?.classList.toggle('active', isLogin);
  tabRegister?.classList.toggle('active', !isLogin);

  paneLogin?.classList.toggle('hidden', !isLogin);
  paneRegister?.classList.toggle('hidden', isLogin);

  // Felder & Fehlermeldungen beim Tab-Wechsel resetten
  const m1 = $('#authMsg');
  const m2 = $('#authMsg2');
  if (m1) m1.textContent = '';
  if (m2) m2.textContent = '';

  const loginU = $('#loginInput');
  const loginP = $('#loginPassword');
  const regU = $('#regUsername');
  const regP = $('#regPassword');

  if (isLogin) {
    if (loginU) loginU.value = '';
    if (loginP) loginP.value = '';
  } else {
    // wichtig: register felder leeren
    if (regU) regU.value = '';
    if (regP) regP.value = '';
  }
}

function openAuthModal(prefillMsg = '') {
  const modal = $('#authModal');
  if (!modal) return;

  const m1 = $('#authMsg');
  const m2 = $('#authMsg2');
  if (m1) m1.textContent = prefillMsg || '';
  if (m2) m2.textContent = '';

  switchAuthTab('login');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeAuthModal() {
  const modal = $('#authModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function doLogin() {
  const msg = $('#authMsg');
  if (msg) msg.textContent = '';

  const username = $('#loginInput')?.value.trim();
  const password = $('#loginPassword')?.value;

  if (!username || !password) {
    if (msg) msg.textContent = 'Bitte Username und Passwort ausfüllen.';
    return;
  }

  try {
    const res = await fetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      if (msg) msg.textContent = data?.error || 'Login fehlgeschlagen.';
      return;
    }

    setAuth(data.token, data.user);
    await loadFavoritesFromBackend();
    closeAuthModal();
    await refreshShopsEverywhere();

    if ($('#community')?.classList.contains('active')) {
      await loadCommunity();
    }
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = 'Server nicht erreichbar.';
  }
}

async function doRegister() {
  const msg = $('#authMsg2');
  if (msg) msg.textContent = '';

  const username = $('#regUsername')?.value.trim();
  const password = $('#regPassword')?.value;

  if (!username || !password) {
    if (msg) msg.textContent = 'Bitte alles ausfüllen.';
    return;
  }

  try {
    const res = await fetch('http://localhost:3000/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      if (msg) msg.textContent = data?.error || 'Registrierung fehlgeschlagen.';
      return;
    }

    setAuth(data.token, data.user);
    await loadFavoritesFromBackend();
    closeAuthModal();
    await refreshShopsEverywhere();

    if ($('#community')?.classList.contains('active')) {
      await loadCommunity();
    }
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = 'Server nicht erreichbar.';
  }
}

function openSettingsModal() {
  if (!currentUser) return;

  const modal = $('#settingsModal');
  if (!modal) return;

  const u = $('#settingsUsername');
  if (u) u.textContent = currentUser.username;

  // Felder/Msg resetten (damit alte Werte nicht hängen bleiben)
  if ($('#pwOld')) $('#pwOld').value = '';
  if ($('#pwNew')) $('#pwNew').value = '';
  if ($('#pwNew2')) $('#pwNew2').value = '';
  if ($('#pwMsg')) $('#pwMsg').textContent = '';
  if ($('#clearLocalMsg')) $('#clearLocalMsg').textContent = '';
  if ($('#appSettingsMsg')) $('#appSettingsMsg').textContent = '';
  if ($('#deleteAccountPw')) $('#deleteAccountPw').value = '';
  if ($('#deleteAccountMsg')) $('#deleteAccountMsg').textContent = '';

  // Standard: Account Tab anzeigen
  showSettingsTab('account');

  // Settings reinladen
  const s = getAppSettings();
  if ($('#communityHideAdded')) $('#communityHideAdded').value = String(s.communityHideAdded || '0');

  // Modal öffnen
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  updateBodyLockScroll();
}

function closeSettingsModal() {
  const modal = $('#settingsModal');
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  // Scroll nur freigeben, wenn wirklich kein Modal mehr offen ist
  updateBodyLockScroll();
}

/* ---------------- MODAL STACK / SCROLL LOCK ---------------- */
function updateBodyLockScroll() {
  const anyOpen = !!document.querySelector('.modal:not(.hidden)');
  document.body.classList.toggle('lock-scroll', anyOpen);
}

function setConfirmModalUI({ title, okText, cancelText } = {}) {
  const modal = $('#confirmModal');
  if (!modal) return;

  const titleEl = modal.querySelector('.modal-title');
  const okBtn = $('#confirmOkBtn');
  const cancelBtn = $('#confirmCancelBtn');

  if (titleEl && typeof title === 'string') titleEl.textContent = title;
  if (okBtn && typeof okText === 'string') okBtn.textContent = okText;
  if (cancelBtn && typeof cancelText === 'string') cancelBtn.textContent = cancelText;
}

async function doLogout() {
  try {
    if (authToken) {
      await fetch('http://localhost:3000/auth/logout', {
        method: 'POST',
        headers: { ...authHeaders() }
      });
    }
  } catch (e) {
    console.error(e);
  }

  setAuth(null, null);
  favIds = [];
  closeSettingsModal();
  await refreshShopsEverywhere();

  if ($('#community')?.classList.contains('active')) {
    await loadCommunity();
  }
}

async function doDeleteAccount() {
  if (!authToken) return;

  const msgEl = $('#deleteAccountMsg');
  if (msgEl) msgEl.textContent = '';

  const pw = $('#deleteAccountPw')?.value || '';
  if (!pw.trim()) {
    if (msgEl) msgEl.textContent = 'Bitte Passwort zur Bestätigung eingeben.';
    return;
  }

  // Confirm Popup (liegt über Settings und blockiert alles dahinter)
  setConfirmModalUI({ title: 'Account löschen?', okText: 'Ja, löschen', cancelText: 'Abbrechen' });
  openConfirmModal('Willst du deinen Account wirklich unwiderruflich löschen?', async () => {
    try {
      const res = await fetch('http://localhost:3000/me/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ password: pw })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (msgEl) msgEl.textContent = data?.error || 'Account löschen fehlgeschlagen.';
        return;
      }

      // UI Reset
      $('#deleteAccountPw').value = '';
      if (msgEl) msgEl.textContent = '✅ Account wurde gelöscht.';

      // Session lokal beenden
      setAuth(null, null);
      favIds = [];
      closeSettingsModal();

      // überall neu laden
      await refreshShopsEverywhere();

      // zurück zur Startseite
      showView('home');
      history.pushState({}, '', '#home');

      // wenn Auth-Modal offen war o.ä.
      updateNavAuthUI();
      applyLoginGates();
    } catch (e) {
      console.error(e);
      if (msgEl) msgEl.textContent = 'Server nicht erreichbar.';
    }
  });

  // UI-Texte werden über setConfirmModalUI gesetzt
}

function initAuthUI() {
  updateNavAuthUI();

  // Auth Tabs
  $('#authTabLogin')?.addEventListener('click', () => switchAuthTab('login'));
  $('#authTabRegister')?.addEventListener('click', () => switchAuthTab('register'));

  // Auth Modal schließen
  $('#authCancelBtn')?.addEventListener('click', closeAuthModal);
  $('#authCancelBtn2')?.addEventListener('click', closeAuthModal);
  $('#authModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeAuthModal);

  // Login / Register
  $('#authLoginBtn')?.addEventListener('click', doLogin);
  $('#authRegisterBtn')?.addEventListener('click', doRegister);

  // Settings Modal
  $('#settingsCloseBtn')?.addEventListener('click', closeSettingsModal);
  $('#settingsModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeSettingsModal);

  // Logout
  $('#logoutBtn')?.addEventListener('click', doLogout);

  // Delete Account
  $('#deleteAccountBtn')?.addEventListener('click', doDeleteAccount);
}

function showSettingsTab(tab) {
  $$('.settings-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.settingsTab === tab);
  });

  $$('.settings-pane').forEach(p => {
    p.classList.toggle('hidden', p.dataset.settingsPane !== tab);
  });
}

function initSettingsUI() {
  if (window.__settingsUiInitialized) return;
  window.__settingsUiInitialized = true;

  // Tabs robuster per delegated click
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-nav-item');
    if (!btn) return;

    const modal = $('#settingsModal');
    if (!modal || modal.classList.contains('hidden')) return;

    e.preventDefault();
    e.stopPropagation();

    const tab = btn.dataset.settingsTab;
    if (!tab) return;

    showSettingsTab(tab);
  });

  // App Settings initial laden
  const s = getAppSettings();
  const hideAdded = $('#communityHideAdded');
  if (hideAdded) hideAdded.value = String(s.communityHideAdded || '0');

  // Save App Settings
  $('#saveSettingsBtn')?.addEventListener('click', () => {
    const msg = $('#appSettingsMsg');
    if (msg) msg.textContent = '';

    const next = {
      communityHideAdded: $('#communityHideAdded')?.value === '1' ? 1 : 0
    };

    setAppSettings(next);
    if (msg) msg.textContent = '✅ Gespeichert';

    if ($('#favorites')?.classList.contains('active') && authToken) renderFavorites();
    if ($('#community')?.classList.contains('active')) loadCommunity();
  });

  // Local Storage leeren
  $('#clearLocalBtn')?.addEventListener('click', () => {
    const msg = $('#clearLocalMsg');
    if (msg) msg.textContent = '';

    try {
      localStorage.removeItem(APP_SETTINGS_KEY);
      localStorage.removeItem(USER_RATINGS_KEY);
      if (msg) msg.textContent = '✅ Lokale Daten gelöscht';
    } catch {
      if (msg) msg.textContent = 'Fehler beim Löschen.';
    }
  });

  // Passwort ändern
  $('#pwChangeBtn')?.addEventListener('click', async () => {
    const msg = $('#pwMsg');
    if (msg) msg.textContent = '';

    const oldPassword = $('#pwOld')?.value || '';
    const newPassword = $('#pwNew')?.value || '';
    const newPassword2 = $('#pwNew2')?.value || '';

    if (!oldPassword || !newPassword || !newPassword2) {
      if (msg) msg.textContent = 'Bitte alle Felder ausfüllen.';
      return;
    }

    if (newPassword !== newPassword2) {
      if (msg) msg.textContent = 'Die neuen Passwörter stimmen nicht überein.';
      return;
    }

    try {
      const res = await fetch('http://localhost:3000/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ oldPassword, newPassword })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (msg) msg.textContent = data?.error || 'Passwort ändern fehlgeschlagen.';
        return;
      }

      if (msg) msg.textContent = '✅ Passwort geändert. Du wirst ausgeloggt.';
      setTimeout(() => doLogout(), 700);
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = 'Server nicht erreichbar.';
    }
  });
}

/* =========================
   LOGIN GATES (Views)
========================= */
function setViewGate(viewId, text, enabled) {
  const view = document.getElementById(viewId);
  if (!view) return;

  let gate = view.querySelector('.login-gate');
  if (!gate) {
    gate = document.createElement('p');
    gate.className = 'login-gate';
    view.prepend(gate);
  }

  gate.textContent = text;

  [...view.children].forEach(ch => {
    if (ch === gate) return;
    ch.classList.toggle('hidden', enabled);
  });

  gate.classList.toggle('hidden', !enabled);
}

function applyLoginGates() {
  const loggedIn = !!authToken;

  setViewGate('favorites', 'Bitte einloggen, um Favoriten zu sehen.', !loggedIn);
  setViewGate('review', 'Bitte einloggen, um Bewertungen zu sehen.', !loggedIn);
  setViewGate('add', 'Bitte einloggen, um Hinzufügen zu sehen.', !loggedIn);

  if (loggedIn) {
    if ($('#favorites')?.classList.contains('active')) renderFavorites();
    if ($('#review')?.classList.contains('active')) renderReview();
  }
}

/* ---------------- ROUTING / SPA ---------------- */
function showView(viewId) {
  syncVueState({ currentView: viewId });
  if (!$('#settingsModal')?.classList.contains('hidden')) {
    closeSettingsModal();
  }
  
  views.forEach(v => v.classList.remove('active'));
  navLinks.forEach(l => l.classList.remove('active'));

  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  navLinks.forEach(link => {
    if (link.dataset.view === viewId) link.classList.add('active');
  });

  document.body.classList.toggle('lock-scroll', viewId === 'map' || viewId === 'search');

  if (viewId === 'map' && map) {
    setTimeout(() => map.invalidateSize(), 100);
  }

  if (viewId === 'search') loadSearch();
  if (viewId === 'favorites' && authToken) renderFavorites();
  if (viewId === 'review' && authToken) renderReview();
  if (viewId === 'add') {
    const msg = $('#rateMsg');
    if (msg) msg.textContent = '';
  }
  if (viewId === 'community') loadCommunity();
  if (viewId === 'top') startTopPolling();
  else stopTopPolling();

  applyLoginGates();
}

$$('[data-view]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const view = el.dataset.view;
    if (!view) return;

    showView(view);
    history.pushState({}, "", `#${view}`);
  });
});

window.addEventListener('popstate', () => {
  showView(location.hash.replace('#', '') || 'home');
});

function wireFlipCards(root = document) {
  root.querySelectorAll('.flip-card').forEach(card => {
    if (card.dataset.flipBound === '1') return;
    card.dataset.flipBound = '1';

    const toggleFlip = () => {
      card.querySelector('.flip-card-inner')?.classList.toggle('flipped');
    };

    card.addEventListener('click', toggleFlip);

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFlip();
      }
    });
  });
}

wireFlipCards(document);

document.addEventListener('DOMContentLoaded', async () => {
  mountVueApp();
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch (_) {}
  setAuth(null, null);
  initAuthUI();
  initSettingsUI();
  initDetailViewUI();
  initAddShopUI();
  await restoreSessionIfPossible();
  await loadFavoritesFromBackend();

  await initMap();
  initSearchUI();
  initAddressAutocomplete();
  initRateModal();
  initEditShopModal();
  initCloneChoiceModal();

  applyLoginGates();
  showView(location.hash.replace('#', '') || 'home');

  $('#favoritesFilter')?.addEventListener('change', () => {
    if ($('#favorites')?.classList.contains('active') && authToken) {
      renderFavorites();
    }
  });

  // "Live" (für alle User) via leichtem Polling:
  // -> holt regelmäßig neue Ø-Bewertungen, Favoriten/MyRating (wenn eingeloggt) usw.
  setInterval(() => {
    refreshShopsEverywhere().catch(() => {});
  }, 5000);
});

/* ---------------- MAP ---------------- */
async function initMap() {
  const berlinBounds = L.latLngBounds([52.3383, 13.0884], [52.6755, 13.7611]);

  map = L.map('leaflet-map', {
    maxBounds: berlinBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 11,
    maxZoom: 18,
    closePopupOnClick: false
  }).setView([52.5200, 13.4050], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  subdomains: 'abcd',
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap-Mitwirkende &copy; CARTO'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  shops = await fetchShops();
  renderMapMarkers(shops);
}

function setupPopupFocusOrder(marker) {
  const popupEl = marker.getPopup()?.getElement();
  if (!popupEl) return;

  const detailsBtn = popupEl.querySelector('.popup-btn');
  const starBtn = popupEl.querySelector('.fav-btn');
  const closeBtn = popupEl.querySelector('.leaflet-popup-close-button');

  if (closeBtn && !closeBtn.dataset.mouseFixBound) {
  closeBtn.dataset.mouseFixBound = '1';

  // Verhindert, dass der Klick auf das X den Fokus aus der Map reißt
  closeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const closedShopId = Number(shop.id);

    marker.closePopup();

    setTimeout(() => {
      focusNextMarkerAfter(closedShopId);
    }, 0);
  });
}
}

  if (detailsBtn) {
    detailsBtn.focus();

    if (!detailsBtn.dataset.tabBound) {
      detailsBtn.dataset.tabBound = '1';
      detailsBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey && starBtn) {
          e.preventDefault();
          starBtn.focus();
        }
      });
    }
  }

  if (starBtn && !starBtn.dataset.tabBound) {
    starBtn.dataset.tabBound = '1';
    starBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && detailsBtn) {
          e.preventDefault();
          detailsBtn.focus();
        } else if (!e.shiftKey && closeBtn) {
          e.preventDefault();
          closeBtn.focus();
        }
      }
    });
  }

  if (closeBtn && !closeBtn.dataset.clickBound) {
  closeBtn.dataset.clickBound = '1';
  closeBtn.addEventListener('click', () => {
    popupClosedViaX = true;

    setTimeout(() => {
      focusNextMarkerAfter(shop.id);
    }, 0);
  });
}

function makePopupHTML(shop) {
  const fav = isFavorite(shop.id);

  return `
    <div class="popup-head">
      <b>${shop.name}</b>
      <button
        type="button"
        class="fav-btn ${fav ? 'is-fav' : ''}"
        title="${fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}"
        aria-label="${fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}"
        onclick="toggleFavoriteFromPopup(event, this, ${shop.id})">
        ${fav ? '★' : '☆'}
      </button>
    </div>

    <div class="popup-rating">
      Bewertung (Ø): <span class="popup-rating-value">⭐${shop.rating}</span>
    </div>

    <br>

    <button type="button" class="btn popup-btn" onclick="openDetails(${shop.id})">
      Details ansehen
    </button>
  `;
}

function renderMapMarkers(list) {
  if (!markersLayer) return;

  const wasPopupOpen = !!activePopupMarker?.isPopupOpen?.();
  const openShopId = wasPopupOpen ? Number(activePopupShopId) : null;

  markersLayer.clearLayers();
  activePopupMarker = null;
  activePopupShopId = null;
  markerRefs = [];

  let markerToReopen = null;

  list.forEach(shop => {
    const marker = L.marker([shop.lat, shop.lng], {
      keyboard: true
    }).addTo(markersLayer);

    marker.shopId = Number(shop.id);
    markerRefs.push({ shopId: Number(shop.id), marker });

    marker.bindPopup(makePopupHTML(shop), {
      minWidth: 200,
      maxWidth: 240,
      closeOnClick: false,
      autoClose: true,
      closeButton: true
    });

    marker.on('click', () => {
      suppressNextPopupCloseFocus = true;
    });

    marker.on('popupopen', () => {
      marker.setPopupContent(makePopupHTML(shop));
      activePopupMarker = marker;
      activePopupShopId = Number(shop.id);

      setTimeout(() => {
        const popupEl = marker.getPopup()?.getElement();
        if (!popupEl) return;

        const detailsBtn = popupEl.querySelector('.popup-btn');
        const starBtn = popupEl.querySelector('.fav-btn');
        const closeBtn = popupEl.querySelector('.leaflet-popup-close-button');

        // Fokus beim Öffnen direkt ins Popup
        detailsBtn?.focus();

        // Details -> Stern
        if (detailsBtn && !detailsBtn.dataset.tabBound) {
          detailsBtn.dataset.tabBound = '1';
          detailsBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.shiftKey && starBtn) {
              e.preventDefault();
              starBtn.focus();
            }
          });
        }

        // Stern -> X | Shift+Tab -> Details
        if (starBtn && !starBtn.dataset.tabBound) {
          starBtn.dataset.tabBound = '1';
          starBtn.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey && detailsBtn) {
              e.preventDefault();
              detailsBtn.focus();
            } else if (!e.shiftKey && closeBtn) {
              e.preventDefault();
              closeBtn.focus();
            }
          });
        }

        // X -> nächste Pinnadel | Shift+Tab -> Stern
        if (closeBtn && !closeBtn.dataset.tabBound) {
          closeBtn.dataset.tabBound = '1';
          closeBtn.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;

            if (e.shiftKey && starBtn) {
              e.preventDefault();
              starBtn.focus();
            } else if (!e.shiftKey) {
              e.preventDefault();
              marker.closePopup();
              focusNextMarkerAfter(shop.id);
            }
          });
        }
      }, 0);
    });

    marker.on('popupclose', () => {
  const closedShopId = Number(shop.id);

  if (activePopupMarker === marker) {
    activePopupMarker = null;
    activePopupShopId = null;
  }

  // Wenn eine neue Pinnadel angeklickt wurde, KEIN Fokus-Sprung
  if (suppressNextPopupCloseFocus) {
    suppressNextPopupCloseFocus = false;
    return;
  }

  // Wurde bereits explizit über das Popup-X behandelt
  if (popupClosedViaX) {
    popupClosedViaX = false;
    return;
  }

  setTimeout(() => {
    const anyPopupStillOpen = !!document.querySelector('.leaflet-popup');
    if (!anyPopupStillOpen) {
      focusNextMarkerAfter(closedShopId);
    }
  }, 0);
});

    if (openShopId !== null && Number(shop.id) === openShopId) {
      markerToReopen = marker;
    }
  });

  if (markerToReopen) {
    markerToReopen.openPopup();
  }
}

/* ---------------- SHOPS FETCH ---------------- */
async function fetchShops(queryParams = '') {
  try {
    const res = await fetch(`http://localhost:3000/shops${queryParams}`, {
      headers: { ...authHeaders() }
    });
    return await res.json();
  } catch (err) {
    console.error('Fehler beim Laden der Shops:', err);
    return [];
  }
}

/* ---------------- DETAILS OVERLAY ---------------- */
function meatLabel(shop) {
  const parts = [];
  if (Number(shop.chicken) === 1) parts.push('Hähnchen');
  if (Number(shop.steak) === 1) parts.push('Steakqualität');
  if (Number(shop.hack) === 1) parts.push('Hackspieß');
  return parts.length ? parts.join(', ') : '—';
}

function pricesToTextareaValue(shop) {
  let prices = [];

  try {
    prices = shop?.prices_json ? JSON.parse(shop.prices_json) : [];
  } catch {
    prices = [];
  }

  prices = normalizePrices(prices);

  return prices.map(p => {
    if (p.price !== null && p.price !== undefined && p.price !== '') {
      return `${p.label}: ${String(p.price).replace('.', ',')} €`;
    }
    return p.label;
  }).join('\n');
}

function openEditShopModal(shop) {
  if (!shop) return;

  const modal = $('#editShopModal');
  if (!modal) return;

  $('#editShopId').value = shop.id ?? '';
  $('#editAddress').value = shop.address || '';
  $('#editWait').value = shop.wait_time || '';
  $('#editPrices').value = pricesToTextareaValue(shop);
  $('#editLat').value = Number.isFinite(Number(shop.lat)) ? String(shop.lat) : '';
  $('#editLng').value = Number.isFinite(Number(shop.lng)) ? String(shop.lng) : '';
  $('#editShopMsg').textContent = '';

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  updateBodyLockScroll();
}

function closeEditShopModal() {
  const modal = $('#editShopModal');
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  updateBodyLockScroll();
}

async function saveEditedShop() {
  const msg = $('#editShopMsg');
  if (msg) msg.textContent = '';

  const shopId = Number($('#editShopId')?.value);
  const address = $('#editAddress')?.value.trim();
  const wait_time = $('#editWait')?.value.trim();
  const prices = parsePricesFromTextarea($('#editPrices')?.value || '');
  const lat = Number($('#editLat')?.value);
  const lng = Number($('#editLng')?.value);

  if (!Number.isFinite(shopId)) {
    if (msg) msg.textContent = 'Ungültige Shop-ID.';
    return;
  }

  if (!address || !wait_time) {
    if (msg) msg.textContent = 'Bitte Adresse und Wartezeit ausfüllen.';
    return;
  }

  const hasHouseNumber = /\d+/.test(address);
  if (!hasHouseNumber) {
    if (msg) msg.textContent = 'Bitte eine Adresse mit Hausnummer wählen.';
    return;
  }

  try {
    const res = await fetch(`http://localhost:3000/shops/${shopId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({
        address,
        wait_time,
        prices,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (msg) msg.textContent = data?.error || 'Bearbeiten fehlgeschlagen.';
      return;
    }

    if (msg) msg.textContent = '✅ Laden aktualisiert.';

    await refreshShopsEverywhere();
    closeEditShopModal();
    openDetails(shopId);
  } catch (err) {
    console.error(err);
    if (msg) msg.textContent = 'Server nicht erreichbar.';
  }
}

function initEditShopModal() {
  $('#editShopCancelBtn')?.addEventListener('click', closeEditShopModal);
  $('#editShopSaveBtn')?.addEventListener('click', saveEditedShop);

  $('#editShopModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeEditShopModal);
}

function openDetails(shopId) {
  const id = Number(shopId);

  // 1) normale Shops (GET /shops)
  let shop =
    (shops || []).find(s => Number(s.id) === id) ||
    null;

  // 2) Community-Liste (GET /community/shops)
  if (!shop) {
    const community = window.__communityList || [];
    shop = community.find(s => Number(s.id) === id) || null;
  }

  // 3) Favoriten-Liste (GET /me/favorites/shops)
  if (!shop) {
    const favList = window.__favoriteShopList || [];
    shop = favList.find(s => Number(s.id) === id) || null;
  }

  if (!shop) {
    openInfoModal?.('Fehler', 'Details konnten nicht geladen werden (Shop nicht gefunden).');
    return;
  }

  $('#detail-shop-name').textContent = shop.name;
  $('#detail-shop-address').textContent = shop.address;
  $('#detail-shop-rating').textContent = `⭐ ${shop.rating}`;
  $('#detail-shop-wait').textContent = shop.wait_time;

  const detailImage = $('#detail-shop-image');
  if (detailImage) {
    detailImage.src = getShopImage(shop);
    detailImage.alt = shop.name || 'Ladenbild';
  }

  const meatEl = $('#detail-shop-meat');
  if (meatEl) meatEl.textContent = meatLabel(shop);

  const priceList = $('#detail-shop-prices');
  if (priceList) {
    priceList.innerHTML = "";
    let prices = [];

    try {
      prices = shop.prices_json ? JSON.parse(shop.prices_json) : [];
    } catch {
      prices = [];
    }

    prices = normalizePrices(prices);

    if (!prices.length) {
      const li = document.createElement('li');
      li.textContent = '—';
      priceList.appendChild(li);
    } else {
      prices.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.price !== null
          ? `${p.label}: ${formatPriceEUR(p.price)}`
          : p.label;
        priceList.appendChild(li);
      });
    }
  }

  const routeBtn = $('#detail-route-btn');
  if (routeBtn) routeBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`;

const delBtn = $('#detail-delete-btn');
const editBtn = $('#detail-edit-btn');

const isOwnShop =
  Number(shop.is_user_created) === 1 &&
  currentUser &&
  (
    Number(shop.owner_user_id) === Number(currentUser.id) ||
    String(shop.owner_username || '') === String(currentUser.username || '')
  );

if (delBtn) {
  if (isOwnShop) {
    delBtn.classList.remove('hidden');
    delBtn.onclick = () => deleteShopWithModal(shop.id, shop.name);
  } else {
    delBtn.classList.add('hidden');
    delBtn.onclick = null;
  }
}

if (editBtn) {
  if (isOwnShop) {
    editBtn.classList.remove('hidden');
    editBtn.onclick = () => openEditShopModal(shop);
  } else {
    editBtn.classList.add('hidden');
    editBtn.onclick = null;
  }
}

lastFocusedElement = document.activeElement;

// Merken, ob die Details aus dem Karten-Popup geöffnet wurden
restoreFocusToPopupStar =
  !!lastFocusedElement &&
  (
    lastFocusedElement.classList?.contains('popup-btn') ||
    lastFocusedElement.closest?.('.leaflet-popup')
  );

lastFocusedElement = document.activeElement;

restoreFocusToPopupClose =
  !!lastFocusedElement &&
  (
    lastFocusedElement.classList?.contains('popup-btn') ||
    lastFocusedElement.closest?.('.leaflet-popup')
  );

detailOpenedFromShopId = Number(shopId);

$('#shop-detail-view')?.classList.add('active');

setTimeout(() => {
  $('#detail-route-btn')?.focus();
}, 0);
}

window.openDetails = openDetails;

function closeDetailView() {
  const detailView = $('#shop-detail-view');
  if (!detailView) return;

  detailView.classList.remove('active');

  if (detailOpenedFromShopId !== null) {
    const shopId = detailOpenedFromShopId;
    detailOpenedFromShopId = null;

    setTimeout(() => {
      if (activePopupMarker) {
        activePopupMarker.closePopup();
      }
      focusNextMarkerAfter(shopId);
    }, 0);
  }
}

function initDetailViewUI() {
  const detailView = $('#shop-detail-view');
  const closeBtn = $('#close-detail');

  if (!detailView || !closeBtn) return;

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDetailView();
  });

  detailView.addEventListener('click', (e) => {
    if (e.target === detailView) {
      closeDetailView();
    }
  });
}

document.addEventListener('keydown', (e) => {
  const detailView = $('#shop-detail-view');
  if (!detailView?.classList.contains('active')) return;
  if (e.key !== 'Tab') return;

  const routeBtn = $('#detail-route-btn');
  const closeBtn = $('#close-detail');

  if (!routeBtn || !closeBtn) return;

  // Von "Route planen" mit Tab direkt auf "X"
  if (!e.shiftKey && document.activeElement === routeBtn) {
    e.preventDefault();
    closeBtn.focus();
    return;
  }

  // Von "X" mit Shift+Tab zurück auf "Route planen"
  if (e.shiftKey && document.activeElement === closeBtn) {
    e.preventDefault();
    routeBtn.focus();
  }
});

/* ---------------- SEARCH & FILTER ---------------- */
function norm(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function syncFilterCheckboxStyles() {
  $$('#advancedFilters .chk input[type="checkbox"]').forEach(input => {
    const label = input.closest('label.chk');
    if (!label) return;
    label.classList.toggle('selected', input.checked);
  });
}

function initSearchUI() {
  const ratingRange = $('#ratingRange');
  if (ratingRange) {
    updateStarsUI(ratingRange.value);
    ratingRange.addEventListener('input', () => updateStarsUI(ratingRange.value));
  }

  const applyBtn = $('#applyFiltersBtn');
  const resetBtn = $('#resetFiltersBtn');
  const toggleBtn = $('#toggleFiltersBtn');
  const adv = $('#advancedFilters');
  const searchInput = $('#searchInput');

  toggleBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    adv?.classList.toggle('hidden');
  });

  applyBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    loadSearch();
  });

  resetBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resetSearchAndFilters();
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadSearch();
    }
  });

  searchInput?.addEventListener('input', () => {
    renderSearchResults();
  });

  // Checkbox-Felder: ganzes Feld klickbar + Farbe bei Auswahl
  $$('#advancedFilters .chk input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', syncFilterCheckboxStyles);
  });
  syncFilterCheckboxStyles();
}

function matchesRatingBucket(shop, bucket) {
  const r = Number(shop?.rating);

  if (!Number.isFinite(r)) return false;
  if (!bucket) return true;

  if (bucket === 'lt2') return r < 2;
  if (bucket === '2to3') return r >= 2 && r < 3;
  if (bucket === '3to4') return r >= 3 && r < 4;
  if (bucket === '4to5') return r >= 4 && r <= 5;

  return true;
}

function buildBackendQueryParams() {
  const chicken = $('#chickenFilter')?.checked ? '1' : '';
  const steak = $('#steakFilter')?.checked ? '1' : '';
  const hack = $('#hackFilter')?.checked ? '1' : '';

  const params = new URLSearchParams();
  if (chicken) params.set('chicken', chicken);
  if (steak) params.set('steak', steak);
  if (hack) params.set('hack', hack);

  const s = params.toString();
  return s ? `?${s}` : '';
}

async function loadSearch() {
  const qp = buildBackendQueryParams();
  const filtered = await fetchShops(qp);
  window.__searchBaseList = Array.isArray(filtered) ? filtered : [];
  renderSearchResults();
}

function renderSearchResults() {
  const container = $('#searchResults');
  if (!container) return;

  const base = window.__searchBaseList || [];
  const q = norm($('#searchInput')?.value);

  const ratingBucket = $('#minRatingFilter')?.value || '';

  const list = base.filter(s => {
    const matchesText = q
      ? (norm(s.name).includes(q) || norm(s.address).includes(q))
      : true;

    const matchesRating = matchesRatingBucket(s, ratingBucket);

    return matchesText && matchesRating;
  });

  if (!list.length) {
    container.innerHTML = `<p>Keine Treffer.</p>`;
    return;
  }

  container.innerHTML = list.map(shop => {
    const fav = isFavorite(shop.id);

    return `
      <div class="pixel-card shop-card">
        <button class="fav-btn card-fav ${fav ? 'is-fav' : ''}"
                title="${fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}"
                onclick="toggleFavorite(${shop.id})">
          ${fav ? '★' : '☆'}
        </button>

        <h3>${shop.name}</h3>
        <p><strong>Adresse:</strong> ${shop.address}</p>
        <p><strong>Bewertung (Ø):</strong> ⭐ ${shop.rating}</p>
        <p><strong>Wartezeit:</strong> ${shop.wait_time}</p>
        <button class="btn" onclick="openDetails(${shop.id})">Details</button>
      </div>
    `;
  }).join('');
}

function resetSearchAndFilters() {
  const si = $('#searchInput');
  if (si) si.value = '';

  const c = $('#chickenFilter');
  const s = $('#steakFilter');
  const h = $('#hackFilter');
  const mr = $('#minRatingFilter');

  if (c) c.checked = false;
  if (s) s.checked = false;
  if (h) h.checked = false;
  if (mr) mr.value = '';

  syncFilterCheckboxStyles();
  loadSearch();
}

async function refreshShopsEverywhere() {
  shops = await fetchShops();

  if (map && markersLayer) renderMapMarkers(shops);

  if ($('#search')?.classList.contains('active')) loadSearch();
  if ($('#favorites')?.classList.contains('active') && authToken) renderFavorites();
  if ($('#review')?.classList.contains('active') && authToken) renderReview();

  applyLoginGates();
}

/* ---------------- ADD SHOP ---------------- */
function resetAddShopForm() {
  if ($('#rateName')) $('#rateName').value = '';
  if ($('#rateAddress')) $('#rateAddress').value = '';
  if ($('#rateWait')) $('#rateWait').value = '';
  if ($('#ratePrices')) $('#ratePrices').value = '';
  if ($('#meatType')) $('#meatType').value = '';
  if ($('#rateLat')) $('#rateLat').value = '';
  if ($('#rateLng')) $('#rateLng').value = '';

  const ratingRange = $('#ratingRange');
  if (ratingRange) {
    ratingRange.value = '4.5';
    updateStarsUI('4.5');
  }

  const suggestions = $('#addressSuggestions');
  if (suggestions) {
    suggestions.innerHTML = '';
    suggestions.classList.add('hidden');
  }
}

function setAddShopMessage(text, type = 'info') {
  const msg = $('#rateMsg');
  if (!msg) return;

  msg.textContent = text;
  msg.style.color = '';

  if (type === 'success') {
    msg.style.color = '#59ff8a';
  } else if (type === 'error') {
    msg.style.color = '#ff6b6b';
  }
}

function initAddShopUI() {
  $('#rateSubmitBtn')?.addEventListener('click', async (e) => {
    e.preventDefault();

    if (!authToken) return;

    setAddShopMessage('');

    const name = $('#rateName')?.value.trim();
    const address = $('#rateAddress')?.value.trim();
    const wait_time = $('#rateWait')?.value.trim();
    const rating = Math.max(0.5, Number($('#ratingRange')?.value || 0.5));
    const meatType = $('#meatType')?.value || '';
    const pricesRaw = parsePricesFromTextarea($('#ratePrices')?.value || '');

    if (!name || !address || !wait_time || rating <= 0) {
      setAddShopMessage('Bitte Name, Adresse, Wartezeit und Bewertung ausfüllen.', 'error');
      return;
    }

    if (!meatType) {
      setAddShopMessage('Bitte eine Fleischart auswählen.', 'error');
      return;
    }

    const lat = Number($('#rateLat')?.value);
    const lng = Number($('#rateLng')?.value);

    const hasHouseNumber = /\d+/.test(address);
    if (!hasHouseNumber) {
      setAddShopMessage('Bitte eine Adresse mit Hausnummer wählen (z.B. "Friedrichstraße 10").', 'error');
      return;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setAddShopMessage('Bitte eine Adresse aus den Vorschlägen auswählen (damit Koordinaten gesetzt werden).', 'error');
      return;
    }

    try {
      const res = await fetch('http://localhost:3000/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name,
          address,
          wait_time,
          rating,
          prices: pricesRaw,
          lat,
          lng,
          meatType
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setAddShopMessage(data?.error || 'Fehler beim Speichern.', 'error');
        return;
      }

      resetAddShopForm();
      setAddShopMessage('✅ Laden hinzugefügt!', 'success');

      await refreshShopsEverywhere();
    } catch (err) {
      console.error(err);
      setAddShopMessage('Server nicht erreichbar (läuft node server.js?).', 'error');
    }
  });
}

/* ---------------- MODAL / DELETE ---------------- */
function openConfirmModal(text, onOk) {
  const modal = $('#confirmModal');
  const modalText = $('#confirmModalText');
  const okBtn = $('#confirmOkBtn');
  const cancelBtn = $('#confirmCancelBtn');

  if (!modal || !modalText || !okBtn || !cancelBtn) return;

  modalText.textContent = text;

  okBtn.onclick = null;
  cancelBtn.onclick = null;

  let isClosing = false;
  const forceClose = () => {
    if (isClosing) return;
    isClosing = true;

    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');

    // Buttons wieder aktivieren (falls Ok async war)
    okBtn.disabled = false;
    cancelBtn.disabled = false;

    // Event Listener sauber entfernen
    document.removeEventListener('keydown', onKey);
    updateBodyLockScroll();
  };

  // Nur schließen, wenn NICHT gerade eine OK-Aktion läuft
  const requestClose = () => {
    if (okBtn.disabled || cancelBtn.disabled) return;
    forceClose();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') requestClose();
  };

  okBtn.onclick = async () => {
    // Modal bleibt offen bis die Aktion fertig ist -> Hintergrund bleibt blockiert
    okBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      await onOk();
    } finally {
      forceClose();
    }
  };

  cancelBtn.onclick = requestClose;

  modal.querySelector('.modal-backdrop')?.addEventListener('click', requestClose, { once: true });
  document.addEventListener('keydown', onKey);

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  updateBodyLockScroll();
}

function deleteShopWithModal(shopId, shopName) {
  setConfirmModalUI({ title: 'Laden löschen?', okText: 'Ja, löschen', cancelText: 'Abbrechen' });
  openConfirmModal(`Willst du "${shopName}" wirklich löschen?`, async () => {
    try {
      const res = await fetch(`http://localhost:3000/shops/${shopId}`, {
        method: 'DELETE',
        headers: { ...authHeaders() }
      });
      const data = await res.json();

      if (!res.ok) {
        setConfirmModalUI({ title: 'Hinweis', okText: 'OK', cancelText: 'Schließen' });
        openConfirmModal(data?.error || 'Löschen fehlgeschlagen.', () => {});
        return;
      }

      $('#shop-detail-view')?.classList.remove('active');
      await refreshShopsEverywhere();
    } catch (err) {
      console.error(err);
      setConfirmModalUI({ title: 'Hinweis', okText: 'OK', cancelText: 'Schließen' });
      openConfirmModal('Server nicht erreichbar (läuft node server.js?)', () => {});
    }
  });
}

/* ---------------- STARS UI (Add-Form) ---------------- */
function updateStarsUI(value) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  const percent = (v / 5) * 100;

  const fill = $('#starsFill');
  const txt = $('#ratingValue');

  if (fill) fill.style.width = `${percent}%`;
  if (txt) txt.textContent = v.toFixed(1);
}

/* ---------------- ADDRESS AUTOCOMPLETE (Nominatim) ---------------- */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function initAddressAutocompleteFor({
  inputId,
  listId,
  latId,
  lngId
}) {
  const input = $(`#${inputId}`);
  const list = $(`#${listId}`);
  if (!input || !list) return;

  let items = [];
  let activeIndex = -1;

  const hide = () => {
    list.classList.add('hidden');
    list.innerHTML = '';
    items = [];
    activeIndex = -1;
  };

  const setActive = (idx) => {
    activeIndex = idx;
    [...list.querySelectorAll('li')].forEach((li, i) => {
      li.classList.toggle('active', i === activeIndex);
    });
  };

  const choose = (item) => {
    input.value = item.display_name;

    const lat = Number(item.lat);
    const lng = Number(item.lon);

    const latEl = $(`#${latId}`);
    const lngEl = $(`#${lngId}`);

    if (latEl) latEl.value = Number.isFinite(lat) ? String(lat) : '';
    if (lngEl) lngEl.value = Number.isFinite(lng) ? String(lng) : '';

    hide();
  };

  const render = () => {
    if (!items.length) return hide();

    list.innerHTML = items.map((it, i) => `<li data-idx="${i}">${it.display_name}</li>`).join('');
    list.classList.remove('hidden');

    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = Number(li.dataset.idx);
        choose(items[idx]);
      });
    });
  };

  const berlinViewBox = "13.0884,52.3383,13.7611,52.6755";

  const fetchSuggestions = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) return hide();

    try {
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?format=json&addressdetails=1&limit=6` +
        `&countrycodes=de` +
        `&viewbox=${encodeURIComponent(berlinViewBox)}` +
        `&bounded=1` +
        `&q=${encodeURIComponent(q)}`;

      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const data = await res.json();

      items = Array.isArray(data) ? data : [];
      render();
    } catch (err) {
      console.error('Autocomplete Fehler:', err);
      hide();
    }
  }, 250);

  input.addEventListener('input', fetchSuggestions);

  input.addEventListener('input', () => {
    const latEl = $(`#${latId}`);
    const lngEl = $(`#${lngId}`);
    if (latEl) latEl.value = '';
    if (lngEl) lngEl.value = '';
  });

  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        choose(items[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-autocomplete')) hide();
  });

  input.addEventListener('blur', () => setTimeout(hide, 150));
}

function initAddressAutocomplete() {
  initAddressAutocompleteFor({
    inputId: 'rateAddress',
    listId: 'addressSuggestions',
    latId: 'rateLat',
    lngId: 'rateLng'
  });

  initAddressAutocompleteFor({
    inputId: 'editAddress',
    listId: 'editAddressSuggestions',
    latId: 'editLat',
    lngId: 'editLng'
  });
}

/* ---------------- FAVORITES VIEW ---------------- */
async function fetchFavoriteShops() {
  if (!authToken) return [];
  try {
    const res = await fetch('http://localhost:3000/me/favorites/shops', {
      headers: { ...authHeaders() }
    });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function renderFavorites() {
  const container = $('#favoritesList');
  if (!container) return;

  if (!authToken) {
    container.innerHTML = ``;
    return;
  }

  const filter = $('#favoritesFilter')?.value || 'all';
  const favShops = await fetchFavoriteShops();
  window.__favoriteShopList = Array.isArray(favShops) ? favShops : [];

  const list = (filter === 'community')
    ? favShops.filter(s => String(s.fav_source) === 'community')
    : favShops;

  if (!list.length) {
    container.innerHTML = filter === 'community'
      ? `<p>Noch keine Community-Favoriten gespeichert.</p>`
      : `<p>Noch keine Favoriten gespeichert.</p>`;
    return;
  }

  container.innerHTML = list.map(shop => {
    const fav = isFavorite(shop.id);
    const routeUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`;

    const ownerLine =
      Number(shop.is_user_created) === 1 && shop.owner_username
        ? `<p><strong>Community:</strong> ${escapeHtml(shop.owner_username)} hat diesen Laden hinzugefügt</p>`
        : ``;

    const communityBadge =
      String(shop.fav_source) === 'community'
        ? `<p class="muted">📌 Gemerkt aus Community</p>`
        : ``;

    return `
      <div class="pixel-card shop-card">
        <button class="fav-btn card-fav ${fav ? 'is-fav' : ''}"
                title="Aus Favoriten entfernen"
                onclick="toggleFavorite(${shop.id}, '${shop.fav_source === 'community' ? 'community' : 'normal'}')">
          ${fav ? '★' : '☆'}
        </button>

        <h3>${shop.name}</h3>
        <p><strong>Adresse:</strong> ${shop.address}</p>

        ${ownerLine}
        ${communityBadge}

        <p><strong>Bewertung (Ø):</strong> ⭐ ${shop.rating}</p>
        <p><strong>Wartezeit:</strong> ${shop.wait_time}</p>

        <div class="row-actions">
          <button class="btn" onclick="openDetails(${shop.id})">Details</button>
          <a class="btn" href="${routeUrl}" target="_blank" rel="noopener">Route</a>
        
        ${
          (String(shop.fav_source) === 'community') && (Number(shop.is_added) !== 1)
            ? `<button class="btn" onclick="openCloneChoiceModal(${shop.id}, 'community')">
                Zu meinen Läden
              </button>`
            : ``
        }
        </div>
      </div>
    `;
  }).join('');
}

/* =========================
   REVIEW VIEW (Bewerten)
   -> pro User über Backend-Feld `my_rating`
========================= */
async function renderReview() {
  const unratedEl = $('#reviewUnratedList');
  const ratedEl = $('#reviewRatedList');
  if (!unratedEl || !ratedEl) return;

  if (!authToken) {
    unratedEl.innerHTML = ``;
    ratedEl.innerHTML = ``;
    return;
  }

  // 1) Bewertete Shops aus Backend (immer korrekt, überlebt Clone-Delete)
  let rated = [];
  try {
    const res = await fetch('http://localhost:3000/me/ratings/shops', {
      headers: { ...authHeaders() }
    });
    const data = await res.json();
    rated = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('Fehler beim Laden bewerteter Läden:', e);
    rated = [];
  }

  const ratedIds = new Set(rated.map(s => Number(s.id)));

  // 2) Unbewertete Shops aus sichtbaren shops bestimmen
  //    Klon zählt als bewertet, wenn das Original bewertet ist
  const unrated = (shops || []).filter(s => {
    const id = Number(s.id);
    const orig = s.cloned_from_shop_id != null ? Number(s.cloned_from_shop_id) : null;

    if (ratedIds.has(id)) return false;
    if (orig != null && ratedIds.has(orig)) return false;

    return true;
  });

  const cardHtml = (shop, isRated) => {
    const fav = isFavorite(shop.id);
    const my = (typeof shop.my_rating === 'number') ? shop.my_rating : null;

    return `
      <div class="pixel-card shop-card">
        <button class="fav-btn card-fav ${fav ? 'is-fav' : ''}"
                title="${fav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}"
                onclick="toggleFavorite(${shop.id})">
          ${fav ? '★' : '☆'}
        </button>

        <h3>${shop.name}</h3>
        <p><strong>Adresse:</strong> ${shop.address}</p>
        <p><strong>Bewertung (Ø):</strong> ⭐ ${shop.rating}</p>
        <p><strong>Wartezeit:</strong> ${shop.wait_time || '—'}</p>

        ${isRated ? `<p><strong>Deine Bewertung:</strong> ⭐ ${my}</p>` : ``}

        <div class="row-actions">
          <button class="btn" onclick="openDetails(${shop.id})">Details</button>
          <button class="btn" onclick="openRateModal(${shop.id})">
            ${isRated ? 'Ändern' : 'Bewerten'}
          </button>
        </div>
      </div>
    `;
  };

  unratedEl.innerHTML = unrated.length
    ? unrated.map(s => cardHtml(s, false)).join('')
    : `<p>✅ Alles bewertet.</p>`;

  ratedEl.innerHTML = rated.length
    ? rated.map(s => cardHtml(s, true)).join('')
    : `<p>Noch keine Bewertungen abgegeben.</p>`;
}

window.openRateModal = openRateModal;

function initRateModal() {
  const modal = $('#rateModal');
  if (!modal) return;

  const range = $('#userRateRange');
  const fill = $('#userStarsFill');
  const val = $('#userRateValue');

  const cancel = $('#rateModalCancel');
  const submit = $('#rateModalSubmit');

  const update = () => {
    const v = Math.max(0.5, Math.min(5, Number(range?.value) || 0.5));
    if (fill) fill.style.width = `${(v / 5) * 100}%`;
    if (val) val.textContent = v.toFixed(1);
  };

  range?.addEventListener('input', update);
  update();

  cancel?.addEventListener('click', closeRateModal);
  modal.querySelector('.modal-backdrop')?.addEventListener('click', closeRateModal);

  submit?.addEventListener('click', async () => {
    const shopId = Number($('#rateModalShopId')?.value);
    const newRating = Number(range?.value);
    if (!shopId || !Number.isFinite(newRating)) return;
    await submitRating(shopId, newRating);
  });
}

function openRateModal(shopId) {
  if (!authToken) return;

  const shop = shops.find(s => s.id === shopId);
  if (!shop) return;

  const modal = $('#rateModal');
  if (!modal) return;

  const nameEl = $('#rateModalShopName');
  const idEl = $('#rateModalShopId');
  const msgEl = $('#rateModalMsg');

  const range = $('#userRateRange');
  const fill = $('#userStarsFill');
  const val = $('#userRateValue');

  if (msgEl) msgEl.textContent = '';
  if (nameEl) nameEl.textContent = shop.name;
  if (idEl) idEl.value = String(shopId);

  const my = (typeof shop.my_rating === 'number') ? shop.my_rating : null;
  if (range) range.value = String(my ?? 4.5);

  const v = Number(range?.value || 4.5);
  if (fill) fill.style.width = `${(v / 5) * 100}%`;
  if (val) val.textContent = v.toFixed(1);

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeRateModal() {
  const modal = $('#rateModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function submitRating(shopId, newRating) {
  if (!authToken) return;

  const msgEl = $('#rateModalMsg');
  if (msgEl) msgEl.textContent = '';

  const requestedId = Number(shopId);
  const ratingValue = Number(newRating);

  try {
    const res = await fetch(`http://localhost:3000/shops/${requestedId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ rating: ratingValue })
    });

    const data = await res.json();

    if (!res.ok) {
      if (msgEl) msgEl.textContent = data?.error || 'Fehler beim Bewerten.';
      return;
    }

    // Backend liefert:
    // data.rating         = neuer globaler Ø (vom Ziel-Shop, ggf. Original)
    // data.my_rating      = meine Bewertung
    // data.target_shop_id = Shop-ID, auf die wirklich bewertet wurde (Original oder requested)
    const targetId = Number(data?.target_shop_id || requestedId);

    // Lokale Shop-Objekte (falls vorhanden) nachziehen
    // - requestedId (kann Klon sein)
    // - targetId (Original)
    const updateLocalShop = (id) => {
      const s = (shops || []).find(x => Number(x.id) === Number(id));
      if (s) {
        s.rating = data.rating;
        s.my_rating = data.my_rating;
      }
      return s || null;
    };

    const sRequested = updateLocalShop(requestedId);
    const sTarget = (targetId !== requestedId) ? updateLocalShop(targetId) : sRequested;

    // Falls Popup auf requestedId oder targetId offen ist -> live updaten
    if (activePopupShopId === requestedId || activePopupShopId === targetId) {
      updateOpenPopupRating(data.rating);
    }

    // Details-Overlay live updaten (egal ob Klon/Original)
    const detailOpen = $('#shop-detail-view')?.classList.contains('active');
    if (detailOpen) {
      const name = $('#detail-shop-name')?.textContent;
      const ref = sRequested || sTarget;
      if (ref && name === ref.name) {
        const d = $('#detail-shop-rating');
        if (d) d.textContent = `⭐ ${data.rating}`;
      }
    }

    // Wichtig: Erst Shops neu laden (damit Map/Suche/Filter/Favs richtig sind),
    // dann UI neu rendern
    await refreshShopsEverywhere();

    // Wenn gerade TOP offen ist -> sofort aktualisieren
    if ($('#top')?.classList.contains('active')) await loadTopDoner();

    // Review ist async (bei dir), daher await
    if (typeof renderReview === 'function') await renderReview();

    // Suche neu zeichnen (nutzt __searchBaseList, wird über refreshShopsEverywhere/loadSearch aktualisiert,
    // aber wir ziehen die Anzeige sicherheitshalber nach)
    renderSearchResults();

    if ($('#favorites')?.classList.contains('active')) await renderFavorites();
    if ($('#community')?.classList.contains('active')) await loadCommunity();

    closeRateModal();
  } catch (err) {
    console.error(err);
    if (msgEl) msgEl.textContent = 'Server nicht erreichbar (läuft node server.js?).';
  }
}

/* =========================
   COMMUNITY VIEW
========================= */
async function fetchCommunityShops() {
  try {
    const res = await fetch('http://localhost:3000/community/shops', {
      headers: { ...authHeaders() }
    });
    return await res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function loadCommunity() {
  const list = await fetchCommunityShops();
  window.__communityList = Array.isArray(list) ? list : [];
  renderCommunity();
}

function renderCommunity() {
  const container = $('#communityList');
  if (!container) return;

  // Settings: bereits hinzugefügte Shops ausblenden
  const appS = getAppSettings();
  const hideAdded = Number(appS.communityHideAdded) === 1;

  const base = window.__communityList || [];
  const list = hideAdded
    ? base.filter(x => Number(x.is_added) !== 1)
    : base;

  if (!list.length) {
    container.innerHTML = hideAdded
      ? `<p>Keine neuen Community-Läden verfügbar (du hast schon alle hinzugefügt).</p>`
      : `<p>Noch keine Community-Läden verfügbar.</p>`;
    return;
  }

  container.innerHTML = list.map(shop => {
    const fav = isFavorite(shop.id);
    const owner = shop.owner_username ? String(shop.owner_username) : 'Unbekannt';
    const routeUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`;

    const isOwn = Number(shop.is_own) === 1;
    const added = Number(shop.is_added) === 1;
    const disabled = isOwn || added;
    const communityText = isOwn
      ? `<strong>Community:</strong> Du hast diesen Laden erstellt`
      : `<strong>Community:</strong> ${escapeHtml(owner)} hat diesen Laden hinzugefügt`;

    return `
      <div class="pixel-card shop-card ${disabled ? 'is-added' : ''} ${isOwn ? 'is-own' : ''}">
        <button class="fav-btn card-fav ${fav ? 'is-fav' : ''}"
                title="${fav ? 'Aus Merkliste entfernen' : 'Auf Merkliste speichern'}"
                onclick="toggleFavorite(${shop.id}, 'community')">
          ${fav ? '★' : '☆'}
        </button>

        <h3>${shop.name}</h3>
        <p><strong>Adresse:</strong> ${shop.address}</p>

        <p>${communityText}</p>
        <p><strong>Bewertung (Ø):</strong> ⭐ ${shop.rating}</p>

        <div class="row-actions">
          <button class="btn" onclick="openDetails(${shop.id})">Details</button>
          <button class="btn" onclick="openCommunityRatings(${shop.id}, '${escapeHtml(shop.name)}')">Bewertungen</button>
          <a class="btn" href="${routeUrl}" target="_blank" rel="noopener">Route</a>
          <button class="btn" onclick="cloneShopToMine(${shop.id}, { keepFavorite: false, fromFavoriteSource: 'community' })">Zu meinen Läden</button>
        </div>
      </div>
    `;
  }).join('');
}

// kleiner Helfer, damit Shop-Namen im onclick nicht kaputt gehen
function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

window.openCommunityRatings = openCommunityRatings;
window.cloneShopToMine = cloneShopToMine;

async function openCommunityRatings(shopId, shopName) {
  const modal = $('#communityRatingsModal');
  const title = $('#communityRatingsTitle');
  const body = $('#communityRatingsBody');

  if (!modal || !title || !body) return;

  title.textContent = `Bewertungen: ${shopName}`;
  body.innerHTML = `<p>Lade...</p>`;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  try {
    const res = await fetch(`http://localhost:3000/shops/${shopId}/ratings`, {
      headers: { ...authHeaders() }
    });
    const data = await res.json();

    if (!res.ok) {
      body.innerHTML = `<p>${data?.error || 'Fehler beim Laden.'}</p>`;
      return;
    }

    const ratings = Array.isArray(data.ratings) ? data.ratings : [];
    if (!ratings.length) {
      body.innerHTML = `<p>Noch keine Bewertungen von anderen Usern.</p>`;
      return;
    }

    body.innerHTML = `
      <ul>
        ${ratings.map(r => `
          <li>
            <strong>${escapeHtml(r.username)}</strong>:
            ⭐ ${Number(r.rating).toFixed(1)}
            <span class="muted">(${escapeHtml(r.updated_at || '')})</span>
          </li>
        `).join('')}
      </ul>
    `;
  } catch (e) {
    console.error(e);
    body.innerHTML = `<p>Server nicht erreichbar.</p>`;
  }
}

function closeCommunityRatings() {
  const modal = $('#communityRatingsModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

document.addEventListener('DOMContentLoaded', () => {
  $('#communityRatingsCloseBtn')?.addEventListener('click', closeCommunityRatings);
  $('#communityRatingsModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeCommunityRatings);
});

async function cloneShopToMine(shopId, options = {}) {
  if (!authToken) {
    openAuthModal('Bitte einloggen, um Läden zu deinen eigenen hinzuzufügen.');
    return;
  }

  const keepFavorite = !!options.keepFavorite;
  const fromFavoriteSource = (options.fromFavoriteSource === 'community') ? 'community' : 'normal';

  try {
    const res = await fetch(`http://localhost:3000/shops/${shopId}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ keepFavorite, fromFavoriteSource })
    });

    const data = await res.json();

    if (!res.ok) {
      openInfoModal('Fehler', data?.error || 'Kopieren fehlgeschlagen.');
      return;
    }

    // WICHTIG: Favoriten neu laden -> Stern auf Map/Suche stimmt wieder
    await loadFavoritesFromBackend();

    // Shops/UI aktualisieren
    await refreshShopsEverywhere(); 

    if ($('#community')?.classList.contains('active')) {
      await loadCommunity(); // holt is_added neu
    }

    // NICHT mehr zur "Hinzufügen" Seite springen!
    openInfoModal('Erfolg', '✅ Shop wurde zu deinen Läden hinzugefügt!');

  } catch (e) {
    console.error(e);
    openInfoModal('Fehler', 'Server nicht erreichbar.');
  }
}

/* =========================
   INFO / SUCCESS MODAL
========================= */
function openInfoModal(title, text, onOk) {
  const modal = $('#infoModal');
  const titleEl = $('#infoModalTitle');
  const textEl = $('#infoModalText');
  const okBtn = $('#infoModalOkBtn');

  if (!modal || !titleEl || !textEl || !okBtn) return;

  titleEl.textContent = title || 'Info';
  textEl.textContent = text || '';

  const close = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (typeof onOk === 'function') onOk();
  };

  okBtn.onclick = close;
  modal.querySelector('.modal-backdrop')?.addEventListener('click', close, { once: true });

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

/* =========================
   CLONE CHOICE MODAL (Favorites -> My Shops)
========================= */
let __cloneChoiceShopId = null;
let __cloneChoiceFromSource = 'normal';

function openCloneChoiceModal(shopId, fromSource = 'normal') {
  const modal = $('#cloneChoiceModal');
  if (!modal) return;

  __cloneChoiceShopId = Number(shopId);
  __cloneChoiceFromSource = (fromSource === 'community') ? 'community' : 'normal';

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCloneChoiceModal() {
  const modal = $('#cloneChoiceModal');
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  __cloneChoiceShopId = null;
  __cloneChoiceFromSource = 'normal';
}

function initCloneChoiceModal() {
  $('#cloneOnlyBtn')?.addEventListener('click', async () => {
    const id = Number(__cloneChoiceShopId);
    const src = __cloneChoiceFromSource;

    if (!Number.isFinite(id) || id <= 0) {
      closeCloneChoiceModal();
      openInfoModal('Fehler', 'Ungültige Shop-ID');
      return;
    }

    closeCloneChoiceModal();

    await cloneShopToMine(id, {
      keepFavorite: false,
      fromFavoriteSource: src
    });
  });

  $('#cloneAndFavBtn')?.addEventListener('click', async () => {
    const id = Number(__cloneChoiceShopId);
    const src = __cloneChoiceFromSource;

    if (!Number.isFinite(id) || id <= 0) {
      closeCloneChoiceModal();
      openInfoModal('Fehler', 'Ungültige Shop-ID');
      return;
    }

    closeCloneChoiceModal();

    await cloneShopToMine(id, {
      keepFavorite: true,
      fromFavoriteSource: src
    });
  });

  $('#cloneChoiceCancelBtn')?.addEventListener('click', closeCloneChoiceModal);
  $('#cloneChoiceModal')?.querySelector('.modal-backdrop')?.addEventListener('click', closeCloneChoiceModal);
}
