/**
 * Video Player Component
 * Handles video playback in the info panel with nice fallbacks
 */

export class VideoPlayer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentFlight = null;
  }

  load(flight) {
    this.currentFlight = flight;
    
    if (flight.videoUrl) {
      this.container.innerHTML = `
        <div class="panel-video-container">
          <video controls playsinline preload="metadata">
            <source src="${flight.videoUrl}" type="video/mp4">
            Your browser does not support video playback.
          </video>
        </div>
      `;
    } else {
      // Beautiful placeholder with flight info
      const gradient = this.getCategoryGradient(flight.category);
      this.container.innerHTML = `
        <div class="panel-video-container">
          <div class="video-placeholder" style="background: ${gradient};">
            <div class="play-icon">🎬</div>
            <div class="placeholder-title">${flight.title}</div>
            <div class="placeholder-location">📍 ${flight.location}</div>
            <div class="placeholder-badge">${this.getCategoryEmoji(flight.category)} ${flight.category || 'aerial'}</div>
          </div>
        </div>
      `;
    }
  }

  getCategoryGradient(category) {
    const gradients = {
      landscape: 'linear-gradient(135deg, #0d4f3c, #1a6b4f)',
      urban: 'linear-gradient(135deg, #2d1b69, #4a2d8f)',
      coastal: 'linear-gradient(135deg, #0d2f44, #1a5a7a)',
      mountain: 'linear-gradient(135deg, #3d1f1f, #6b3a3a)',
      nature: 'linear-gradient(135deg, #1a3a2a, #2d5a44)',
      sunset: 'linear-gradient(135deg, #4a2d1b, #8f5a2d)',
      default: 'linear-gradient(135deg, #0d2f44, #1a3a5c)',
    };
    return gradients[category] || gradients.default;
  }

  getCategoryEmoji(category) {
    const emojis = {
      landscape: '🏔️',
      urban: '🏙️',
      coastal: '🌊',
      mountain: '⛰️',
      nature: '🌿',
      sunset: '🌅',
    };
    return emojis[category] || '🎥';
  }

  destroy() {
    const video = this.container.querySelector('video');
    if (video) {
      video.pause();
      video.src = '';
    }
    this.container.innerHTML = '';
    this.currentFlight = null;
  }
}
