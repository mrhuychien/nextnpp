import { showModal, closeModal } from './modal.js';
import { html } from '../lib/dom.js';

const SEASONS = [
    { id: 'spring', label: 'Mùa Xuân', emoji: '🌸' },
    { id: 'summer', label: 'Mùa Hạ',   emoji: '☀️' },
    { id: 'autumn', label: 'Mùa Thu',  emoji: '🍂' },
    { id: 'winter', label: 'Mùa Đông', emoji: '❄️' },
];
const SEASON_KEY = 'npp_season';

function getDefaultSeason() {
    const m = new Date().getMonth() + 1, d = new Date().getDate();
    if ((m === 2 && d >= 4) || m === 3 || m === 4 || (m === 5 && d <= 4)) return 'spring';
    if ((m === 5 && d >= 5) || m === 6 || m === 7 || (m === 8 && d <= 6)) return 'summer';
    if ((m === 8 && d >= 7) || m === 9 || m === 10 || (m === 11 && d <= 6)) return 'autumn';
    return 'winter';
}

export function applySeason(id) {
    const app = document.getElementById('npp-app');
    if (!app) return;
    SEASONS.forEach((s) => app.classList.remove(`npp-${s.id}`));
    app.classList.add(`npp-${id}`);
    try { localStorage.setItem(SEASON_KEY, id); } catch {}
    const icon = document.querySelector('#npp-btn-season .npp-season-icon');
    const cur = SEASONS.find((s) => s.id === id);
    if (icon && cur) icon.textContent = cur.emoji;
}

export function initSeason() {
    let saved;
    try { saved = localStorage.getItem(SEASON_KEY); } catch {}
    applySeason(saved || getDefaultSeason());
}

export function openSeasonPicker() {
    const body = html`
        <div class="npp-season-grid">
            ${SEASONS.map((s) => html`
                <button class="npp-season-option" data-season="${s.id}" type="button">
                    <span class="npp-season-emoji-lg">${s.emoji}</span>
                    <span>${s.label}</span>
                </button>
            `).join('')}
        </div>
    `;
    showModal({ title: 'Chọn giao diện theo mùa', body });

    document.querySelectorAll('.npp-season-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            applySeason(btn.dataset.season);
            closeModal();
        });
    });
}
