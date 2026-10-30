// Ứng dụng tra cứu bài hát đài Craven cho điện thoại
(function() {
  'use strict';

  // --- State ---
  let appData = { folders: [], tracks: [] };
  let mode = localStorage.getItem('craven_mode') || 'fat'; // 'fat' or 'nat'
  let currentTheme = localStorage.getItem('craven_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  let currentLang = 'all'; // 'all', 'en', 'vi'
  let currentFolder = 'all';
  let searchQuery = '';
  let filteredTracks = [];
  let displayedCount = 0;
  const PAGE_SIZE = 50;

  let dialedNumber = '';
  let favorites = new Set(JSON.parse(localStorage.getItem('craven_favs') || '[]'));
  let soundEnabled = localStorage.getItem('craven_sound') !== 'false';
  let audioCtx = null;
  let activeModalTrack = null;

  // --- DOM Elements ---
  const trackListEl = document.getElementById('trackList');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const folderSelect = document.getElementById('folderSelect');
  const resultCountText = document.getElementById('resultCountText');
  const currentModeLabel = document.getElementById('currentModeLabel');
  const modeToggleBtn = document.getElementById('modeToggleBtn');
  const modeIcon = document.getElementById('modeIcon');
  const modeText = document.getElementById('modeText');
  const lcdModeIndicator = document.getElementById('lcdModeIndicator');

  // Theme Elements
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeIcon = document.getElementById('themeIcon');
  const metaThemeColor = document.getElementById('metaThemeColor');

  // Keypad elements
  const screenDialNumber = document.getElementById('screenDialNumber');
  const screenTrackTitle = document.getElementById('screenTrackTitle');
  const screenTrackFolder = document.getElementById('screenTrackFolder');
  const screenTrackMeta = document.getElementById('screenTrackMeta');
  const btnPrevTrack = document.getElementById('btnPrevTrack');
  const btnNextTrack = document.getElementById('btnNextTrack');
  const btnCopyTrackNum = document.getElementById('btnCopyTrackNum');
  const btnSoundToggle = document.getElementById('btnSoundToggle');
  const soundIcon = document.getElementById('soundIcon');

  // Album & Fav elements
  const albumGridEl = document.getElementById('albumGrid');
  const favListEl = document.getElementById('favList');
  const favEmptyState = document.getElementById('favEmptyState');
  const favCountText = document.getElementById('favCountText');
  const clearAllFavBtn = document.getElementById('clearAllFavBtn');

  // Modal & Toast
  const trackModal = document.getElementById('trackModal');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalBigNumber = document.getElementById('modalBigNumber');
  const modalSongName = document.getElementById('modalSongName');
  const modalAlbumName = document.getElementById('modalAlbumName');
  const modalFavBtn = document.getElementById('modalFavBtn');
  const modalCopyBtn = document.getElementById('modalCopyBtn');
  const toastEl = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  // --- Helpers ---
  function removeAccents(str) {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase();
  }

  function formatTrackNum(num) {
    return String(num).padStart(4, '0');
  }

  function showToast(msg) {
    toastMsg.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2000);
  }

  function playKeyClick() {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(650, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    } catch (e) {
      // Audio not permitted or supported
    }
  }

  // --- Theme Management ---
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('craven_theme', theme);

    if (theme === 'dark') {
      themeIcon.className = 'ph-bold ph-sun';
      themeToggleBtn.title = 'Chuyển sang giao diện Sáng';
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#090D16');
    } else {
      themeIcon.className = 'ph-bold ph-moon';
      themeToggleBtn.title = 'Chuyển sang giao diện Tối';
      if (metaThemeColor) metaThemeColor.setAttribute('content', '#0F172A');
    }
  }

  function toggleTheme() {
    const newTheme = (currentTheme === 'dark') ? 'light' : 'dark';
    applyTheme(newTheme);
    showToast(newTheme === 'dark' ? 'Đã bật chế độ Tối (Dark Mode) 🌙' : 'Đã bật chế độ Sáng ☀️');
  }

  // --- Initialize App ---
  async function init() {
    registerServiceWorker();
    applyTheme(currentTheme);
    setupEventListeners();
    updateModeUI();
    updateSoundUI();

    try {
      const res = await fetch('tracks_data.json');
      appData = await res.json();
      populateFolderSelect();
      renderAlbums();
      filterTracks();
      renderFavorites();
    } catch (err) {
      console.error('Error loading tracks data:', err);
      trackListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap">
            <i class="ph-bold ph-warning"></i>
          </div>
          <div class="empty-title">Không thể tải dữ liệu</div>
          <div class="empty-text">Vui lòng kiểm tra lại kết nối mạng hoặc thử lại sau!</div>
        </div>`;
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(err => {
        console.log('SW registration error:', err);
      });
    }
  }

  // --- Folder Select Dropdown ---
  function populateFolderSelect() {
    folderSelect.innerHTML = '<option value="all">📁 Tất cả 70 album / chủ đề</option>';
    appData.folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      const range = mode === 'fat' 
        ? `${formatTrackNum(f.fatStart)} - ${formatTrackNum(f.fatEnd)}`
        : `${formatTrackNum(f.natStart)} - ${formatTrackNum(f.natEnd)}`;
      opt.textContent = `[${range}] ${f.name}`;
      folderSelect.appendChild(opt);
    });
  }

  // --- Mode Switching ---
  function updateModeUI() {
    if (mode === 'fat') {
      modeIcon.className = 'ph-bold ph-radio';
      modeText.textContent = 'Đài FAT';
      currentModeLabel.innerHTML = '<i class="ph ph-hash"></i> Số đài FAT';
      currentModeLabel.style.color = '#3B82F6';
      lcdModeIndicator.textContent = 'FAT MODE';
      lcdModeIndicator.style.color = '#34D399';
    } else {
      modeIcon.className = 'ph-bold ph-sort-ascending';
      modeText.textContent = 'Chuẩn';
      currentModeLabel.innerHTML = '<i class="ph ph-hash"></i> Số thứ tự chuẩn';
      currentModeLabel.style.color = '#22C55E';
      lcdModeIndicator.textContent = 'LOGIC MODE';
      lcdModeIndicator.style.color = '#60A5FA';
    }
    localStorage.setItem('craven_mode', mode);
  }

  function toggleMode() {
    mode = (mode === 'fat') ? 'nat' : 'fat';
    updateModeUI();
    populateFolderSelect();
    renderAlbums();
    filterTracks();
    if (dialedNumber) {
      updateDialDisplay();
    }
    showToast(mode === 'fat' ? 'Chuyển sang: Thứ tự đài FAT' : 'Chuyển sang: Thứ tự chuẩn');
  }

  function updateSoundUI() {
    if (soundEnabled) {
      soundIcon.className = 'ph-bold ph-speaker-high';
      btnSoundToggle.classList.remove('muted');
    } else {
      soundIcon.className = 'ph-bold ph-speaker-slash';
      btnSoundToggle.classList.add('muted');
    }
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem('craven_sound', soundEnabled);
    updateSoundUI();
    showToast(soundEnabled ? 'Đã bật âm thanh phím' : 'Đã tắt âm thanh phím');
  }

  // --- Track Filtering ---
  function filterTracks() {
    const rawQuery = removeAccents(searchQuery.trim());
    const queryTokens = rawQuery ? rawQuery.split(/\s+/) : [];

    filteredTracks = appData.tracks.filter(track => {
      // Language filter
      if (currentLang !== 'all' && track.l !== currentLang) {
        return false;
      }
      // Folder filter
      if (currentFolder !== 'all' && track.f !== parseInt(currentFolder, 10)) {
        return false;
      }
      // Search query
      if (queryTokens.length > 0) {
        for (const token of queryTokens) {
          if (!track.sk.includes(token)) {
            return false;
          }
        }
      }
      return true;
    });

    // Sort according to current mode
    if (mode === 'fat') {
      filteredTracks.sort((a, b) => a.i - b.i);
    } else {
      filteredTracks.sort((a, b) => a.n - b.n);
    }

    resultCountText.textContent = `Đang hiển thị ${filteredTracks.length.toLocaleString('vi-VN')} bài`;

    trackListEl.innerHTML = '';
    displayedCount = 0;
    renderMoreTracks();
  }

  // --- Render Track Cards (Incremental Scrolling) ---
  function renderMoreTracks() {
    if (filteredTracks.length === 0) {
      trackListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap">
            <i class="ph-duotone ph-magnifying-glass"></i>
          </div>
          <div class="empty-title">Không tìm thấy bài hát nào</div>
          <div class="empty-text">Hãy thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc album!</div>
        </div>`;
      return;
    }

    const nextBatch = filteredTracks.slice(displayedCount, displayedCount + PAGE_SIZE);
    if (nextBatch.length === 0) return;

    const fragment = document.createDocumentFragment();

    nextBatch.forEach(track => {
      const trackNum = mode === 'fat' ? track.i : track.n;
      const formattedNum = formatTrackNum(trackNum);
      const isFav = favorites.has(track.i);

      const card = document.createElement('div');
      card.className = 'track-card';
      card.dataset.id = track.i;

      const langIcon = track.l === 'en' ? '<i class="ph ph-translate"></i>' : '<i class="ph ph-chat-circle-dots"></i>';
      const langText = track.l === 'en' ? 'Tiếng Anh' : 'Tiếng Việt';

      card.innerHTML = `
        <div class="track-number-badge ${mode === 'nat' ? 'nat-mode' : ''}">
          <span class="track-num-label">BÀI</span>
          <span class="track-num-val">${formattedNum}</span>
        </div>
        <div class="track-info">
          <div class="track-title">${escapeHtml(track.t)}</div>
          <div class="track-meta">
            <span class="lang-tag ${track.l}">${langIcon} ${langText}</span>
            <span class="track-folder-name" title="${escapeHtml(track.fn)}">
              <i class="ph ph-folder"></i> ${escapeHtml(track.fn)}
            </span>
          </div>
        </div>
        <div class="card-actions">
          <button class="fav-btn ${isFav ? 'active' : ''}" data-fav-id="${track.i}" title="Lưu yêu thích" aria-label="Lưu yêu thích">
            <i class="${isFav ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>
          </button>
        </div>
      `;

      // Open detail modal on card click
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-btn')) return;
        openTrackModal(track);
      });

      // Fav button click
      const favBtn = card.querySelector('.fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track.i, favBtn);
      });

      fragment.appendChild(card);
    });

    trackListEl.appendChild(fragment);
    displayedCount += nextBatch.length;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Favorites Management ---
  function toggleFavorite(trackId, btnEl) {
    if (favorites.has(trackId)) {
      favorites.delete(trackId);
      if (btnEl) {
        btnEl.classList.remove('active');
        btnEl.innerHTML = '<i class="ph ph-heart"></i>';
      }
      showToast('Đã xóa khỏi danh sách yêu thích');
    } else {
      favorites.add(trackId);
      if (btnEl) {
        btnEl.classList.add('active');
        btnEl.innerHTML = '<i class="ph-fill ph-heart"></i>';
      }
      showToast('Đã thêm vào yêu thích ❤️');
    }
    localStorage.setItem('craven_favs', JSON.stringify(Array.from(favorites)));
    renderFavorites();
  }

  function renderFavorites() {
    const favArray = Array.from(favorites);
    favCountText.textContent = `${favArray.length} bài yêu thích`;

    if (favArray.length === 0) {
      favEmptyState.style.display = 'block';
      favListEl.style.display = 'none';
      return;
    }

    favEmptyState.style.display = 'none';
    favListEl.style.display = 'flex';
    favListEl.innerHTML = '';

    const favTracks = appData.tracks.filter(t => favorites.has(t.i));
    if (mode === 'fat') {
      favTracks.sort((a, b) => a.i - b.i);
    } else {
      favTracks.sort((a, b) => a.n - b.n);
    }

    favTracks.forEach(track => {
      const trackNum = mode === 'fat' ? track.i : track.n;
      const formattedNum = formatTrackNum(trackNum);

      const langIcon = track.l === 'en' ? '<i class="ph ph-translate"></i>' : '<i class="ph ph-chat-circle-dots"></i>';
      const langText = track.l === 'en' ? 'Tiếng Anh' : 'Tiếng Việt';

      const card = document.createElement('div');
      card.className = 'track-card';
      card.innerHTML = `
        <div class="track-number-badge ${mode === 'nat' ? 'nat-mode' : ''}">
          <span class="track-num-label">BÀI</span>
          <span class="track-num-val">${formattedNum}</span>
        </div>
        <div class="track-info">
          <div class="track-title">${escapeHtml(track.t)}</div>
          <div class="track-meta">
            <span class="lang-tag ${track.l}">${langIcon} ${langText}</span>
            <span class="track-folder-name"><i class="ph ph-folder"></i> ${escapeHtml(track.fn)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="fav-btn active" data-fav-id="${track.i}" title="Bỏ yêu thích">
            <i class="ph-fill ph-heart"></i>
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-btn')) return;
        openTrackModal(track);
      });

      card.querySelector('.fav-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track.i, null);
      });

      favListEl.appendChild(card);
    });
  }

  // --- Album View Rendering ---
  let activeAlbumLang = 'all';

  function renderAlbums() {
    albumGridEl.innerHTML = '';
    const filteredFolders = appData.folders.filter(f => {
      if (activeAlbumLang === 'all') return true;
      return f.lang === activeAlbumLang;
    });

    filteredFolders.forEach(folder => {
      const range = mode === 'fat'
        ? `${formatTrackNum(folder.fatStart)} - ${formatTrackNum(folder.fatEnd)}`
        : `${formatTrackNum(folder.natStart)} - ${formatTrackNum(folder.natEnd)}`;

      const langIcon = folder.lang === 'en' ? '<i class="ph ph-translate"></i>' : '<i class="ph ph-chat-circle-dots"></i>';
      const langText = folder.lang === 'en' ? 'Tiếng Anh' : 'Tiếng Việt';

      const card = document.createElement('div');
      card.className = 'album-card';
      card.innerHTML = `
        <div class="album-header">
          <div class="album-title">${escapeHtml(folder.name)}</div>
          <span class="album-range-badge"># ${range}</span>
        </div>
        <div class="album-desc">${escapeHtml(folder.desc || '')}</div>
        <div class="album-footer">
          <span class="lang-tag ${folder.lang}">${langIcon} ${langText}</span>
          <span class="album-count-tag">
            <i class="ph-bold ph-music-notes"></i> ${folder.count} bài
            <i class="ph ph-caret-right" style="font-size:12px; color:#94A3B8;"></i>
          </span>
        </div>
      `;

      // Tap to filter by this album in search tab
      card.addEventListener('click', () => {
        switchView('search');
        folderSelect.value = folder.id;
        currentFolder = folder.id;
        filterTracks();
      });

      albumGridEl.appendChild(card);
    });
  }

  // --- Keypad Simulator Logic ---
  function handleKeypadPress(key) {
    playKeyClick();

    if (key === 'clear') {
      dialedNumber = '';
    } else if (key === 'backspace') {
      dialedNumber = dialedNumber.slice(0, -1);
    } else if (dialedNumber.length < 4) {
      dialedNumber += key;
    }

    updateDialDisplay();
  }

  function updateDialDisplay() {
    if (!dialedNumber) {
      screenDialNumber.textContent = '----';
      screenTrackTitle.textContent = 'Bấm số trên bàn phím';
      screenTrackFolder.innerHTML = '<i class="ph ph-folder-open"></i> để tra nhanh tên bài hát & album';
      screenTrackMeta.textContent = 'Phạm vi số từ 0001 đến 1717';
      return;
    }

    const numVal = parseInt(dialedNumber, 10);
    screenDialNumber.textContent = dialedNumber.padStart(4, '0');

    if (numVal < 1 || numVal > 1717) {
      screenTrackTitle.textContent = 'Không tìm thấy bài số ' + numVal;
      screenTrackFolder.innerHTML = '<i class="ph ph-warning-circle"></i> Thẻ nhớ chỉ có bài từ 0001 đến 1717';
      screenTrackMeta.textContent = 'Vui lòng bấm lại số khác';
      return;
    }

    // Find track by mode
    const foundTrack = appData.tracks.find(t => (mode === 'fat' ? t.i === numVal : t.n === numVal));

    if (foundTrack) {
      screenTrackTitle.textContent = foundTrack.t;
      screenTrackFolder.innerHTML = `<i class="ph ph-folder"></i> ${escapeHtml(foundTrack.fn)}`;
      screenTrackMeta.textContent = `${foundTrack.l === 'en' ? '🇬🇧 Tiếng Anh' : '🇻🇳 Tiếng Việt'} • Phím bấm: ${formatTrackNum(numVal)}`;
    }
  }

  function stepKeypadTrack(delta) {
    playKeyClick();
    let currentNum = dialedNumber ? parseInt(dialedNumber, 10) : 1;
    let newNum = currentNum + delta;
    if (newNum < 1) newNum = 1717;
    if (newNum > 1717) newNum = 1;
    dialedNumber = String(newNum);
    updateDialDisplay();
  }

  // --- Modal Detail ---
  function openTrackModal(track) {
    activeModalTrack = track;
    const trackNum = mode === 'fat' ? track.i : track.n;
    modalBigNumber.textContent = formatTrackNum(trackNum);
    modalSongName.textContent = track.t;
    modalAlbumName.textContent = `Thuộc album: ${track.fn} (${track.l === 'en' ? 'Tiếng Anh' : 'Tiếng Việt'})`;

    const isFav = favorites.has(track.i);
    modalFavBtn.innerHTML = `<i class="${isFav ? 'ph-fill ph-heart' : 'ph-bold ph-heart'}" style="${isFav ? 'color:#EF4444;' : ''}"></i> <span>${isFav ? 'Đã lưu yêu thích' : 'Lưu yêu thích'}</span>`;

    trackModal.classList.add('active');
  }

  function closeModal() {
    trackModal.classList.remove('active');
    activeModalTrack = null;
  }

  // --- View Navigation ---
  function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

    const targetSection = document.getElementById('view-' + viewName);
    const targetNavBtn = document.querySelector(`.nav-item[data-view="${viewName}"]`);

    if (targetSection) targetSection.classList.add('active');
    if (targetNavBtn) targetNavBtn.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Theme toggle
    themeToggleBtn.addEventListener('click', toggleTheme);

    // Mode toggle
    modeToggleBtn.addEventListener('click', toggleMode);

    // Sound toggle
    btnSoundToggle.addEventListener('click', toggleSound);

    // Search input
    let searchTimeout = null;
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      clearSearchBtn.style.display = searchQuery ? 'flex' : 'none';
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filterTracks();
      }, 150);
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.style.display = 'none';
      filterTracks();
      searchInput.focus();
    });

    // Language pills (Search tab)
    document.querySelectorAll('.filter-scroll .pill-btn[data-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-scroll .pill-btn[data-lang]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLang = btn.dataset.lang;
        filterTracks();
      });
    });

    // Album language pills
    document.querySelectorAll('#view-albums .pill-btn[data-album-lang]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#view-albums .pill-btn[data-album-lang]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeAlbumLang = btn.dataset.albumLang;
        renderAlbums();
      });
    });

    // Folder select
    folderSelect.addEventListener('change', (e) => {
      currentFolder = e.target.value;
      filterTracks();
    });

    // Infinite scroll
    window.addEventListener('scroll', () => {
      if (document.getElementById('view-search').classList.contains('active')) {
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
          renderMoreTracks();
        }
      }
    });

    // Keypad buttons
    document.querySelectorAll('.key-btn[data-num]').forEach(btn => {
      btn.addEventListener('click', () => {
        handleKeypadPress(btn.dataset.num);
      });
    });

    document.getElementById('keyBackspace').addEventListener('click', () => {
      handleKeypadPress('backspace');
    });

    document.getElementById('keyClear').addEventListener('click', () => {
      handleKeypadPress('clear');
    });

    btnPrevTrack.addEventListener('click', () => stepKeypadTrack(-1));
    btnNextTrack.addEventListener('click', () => stepKeypadTrack(1));

    btnCopyTrackNum.addEventListener('click', () => {
      if (dialedNumber) {
        const numStr = dialedNumber.padStart(4, '0');
        navigator.clipboard.writeText(numStr);
        showToast(`Đã sao chép số: ${numStr}`);
      }
    });

    // Modal buttons
    modalCloseBtn.addEventListener('click', closeModal);
    trackModal.addEventListener('click', (e) => {
      if (e.target === trackModal) closeModal();
    });

    modalCopyBtn.addEventListener('click', () => {
      if (activeModalTrack) {
        const num = formatTrackNum(mode === 'fat' ? activeModalTrack.i : activeModalTrack.n);
        navigator.clipboard.writeText(num);
        showToast(`Đã sao chép số bài: ${num}`);
      }
    });

    modalFavBtn.addEventListener('click', () => {
      if (activeModalTrack) {
        toggleFavorite(activeModalTrack.i, null);
        const isFav = favorites.has(activeModalTrack.i);
        modalFavBtn.innerHTML = `<i class="${isFav ? 'ph-fill ph-heart' : 'ph-bold ph-heart'}" style="${isFav ? 'color:#EF4444;' : ''}"></i> <span>${isFav ? 'Đã lưu yêu thích' : 'Lưu yêu thích'}</span>`;
        // Also update card in search list if visible
        const cardFavBtn = document.querySelector(`.track-card[data-id="${activeModalTrack.i}"] .fav-btn`);
        if (cardFavBtn) {
          cardFavBtn.innerHTML = `<i class="${isFav ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>`;
          cardFavBtn.classList.toggle('active', isFav);
        }
      }
    });

    // Clear all favorites
    clearAllFavBtn.addEventListener('click', () => {
      if (confirm('Bạn có chắc muốn xóa tất cả bài hát yêu thích?')) {
        favorites.clear();
        localStorage.removeItem('craven_favs');
        renderFavorites();
        document.querySelectorAll('.track-card .fav-btn').forEach(btn => {
          btn.innerHTML = '<i class="ph ph-heart"></i>';
          btn.classList.remove('active');
        });
        showToast('Đã xóa tất cả bài yêu thích');
      }
    });

    // Bottom nav bar
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        switchView(btn.dataset.view);
      });
    });

    // Listen to system theme changes if user hasn't explicitly set preference
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        if (!localStorage.getItem('craven_theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  // Run on page load
  document.addEventListener('DOMContentLoaded', init);
})();
