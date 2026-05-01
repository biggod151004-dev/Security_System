/**
 * JARVIS Security Dashboard - Core App Runtime
 */
(function () {
    'use strict';

    const AppState = {
        securityMode: 'armed',
        isListening: false,
        jarvisChatOpen: false,
        alertAudio: {
            context: null,
            unlocked: false,
            lastPlayedAt: 0
        }
    };

    function getApiBase() {
        const path = window.location.pathname.replace(/\\/g, '/');
        if (path.includes('/frontend/pages/')) {
            return '../../backend/php/api';
        }
        if (path.includes('/frontend/')) {
            return '../backend/php/api';
        }
        return '/backend/php/api';
    }

    function isSubPage() {
        return window.location.pathname.replace(/\\/g, '/').includes('/frontend/pages/');
    }

    function resolvePagePath(page) {
        const normalized = String(page || 'index.html').replace(/^\/+/, '');

        if (normalized === 'index.html') {
            return isSubPage() ? '../index.html' : 'index.html';
        }

        if (normalized === 'login.html') {
            return isSubPage() ? 'login.html' : 'pages/login.html';
        }

        return isSubPage() ? normalized : `pages/${normalized}`;
    }

    function navigateToPage(page) {
        window.location.href = resolvePagePath(page);
    }

    function initParticles() {
        const particlesContainer = document.getElementById('particles');
        if (!particlesContainer || particlesContainer.children.length > 0) {
            return;
        }

        for (let i = 0; i < 40; i += 1) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.animationDelay = `${Math.random() * 10}s`;
            particle.style.animationDuration = `${10 + Math.random() * 8}s`;
            particlesContainer.appendChild(particle);
        }
    }

    function animateCounter(element, target, duration) {
        const start = performance.now();
        const from = 0;

        function step(now) {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 4);
            const value = Math.floor(from + (target - from) * eased);
            element.textContent = `${value}%`;
            if (progress < 1) {
                requestAnimationFrame(step);
            }
        }

        requestAnimationFrame(step);
    }

    function initCircularProgress() {
        document.querySelectorAll('.circular-progress').forEach((element) => {
            const value = Number.parseInt(element.dataset.value || '0', 10);
            const progressCircle = element.querySelector('.progress-value');
            const progressText = element.querySelector('.progress-text');

            if (progressCircle) {
                const radius = 54;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (value / 100) * circumference;
                progressCircle.style.strokeDasharray = String(circumference);
                progressCircle.style.strokeDashoffset = String(offset);
            }

            if (progressText) {
                animateCounter(progressText, value, 1200);
            }
        });
    }

    function initProgressBars() {
        document.querySelectorAll('.progress-bar').forEach((bar) => {
            const value = Number.parseInt(bar.dataset.value || '0', 10);
            window.setTimeout(() => {
                bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
            }, 200);
        });
    }

    function initNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach((item) => {
            item.addEventListener('click', () => {
                navItems.forEach((n) => n.classList.remove('active'));
                item.classList.add('active');
            });
        });

        const menuBtn = document.querySelector('.mobile-menu-btn');
        const sidebar = document.querySelector('.sidebar');
        if (menuBtn && sidebar) {
            menuBtn.addEventListener('click', () => {
                sidebar.classList.toggle('active');
            });
        }
    }

    function ensureHeaderClock() {
        const headerActions = document.querySelector('.header-actions');
        if (!headerActions || document.getElementById('jarvisLocalTime')) {
            return;
        }

        const clock = document.createElement('div');
        clock.className = 'hud-item jarvis-datetime';
        clock.innerHTML = `
            <div class="hud-label">Local Date & Time</div>
            <div class="jarvis-datetime-stack">
                <div class="hud-value" id="jarvisLocalTime">--</div>
                <div class="hud-meta" id="jarvisLocalDate">--</div>
            </div>
        `;
        headerActions.prepend(clock);
    }

    function updateDateTime() {
        const timeElement = document.getElementById('jarvisLocalTime');
        const dateElement = document.getElementById('jarvisLocalDate');
        if (!timeElement || !dateElement) {
            return;
        }

        const now = new Date();
        const locale = navigator.language || undefined;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        timeElement.textContent = now.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        dateElement.textContent = `${now.toLocaleDateString(locale, {
            weekday: 'long',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })}${timeZone ? ` · ${timeZone.replace(/_/g, ' ')}` : ''}`;
    }

    function ensureLogoutButton() {
        const sidebarFooter = document.querySelector('.sidebar-footer');
        if (!sidebarFooter || document.getElementById('logoutBtn')) {
            return;
        }

        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'logoutBtn';
        logoutBtn.className = 'btn btn-secondary sidebar-logout-btn';
        logoutBtn.type = 'button';
        logoutBtn.textContent = 'Logout';
        logoutBtn.addEventListener('click', () => {
            logoutUser();
        });
        sidebarFooter.appendChild(logoutBtn);
    }

    function speak(text) {
        if (!('speechSynthesis' in window) || !text) {
            return;
        }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
    }

    function getAudioContextClass() {
        return window.AudioContext || window.webkitAudioContext || null;
    }

    function ensureAlertAudioContext() {
        if (AppState.alertAudio.context) {
            return AppState.alertAudio.context;
        }

        const AudioContextClass = getAudioContextClass();
        if (!AudioContextClass) {
            return null;
        }

        try {
            AppState.alertAudio.context = new AudioContextClass();
            return AppState.alertAudio.context;
        } catch (error) {
            console.warn('Audio context init failed:', error);
            return null;
        }
    }

    function unlockAlertAudio() {
        const context = ensureAlertAudioContext();
        if (!context) {
            return;
        }

        if (context.state === 'suspended') {
            context.resume().catch(() => {});
        }
        AppState.alertAudio.unlocked = true;
    }

    function initAlertAudioUnlock() {
        const events = ['click', 'keydown', 'touchstart', 'pointerdown'];
        const unlockOnce = () => {
            unlockAlertAudio();
            events.forEach((eventName) => {
                window.removeEventListener(eventName, unlockOnce);
            });
        };

        events.forEach((eventName) => {
            window.addEventListener(eventName, unlockOnce, { passive: true });
        });
    }

    function playAlertTone() {
        const now = Date.now();
        if (now - AppState.alertAudio.lastPlayedAt < 1200) {
            return;
        }

        const context = ensureAlertAudioContext();
        if (!context) {
            return;
        }

        if (context.state === 'suspended') {
            context.resume().catch(() => {});
        }

        const startAt = context.currentTime + 0.01;
        const pulseOffsets = [0, 0.23, 0.46];
        const pulseDuration = 0.13;

        pulseOffsets.forEach((offset, index) => {
            const oscillator = context.createOscillator();
            const gain = context.createGain();

            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(index % 2 === 0 ? 920 : 760, startAt + offset);

            gain.gain.setValueAtTime(0.0001, startAt + offset);
            gain.gain.exponentialRampToValueAtTime(0.12, startAt + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + pulseDuration);

            oscillator.connect(gain);
            gain.connect(context.destination);

            oscillator.start(startAt + offset);
            oscillator.stop(startAt + offset + pulseDuration + 0.02);
        });

        AppState.alertAudio.lastPlayedAt = now;
    }

    function initRealtimeAlertSound() {
        window.addEventListener('jarvis:sound-alert', (event) => {
            const detail = event?.detail || {};
            if (detail.kind !== 'sensor') {
                return;
            }
            playAlertTone();
        });
    }

    function greetOnDashboard() {
        const path = window.location.pathname.replace(/\\/g, '/');
        const isDashboard = path.endsWith('/frontend/index.html') || path.endsWith('/index.html') || path === '/';
        if (!isDashboard || sessionStorage.getItem('jarvis_welcomed') === '1') {
            return;
        }

        const user = JSON.parse(sessionStorage.getItem('user') || 'null');
        const name = user?.full_name || user?.username || 'Boss';
        const greeting = `Welcome back ${name}. JARVIS security dashboard is online.`;
        showNotification('JARVIS', greeting, 'success');
        window.setTimeout(() => speak(greeting), 500);
        sessionStorage.setItem('jarvis_welcomed', '1');
    }

    async function syncRealtimeSnapshot() {
        if (window.JarvisRealtime?.fetchAllData) {
            await window.JarvisRealtime.fetchAllData();
        }
    }

    async function apiRequest(endpoint, options = {}) {
        const response = await fetch(`${getApiBase()}/${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(options.headers || {})
            },
            ...options
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }

        return data;
    }

    async function logoutUser() {
        try {
            await apiRequest('auth.php', {
                method: 'POST',
                body: JSON.stringify({ action: 'logout' })
            });
        } catch (error) {
            console.warn('Logout request failed:', error);
        } finally {
            sessionStorage.removeItem('user');
            sessionStorage.removeItem('jarvis_welcomed');
            localStorage.removeItem('user');
            localStorage.removeItem('jarvis_welcomed');

            const path = window.location.pathname.replace(/\\/g, '/');
            let loginPath = '/frontend/pages/login.html';
            if (path.includes('/frontend/pages/')) {
                const root = path.split('/frontend/pages/')[0];
                loginPath = `${root}/frontend/pages/login.html`;
            } else if (path.includes('/frontend/')) {
                const root = path.split('/frontend/')[0];
                loginPath = `${root}/frontend/pages/login.html`;
            }

            window.location.href = `${loginPath}?logged_out=1&t=${Date.now()}`;
        }
    }

    function updateSecurityStatus(mode) {
        const statusIndicator = document.querySelector('.status-indicator');
        if (!statusIndicator) {
            return;
        }

        const dot = statusIndicator.querySelector('.status-dot');
        const text = statusIndicator.querySelector('.status-text');

        if (dot) {
            dot.style.background = mode === 'armed' ? 'var(--accent-color)' : 'var(--warning-color)';
        }
        if (text) {
            text.textContent = mode === 'armed' ? 'System Armed' : 'System Disarmed';
        }
    }

    function showNotification(title, message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;

        const content = document.createElement('div');
        content.className = 'notification-content';

        const strong = document.createElement('strong');
        strong.textContent = String(title);

        const p = document.createElement('p');
        p.textContent = String(message);

        const close = document.createElement('button');
        close.className = 'notification-close';
        close.type = 'button';
        close.textContent = '×';
        close.addEventListener('click', () => notification.remove());

        content.appendChild(strong);
        content.appendChild(p);
        notification.appendChild(content);
        notification.appendChild(close);

        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '15px 20px',
            background: 'var(--bg-card)',
            border: '1px solid var(--primary-color)',
            borderRadius: '10px',
            boxShadow: 'var(--glow-primary)',
            zIndex: '9999',
            animation: 'slideInRight 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '15px'
        });

        document.body.appendChild(notification);

        window.setTimeout(() => {
            notification.style.animation = 'fadeOut 0.3s ease';
            window.setTimeout(() => notification.remove(), 250);
        }, 5000);
    }

    async function setSecurityMode(mode) {
        const normalizedMode = mode === 'armed' ? 'armed' : 'disarmed';

        try {
            await apiRequest('control.php', {
                method: 'POST',
                body: JSON.stringify({
                    action: normalizedMode === 'armed' ? 'arm' : 'disarm'
                })
            });

            AppState.securityMode = normalizedMode;
            updateSecurityStatus(AppState.securityMode);
            await syncRealtimeSnapshot();
            showNotification('Security Mode', `System ${AppState.securityMode}`, AppState.securityMode === 'armed' ? 'success' : 'warning');
            return true;
        } catch (error) {
            showNotification('Security Mode', error.message || 'Unable to change mode', 'error');
            return false;
        }
    }

    async function triggerAlarm() {
        try {
            await apiRequest('control.php', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'trigger_alarm',
                    duration: 3000
                })
            });

            await syncRealtimeSnapshot();
            showNotification('Alarm Test', 'Testing alarm system...', 'warning');
            document.body.style.animation = 'alarmFlash 0.5s ease 3';
            window.setTimeout(() => {
                document.body.style.animation = '';
                showNotification('Alarm Test', 'Alarm test completed', 'success');
            }, 3000);
            return true;
        } catch (error) {
            showNotification('Alarm Test', error.message || 'Unable to trigger alarm', 'error');
            return false;
        }
    }

    function toggleJarvisChat() {
        const chatWindow = document.getElementById('jarvisChatWindow');
        if (!chatWindow) {
            return;
        }
        chatWindow.classList.toggle('active');
        AppState.jarvisChatOpen = chatWindow.classList.contains('active');
    }

    function initChatButton() {
        const chatBtn = document.getElementById('jarvisChatBtn');
        if (chatBtn) {
            chatBtn.addEventListener('click', toggleJarvisChat);
        }
    }

    function initStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes alarmFlash {
                0%, 100% { background-color: var(--bg-dark); }
                50% { background-color: rgba(255, 51, 102, 0.1); }
            }
            @keyframes fadeOut {
                from { opacity: 1; transform: translateX(0); }
                to { opacity: 0; transform: translateX(20px); }
            }
        `;
        document.head.appendChild(style);
    }

    function initializeApp() {
        initStyles();
        initParticles();
        initCircularProgress();
        initProgressBars();
        initNavigation();
        initChatButton();
        initAlertAudioUnlock();
        initRealtimeAlertSound();
        ensureHeaderClock();
        ensureLogoutButton();
        updateDateTime();
        window.setInterval(updateDateTime, 1000);
        greetOnDashboard();
        showNotification('System Online', 'JARVIS Security System initialized successfully', 'success');
    }

    document.addEventListener('DOMContentLoaded', initializeApp);

    window.JarvisApp = {
        state: AppState,
        getApiBase,
        resolvePagePath,
        navigateToPage,
        showNotification,
        setSecurityMode,
        triggerAlarm,
        toggleJarvisChat,
        speak,
        playAlertTone,
        logoutUser
    };

    window.showNotification = showNotification;
    window.setSecurityMode = window.setSecurityMode || setSecurityMode;
    window.triggerAlarm = window.triggerAlarm || triggerAlarm;
    window.toggleJarvisChat = window.toggleJarvisChat || toggleJarvisChat;
    window.logoutUser = window.logoutUser || logoutUser;
})();




