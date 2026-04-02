/**
 * Upload Modal — Earth Geo
 * Handles drone footage upload with drag-and-drop, progress bar, and validation.
 */
import api from '../api.js';
import { showToast } from './toast.js';

export class UploadModal {
  constructor() {
    this.modal = document.getElementById('upload-modal');
    this.form = document.getElementById('upload-form');
    this.dropzone = document.getElementById('dropzone');
    this.fileInput = document.getElementById('file-input');
    this.fileInfo = document.getElementById('file-info');
    this.selectedFile = null;
    this.isUploading = false;

    if (this.modal) {
      this._bind();
    }
  }

  // ---- Public ----

  show() {
    if (!api.isAuthenticated()) {
      document.getElementById('auth-modal')?.classList.remove('hidden');
      return;
    }
    this.modal.classList.remove('hidden');
  }

  hide() {
    if (this.isUploading) return; // don't close while uploading
    this.modal.classList.add('hidden');
    this._reset();
  }

  // ---- Private ----

  _bind() {
    // Close buttons
    const closeBtn = document.getElementById('upload-close');
    const overlay = this.modal.querySelector('.modal-overlay');
    closeBtn?.addEventListener('click', () => this.hide());
    overlay?.addEventListener('click', () => this.hide());

    // Drag & drop
    this.dropzone.addEventListener('click', (e) => {
      // Don't open file picker if clicking the file-info area
      if (e.target.closest('.upload-file-info')) return;
      this.fileInput.click();
    });

    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropzone.classList.add('dragover');
    });

    this.dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
    });

    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropzone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length) {
        this._selectFile(files[0]);
      }
    });

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files.length) {
        this._selectFile(this.fileInput.files[0]);
      }
    });

    // Auto-detect location
    const btnDetect = document.getElementById('btn-detect-location');
    btnDetect?.addEventListener('click', () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            document.getElementById('upload-lat').value = pos.coords.latitude.toFixed(4);
            document.getElementById('upload-lng').value = pos.coords.longitude.toFixed(4);
          },
          () => showToast('Could not detect location', 'error')
        );
      }
    });

    // Submit
    this.form.addEventListener('submit', (e) => this._handleSubmit(e));
  }

  _selectFile(file) {
    if (!file.type.startsWith('video/')) {
      showToast('Please select a video file', 'error');
      return;
    }
    this.selectedFile = file;
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    this.fileInfo.textContent = `📁 ${file.name} (${sizeMB} MB)`;
    this.fileInfo.classList.remove('hidden');
  }

  async _handleSubmit(e) {
    e.preventDefault();

    // Validate
    const title = document.getElementById('upload-title').value.trim();
    const lat = document.getElementById('upload-lat').value;
    const lng = document.getElementById('upload-lng').value;

    if (!title) {
      showToast('Title is required', 'error');
      return;
    }
    if (!lat || !lng) {
      showToast('Location (latitude & longitude) is required', 'error');
      return;
    }
    if (!this.selectedFile) {
      showToast('Please select a video file', 'error');
      return;
    }

    // Build FormData
    const formData = new FormData();
    formData.append('video', this.selectedFile);
    formData.append('title', title);
    formData.append('description', document.getElementById('upload-description').value.trim());
    formData.append('latitude', parseFloat(lat));
    formData.append('longitude', parseFloat(lng));

    const tags = document.getElementById('upload-tags').value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length) {
      formData.append('tags', JSON.stringify(tags));
    }

    const pilot = document.getElementById('upload-pilot').value.trim();
    if (pilot) {
      formData.append('location_name', pilot); // pilot name goes in location_name for display
    }

    const droneModel = document.getElementById('upload-drone-model');
    if (droneModel && droneModel.value.trim()) {
      formData.append('drone_model', droneModel.value.trim());
    }

    // Show progress bar
    this.isUploading = true;
    this._showProgress(0);
    const submitBtn = this.form.querySelector('.btn-submit');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Uploading…';
    submitBtn.disabled = true;

    try {
      const data = await api.uploadFlight(formData, (pct) => {
        this._showProgress(pct);
      });

      this._showProgress(100);
      showToast('Flight uploaded successfully! 🎉', 'success');

      // Dispatch event so main app can add the marker
      window.dispatchEvent(new CustomEvent('flightUploaded', { detail: data }));

      setTimeout(() => {
        this.isUploading = false;
        this.hide();
      }, 600);
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
      this.isUploading = false;
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
      this._hideProgress();
    }
  }

  _showProgress(pct) {
    let bar = this.modal.querySelector('.upload-progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'upload-progress';
      bar.innerHTML = `<div class="upload-progress-fill"></div><span class="upload-progress-text">0%</span>`;
      this.form.querySelector('.btn-submit').before(bar);
    }
    bar.style.display = 'block';
    bar.querySelector('.upload-progress-fill').style.width = `${pct}%`;
    bar.querySelector('.upload-progress-text').textContent = `${pct}%`;
  }

  _hideProgress() {
    const bar = this.modal.querySelector('.upload-progress');
    if (bar) bar.style.display = 'none';
  }

  _reset() {
    this.form.reset();
    this.selectedFile = null;
    this.fileInfo.textContent = '';
    this.fileInfo.classList.add('hidden');
    this._hideProgress();
    const submitBtn = this.form.querySelector('.btn-submit');
    submitBtn.textContent = '🌍 Upload to Earth Geo';
    submitBtn.disabled = false;
  }
}
