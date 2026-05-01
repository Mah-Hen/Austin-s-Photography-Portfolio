/**
 * app.js — Main application controller
 *
 * Auth strategy:
 *  - A discreet 🔒 lock icon sits in the nav at all times
 *  - Clicking it opens a login modal (Supabase Auth — email + password)
 *  - On successful login, the Upload nav link appears and the upload page unlocks
 *  - On logout (🔓, click again), session is cleared and upload disappears
 *  - Authorized users are managed in Supabase Dashboard → Authentication → Users
 *  - The Edge Function verifies the Supabase JWT on every upload request
 */

import { fetchPhotos, getSupabaseClient } from './supabase.js';
import { compressImage, validateFile } from './compress.js';
import CONFIG from './config.js';

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
const state = {
  photos: [],
  selectedFiles: [],
  user: null,       // Supabase Auth user object, or null if logged out
  uploading: false,
};

// ─────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ─────────────────────────────────────────────
// Router — hash-based navigation
// ─────────────────────────────────────────────
const ROUTES = {
  '':         'page-home',
  '#gallery': 'page-gallery',
  '#upload':  'page-upload',
};

function navigate(hash) {
  // Guard: redirect to home if trying to reach upload while logged out
  if (hash === '#upload' && !state.user) {
    location.hash = '';
    showToast('Please log in to access the upload page.', 'error');
    return;
  }

  const pageId = ROUTES[hash] ?? 'page-home';

  $$('.page').forEach(p => p.classList.remove('active'));
  $(`#${pageId}`)?.classList.add('active');

  $$('.nav-links a[data-route]').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === (hash || '#'));
  });

  $('#nav-menu').classList.remove('open');
  $('#nav-toggle').classList.remove('open');

  if (pageId === 'page-gallery') loadGallery();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

window.addEventListener('hashchange', () => navigate(location.hash));

// ─────────────────────────────────────────────
// Supabase Auth
// ─────────────────────────────────────────────
async function initAuth() {
  const supabase = getSupabaseClient();

  // Restore session on page load (Supabase persists it in localStorage)
  const { data: { session } } = await supabase.auth.getSession();
  state.user = session?.user ?? null;
  updateAuthUI();

  // React to login/logout events (including token refresh)
  supabase.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user ?? null;
    updateAuthUI();
    // Boot user off upload page if they log out
    if (!state.user && location.hash === '#upload') location.hash = '';
  });

  // Lock icon in nav
  $('#nav-lock')?.addEventListener('click', () => {
    if (state.user) {
      if (confirm(`Sign out of ${state.user.email}?`)) handleLogout();
    } else {
      openLoginModal();
    }
  });

  // Login form
  $('#login-submit')?.addEventListener('click', handleLogin);
  $('#login-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#login-password')?.focus();
  });
  $('#login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
  $('#login-close')?.addEventListener('click', closeLoginModal);
  $('#login-modal')?.addEventListener('click', e => {
    if (e.target === $('#login-modal')) closeLoginModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#login-modal')?.classList.contains('open')) {
      closeLoginModal();
    }
  });
}

async function handleLogin() {
  const email    = $('#login-email')?.value.trim();
  const password = $('#login-password')?.value;
  const btn      = $('#login-submit');
  const errorEl  = $('#login-error');

  if (!email || !password) {
    errorEl.textContent = 'Please enter your email and password.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span>';
  errorEl.textContent = '';

  const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });

  btn.disabled = false;
  btn.textContent = 'Sign In →';

  if (error) {
    errorEl.textContent = 'Incorrect email or password.';
  } else {
    closeLoginModal();
    showToast('Welcome back!', 'success');
    location.hash = '#upload';
  }
}

async function handleLogout() {
  await getSupabaseClient().auth.signOut();
  showToast('Signed out successfully.', '');
}

function updateAuthUI() {
  const lockIcon   = $('#nav-lock-icon');
  const uploadLink = $('#nav-upload-link');
  const userEmail  = $('#nav-user-email');

  if (state.user) {
    if (lockIcon)   lockIcon.textContent = '🔓';
    if (uploadLink) uploadLink.hidden = false;
    if (userEmail) {
      userEmail.textContent = state.user.email;
      userEmail.hidden = false;
    }
  } else {
    if (lockIcon)   lockIcon.textContent = '🔒';
    if (uploadLink) uploadLink.hidden = true;
    if (userEmail)  userEmail.hidden = true;
  }
}

function openLoginModal() {
  $('#login-modal')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#login-email')?.focus(), 100);
}

function closeLoginModal() {
  $('#login-modal')?.classList.remove('open');
  document.body.style.overflow = '';
  if ($('#login-error')) $('#login-error').textContent = '';
  if ($('#login-email'))    $('#login-email').value = '';
  if ($('#login-password')) $('#login-password').value = '';
}

// ─────────────────────────────────────────────
// Gallery
// ─────────────────────────────────────────────
async function loadGallery() {
  const grid    = $('#gallery-grid');
  const empty   = $('#gallery-empty');
  const countEl = $('#gallery-count');

  grid.innerHTML = renderSkeletons(6);
  empty.hidden = true;

  try {
    state.photos = await fetchPhotos();
    renderGallery(state.photos);
    if (countEl) countEl.textContent = state.photos.length;
  } catch (err) {
    console.error('Gallery load error:', err);
    grid.innerHTML = '';
    empty.hidden = false;
    showToast('Failed to load gallery. Check your Supabase config.', 'error');
  }
}

function renderGallery(photos) {
  const grid  = $('#gallery-grid');
  const empty = $('#gallery-empty');

  if (!photos.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  grid.innerHTML = photos.map((photo, i) => `
    <div class="gallery-item"
         style="animation-delay: ${Math.min(i * 60, 400)}ms"
         data-id="${photo.id}"
         data-index="${i}">
      <img src="${photo.public_url}" alt="${escapeHtml(photo.title)}"
           loading="lazy" decoding="async" />
      <div class="gallery-item-overlay">
        <span class="gallery-item-title">${escapeHtml(photo.title)}</span>
        <span class="gallery-item-date">${formatDate(photo.created_at)}</span>
      </div>
    </div>
  `).join('');

  $$('.gallery-item', grid).forEach(item => {
    item.addEventListener('click', () => openLightbox(parseInt(item.dataset.index)));
  });
}

function renderSkeletons(count) {
  return Array.from({ length: count }, (_, i) => `
    <div class="gallery-item" style="animation-delay:${i * 80}ms">
      <div style="
        background: linear-gradient(90deg, var(--ink-20) 25%, rgba(26,23,20,0.05) 50%, var(--ink-20) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.4s infinite;
        aspect-ratio: ${[1, 0.75, 1.3][i % 3]};
        border-radius: var(--radius);
      "></div>
    </div>
  `).join('') + `<style>
    @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  </style>`;
}

function renderFeatured() {
  if (!state.photos.length) return;
  const grid = $('#featured-grid');
  if (!grid) return;
  grid.innerHTML = state.photos.slice(0, 3).map(p => `
    <div class="featured-card" onclick="location.hash='#gallery'">
      <img src="${p.public_url}" alt="${escapeHtml(p.title)}" loading="lazy" />
      <div class="featured-card-overlay"><span>${escapeHtml(p.title)}</span></div>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────
let currentLightboxIndex = 0;

function openLightbox(index) {
  const photo = state.photos[index];
  if (!photo) return;
  currentLightboxIndex = index;
  const lb = $('#lightbox');
  lb.querySelector('img').src = photo.public_url;
  lb.querySelector('.lightbox-caption').textContent =
    [photo.title, photo.caption].filter(Boolean).join(' — ');
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  $('#lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

// ─────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────
function initUpload() {
  const dropZone     = $('#drop-zone');
  const fileInput    = $('#file-input');
  const previewGrid  = $('#preview-grid');
  const submitBtn    = $('#submit-btn');
  const progressWrap = $('#upload-progress');
  const progressFill = $('#progress-fill');
  const progressLabel = $('#progress-label');

  if (!dropZone) return;

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files]);
    fileInput.value = '';
  });

  $('#upload-form-inner')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (state.uploading || !state.selectedFiles.length) return;
    await submitUpload();
  });

  function handleFiles(files) {
    files.forEach(file => {
      const result = validateFile(file);
      if (!result.valid) { showToast(result.error, 'error'); return; }
      state.selectedFiles.push(file);
    });
    renderPreviews();
  }

  function renderPreviews() {
    previewGrid.innerHTML = state.selectedFiles.map((file, i) => {
      const url = URL.createObjectURL(file);
      return `
        <div class="preview-item" data-index="${i}">
          <img src="${url}" alt="Preview ${i + 1}" />
          <button class="preview-item-remove" data-index="${i}" title="Remove">✕</button>
        </div>`;
    }).join('');

    $$('.preview-item-remove', previewGrid).forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        URL.revokeObjectURL(previewGrid.querySelectorAll('.preview-item img')[idx]?.src);
        state.selectedFiles.splice(idx, 1);
        renderPreviews();
      });
    });

    if (submitBtn) submitBtn.disabled = state.selectedFiles.length === 0;
  }

  async function submitUpload() {
    // Get fresh JWT — Supabase auto-refreshes it, but always fetch latest
    const { data: { session } } = await getSupabaseClient().auth.getSession();
    if (!session) {
      showToast('Session expired. Please log in again.', 'error');
      location.hash = '';
      return;
    }

    const title   = $('#title-input')?.value.trim() || '';
    const caption = $('#caption-input')?.value.trim() || '';

    state.uploading = true;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-spinner"></span> Uploading…';
    progressWrap.classList.add('visible');

    const total = state.selectedFiles.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const file = state.selectedFiles[i];
      const fileLabel = `${i + 1}/${total}: ${file.name}`;

      try {
        progressFill.style.width = '5%';
        progressLabel.textContent = `Compressing ${fileLabel}…`;
        const compressed = await compressImage(file);

        progressFill.style.width = '20%';
        progressLabel.textContent = `Preparing ${fileLabel}…`;
        const fileBase64 = await fileToBase64(compressed);

        progressFill.style.width = '40%';
        progressLabel.textContent = `Uploading ${fileLabel}…`;

        const res = await fetch(CONFIG.edgeFunctionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // JWT sent here — Edge Function calls supabase.auth.getUser(token)
            // to verify the user is legitimate. No plain password needed.
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            fileBase64,
            fileName: `uploads/${Date.now()}_${compressed.name}`,
            title: total === 1 ? title : `${title || 'Photo'} ${i + 1}`,
            caption,
            sizeBytes: compressed.size,
          }),
        });

        if (!res.ok) throw new Error((await res.text()) || `Server error ${res.status}`);

        progressFill.style.width = `${((i + 1) / total) * 100}%`;
        progressLabel.textContent = `Done: ${fileLabel}`;
        successCount++;

      } catch (err) {
        console.error(`Upload failed for ${file.name}:`, err);
        showToast(`Failed: ${file.name}. ${err.message}`, 'error');
      }
    }

    state.uploading = false;
    state.selectedFiles = [];
    renderPreviews();
    progressFill.style.width = '100%';
    progressLabel.textContent = `Done! ${successCount}/${total} uploaded.`;
    setTimeout(() => {
      progressWrap.classList.remove('visible');
      progressFill.style.width = '0%';
    }, 2000);

    submitBtn.innerHTML = 'Upload Images';
    submitBtn.disabled = false;
    $('#title-input').value = '';
    $('#caption-input').value = '';

    if (successCount > 0) {
      showToast(`${successCount} image${successCount > 1 ? 's' : ''} uploaded!`, 'success');
      fetchPhotos().then(photos => { state.photos = photos; });
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = '') {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}
window.showToast = showToast;

// ─────────────────────────────────────────────
// Home
// ─────────────────────────────────────────────
async function initHome() {
  try {
    state.photos = await fetchPhotos();
    const countEl = $('#home-photo-count');
    if (countEl) countEl.textContent = state.photos.length;
    renderFeatured();
  } catch (e) {
    console.info('Supabase not configured yet:', e.message);
  }
}

// ─────────────────────────────────────────────
// Nav hamburger
// ─────────────────────────────────────────────
function initNav() {
  $('#nav-toggle')?.addEventListener('click', () => {
    $('#nav-toggle').classList.toggle('open');
    $('#nav-menu').classList.toggle('open');
  });
}

// ─────────────────────────────────────────────
// Lightbox setup
// ─────────────────────────────────────────────
function initLightbox() {
  const lb = $('#lightbox');
  lb?.querySelector('.lightbox-close')?.addEventListener('click', closeLightbox);
  lb?.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (!lb?.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') openLightbox((currentLightboxIndex + 1) % state.photos.length);
    if (e.key === 'ArrowLeft') openLightbox((currentLightboxIndex - 1 + state.photos.length) % state.photos.length);
  });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initLightbox();
  initUpload();
  await initAuth();              // must complete before first navigate
  navigate(location.hash || '');
  initHome();
});