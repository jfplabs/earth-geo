/**
 * UI Controller — handles all UI interactions
 * Standalone version (no backend auth dependency for GitHub Pages demo)
 */

export class UIController {
  constructor(state, markerManager) {
    this.state = state;
    this.markerManager = markerManager;
    this.init();
  }

  init() {
    // Upload modal
    const btnUpload = document.getElementById('btn-upload');
    const uploadModal = document.getElementById('upload-modal');
    const uploadClose = document.getElementById('upload-close');
    const modalOverlay = uploadModal.querySelector('.modal-overlay');

    btnUpload.addEventListener('click', () => uploadModal.classList.remove('hidden'));
    uploadClose.addEventListener('click', () => uploadModal.classList.add('hidden'));
    modalOverlay.addEventListener('click', () => uploadModal.classList.add('hidden'));

    // Login button — show auth modal
    const btnLogin = document.getElementById('btn-login');
    const authModal = document.getElementById('auth-modal');
    const authClose = document.getElementById('auth-close');
    const authOverlay = authModal?.querySelector('.modal-overlay');

    if (btnLogin && authModal) {
      btnLogin.addEventListener('click', () => authModal.classList.remove('hidden'));
      authClose?.addEventListener('click', () => authModal.classList.add('hidden'));
      authOverlay?.addEventListener('click', () => authModal.classList.add('hidden'));

      // Toggle login/signup
      const showSignup = document.getElementById('show-signup');
      const showLogin = document.getElementById('show-login');
      if (showSignup) {
        showSignup.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById('auth-login')?.classList.add('hidden');
          document.getElementById('auth-signup')?.classList.remove('hidden');
        });
      }
      if (showLogin) {
        showLogin.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById('auth-signup')?.classList.add('hidden');
          document.getElementById('auth-login')?.classList.remove('hidden');
        });
      }

      // Login form submit (demo mode — just close modal)
      const loginForm = document.getElementById('login-form');
      loginForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email')?.value;
        if (email) {
          const name = email.split('@')[0];
          btnLogin.textContent = `👤 ${name}`;
          authModal.classList.add('hidden');
        }
      });

      // Signup form submit (demo mode)
      const signupForm = document.getElementById('signup-form');
      signupForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username')?.value || 'Pilot';
        btnLogin.textContent = `👤 ${username}`;
        authModal.classList.add('hidden');
      });
    }

    // Info panel
    const panelClose = document.getElementById('panel-close');
    panelClose.addEventListener('click', () => this.hideInfoPanel());

    // Explore button — toggle sidebar
    const btnExplore = document.getElementById('btn-explore');
    const sidebar = document.getElementById('sidebar');
    btnExplore.addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
      if (!sidebar.classList.contains('hidden')) {
        this.populateSidebar();
      }
    });

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    sidebarToggle.addEventListener('click', () => sidebar.classList.add('hidden'));

    // Upload form
    const uploadForm = document.getElementById('upload-form');
    uploadForm.addEventListener('submit', (e) => this.handleUpload(e));

    // Dropzone
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        this.showFileInfo(e.dataTransfer.files[0]);
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) this.showFileInfo(fileInput.files[0]);
    });

    // Auto-detect location button
    const btnDetect = document.getElementById('btn-detect-location');
    btnDetect.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          document.getElementById('upload-lat').value = pos.coords.latitude.toFixed(4);
          document.getElementById('upload-lng').value = pos.coords.longitude.toFixed(4);
        });
      }
    });

    // Search
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));

    // Populate sidebar on load
    this.populateSidebar();
  }

  showFileInfo(file) {
    const info = document.getElementById('file-info');
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    info.textContent = `📁 ${file.name} (${sizeMB} MB)`;
    info.classList.remove('hidden');
  }

  showInfoPanel(flight) {
    this.state.selectedFlight = flight;
    const panel = document.getElementById('info-panel');

    document.getElementById('panel-title').textContent = flight.title;
    document.getElementById('panel-pilot').textContent = `🎮 ${flight.pilot}`;
    document.getElementById('panel-location').textContent = `📍 ${flight.location}`;
    document.getElementById('panel-date').textContent = `📅 ${flight.date}`;
    document.getElementById('panel-description').textContent = flight.description;
    document.getElementById('panel-views').textContent = flight.views.toLocaleString();
    document.getElementById('panel-likes').textContent = flight.likes.toLocaleString();

    // Tags
    const tagsEl = document.getElementById('panel-tags');
    tagsEl.innerHTML = flight.tags.map(t => `<span class="tag">#${t}</span>`).join('');

    // Video placeholder
    const video = document.getElementById('panel-video');
    if (flight.videoUrl) {
      video.src = flight.videoUrl;
      video.style.display = 'block';
    } else {
      video.style.display = 'none';
    }

    panel.classList.remove('hidden');
  }

  hideInfoPanel() {
    document.getElementById('info-panel').classList.add('hidden');
    this.state.selectedFlight = null;
  }

  populateSidebar() {
    const list = document.getElementById('sidebar-list');
    const sorted = [...this.state.flights].sort((a, b) => b.views - a.views);

    list.innerHTML = sorted.map(flight => `
      <div class="sidebar-item" data-id="${flight.id}">
        <div class="sidebar-thumb">
          <div style="width:100%;height:100%;background:linear-gradient(135deg, #1a3a5c, #0d2f44);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🎬</div>
        </div>
        <div class="sidebar-info">
          <h4>${flight.title}</h4>
          <span>📍 ${flight.location}</span><br>
          <span>👁️ ${flight.views.toLocaleString()} • ❤️ ${flight.likes.toLocaleString()}</span>
        </div>
      </div>
    `).join('');

    // Click handlers
    list.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
        const flight = this.state.flights.find(f => f.id === id);
        if (flight) this.showInfoPanel(flight);
      });
    });
  }

  handleUpload(e) {
    e.preventDefault();

    const newFlight = {
      id: Date.now(),
      title: document.getElementById('upload-title').value,
      pilot: document.getElementById('upload-pilot').value || 'Anonymous Pilot',
      location: 'User Upload',
      lat: parseFloat(document.getElementById('upload-lat').value),
      lng: parseFloat(document.getElementById('upload-lng').value),
      description: document.getElementById('upload-description').value,
      tags: document.getElementById('upload-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      category: 'landscape',
      views: 0,
      likes: 0,
      date: new Date().toISOString().split('T')[0],
      thumbnail: '',
      videoUrl: '',
    };

    this.state.flights.push(newFlight);
    this.markerManager.addFlight(newFlight);
    this.populateSidebar();

    // Update stats
    document.getElementById('stat-videos').textContent = this.state.flights.length;

    // Close modal & reset form
    document.getElementById('upload-modal').classList.add('hidden');
    e.target.reset();
    document.getElementById('file-info').classList.add('hidden');

    // Show the new marker's info
    this.showInfoPanel(newFlight);
  }

  handleSearch(query) {
    if (!query) {
      this.populateSidebar();
      return;
    }

    const lower = query.toLowerCase();
    const filtered = this.state.flights.filter(f =>
      f.title.toLowerCase().includes(lower) ||
      f.location.toLowerCase().includes(lower) ||
      f.pilot.toLowerCase().includes(lower) ||
      f.tags.some(t => t.toLowerCase().includes(lower))
    );

    const list = document.getElementById('sidebar-list');
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('hidden');

    list.innerHTML = filtered.map(flight => `
      <div class="sidebar-item" data-id="${flight.id}">
        <div class="sidebar-thumb">
          <div style="width:100%;height:100%;background:linear-gradient(135deg, #1a3a5c, #0d2f44);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🎬</div>
        </div>
        <div class="sidebar-info">
          <h4>${flight.title}</h4>
          <span>📍 ${flight.location}</span><br>
          <span>👁️ ${flight.views.toLocaleString()} • ❤️ ${flight.likes.toLocaleString()}</span>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.sidebar-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.id);
        const flight = this.state.flights.find(f => f.id === id);
        if (flight) this.showInfoPanel(flight);
      });
    });
  }
}
