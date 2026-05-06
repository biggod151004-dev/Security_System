/**
 * JARVIS Security System - Page Integrations
 */
(function () {
    'use strict';

    const pageName = window.location.pathname.replace(/\\/g, '/').split('/').pop() || 'index.html';
    const PageState = {
        sensors: [],
        threats: [],
        threatStats: {},
        cameras: [],
        controlStatus: {},
        accessControl: null,
        accessProfiles: [],
        accessProfileEditingRfid: null,
        logs: [],
        logFilters: {
            type: 'all',
            level: 'all',
            search: ''
        },
        dashboardSnapshot: null,
        accessEventTracker: {
            lastLogId: null,
            lastPendingRfid: null,
            lastPhase: null,
            feedKeys: []
        },
        captureHistory: loadCaptureHistory(),
        bindings: {},
        sensorHistoryPromises: {}
    };

    function getApiBase() {
        return window.JarvisApp?.getApiBase ? window.JarvisApp.getApiBase() : '../../backend/php/api';
    }

    function getLoginPath() {
        return window.JarvisApp?.resolvePagePath
            ? window.JarvisApp.resolvePagePath('login.html')
            : (pageName === 'index.html' ? 'pages/login.html' : 'login.html');
    }

    async function apiGet(endpoint, query = '') {
        const suffix = query && query.includes('?') ? '&' : '?';
        const response = await fetch(`${getApiBase()}/${endpoint}${query}${suffix}_rt=${Date.now()}`, {
            cache: 'no-store',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `Request failed for ${endpoint}`);
        }
        return data;
    }

    async function apiSend(endpoint, method, body) {
        const response = await fetch(`${getApiBase()}/${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(body || {})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `Request failed for ${endpoint}`);
        }
        return data;
    }

    async function apiDelete(endpoint, query = '') {
        const response = await fetch(`${getApiBase()}/${endpoint}${query}`, {
            method: 'DELETE',
            headers: { Accept: 'application/json' }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `Request failed for ${endpoint}`);
        }
        return data;
    }

    function notify(title, message, type) {
        window.showNotification?.(title, message, type);
    }

    function playAccessFeedbackTone() {
        window.JarvisApp?.playAlertTone?.();
    }

    function emitAccessEventFeedback(lastEvent, lastStatus, awaitingFingerprint) {
        if (pageName !== 'index.html') return;

        const nextLogId = String(lastEvent?.log_id || '');
        const nextPendingRfid = String(PageState.accessControl?.pending_rfid_uid || '');
        const previousLogId = String(PageState.accessEventTracker.lastLogId || '');
        const previousPendingRfid = String(PageState.accessEventTracker.lastPendingRfid || '');

        if (awaitingFingerprint && nextPendingRfid && nextPendingRfid !== previousPendingRfid) {
            notify('Access Control', `RFID ${nextPendingRfid} verified. Scan fingerprint now.`, 'success');
            playAccessFeedbackTone();
        }

        if (nextLogId && nextLogId !== previousLogId) {
            if (lastStatus === 'granted') {
                notify('Access Control', 'Access Granted. Door unlock command sent.', 'success');
                playAccessFeedbackTone();
            } else if (lastStatus === 'denied') {
                notify('Access Control', 'Access Denied. Door remains locked.', 'error');
                playAccessFeedbackTone();
            }
        }

        PageState.accessEventTracker.lastLogId = nextLogId || PageState.accessEventTracker.lastLogId;
        PageState.accessEventTracker.lastPendingRfid = nextPendingRfid || null;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return 'Unknown';
        }
        return date.toLocaleString(navigator.language || undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function formatTimeAgo(value) {
        if (!value) return 'No data';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'No data';
        const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
        return `${Math.floor(diff / 86400)} days ago`;
    }

    function formatNumber(value, decimals = 1) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 'N/A';
        return numeric.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    }

    function toTitleCase(value) {
        return String(value || '')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = String(value);
        }
    }

    function setStatValues(values) {
        const statElements = document.querySelectorAll('.stats-grid .stat-value');
        values.forEach((value, index) => {
            if (statElements[index]) {
                statElements[index].textContent = String(value);
            }
        });
    }

    function updateStatusIndicator(text, tone = 'success') {
        const indicator = document.querySelector('.status-indicator');
        if (!indicator) return;

        const palette = {
            success: 'var(--accent-color)',
            warning: 'var(--warning-color)',
            danger: 'var(--danger-color)',
            info: 'var(--primary-color)'
        };

        const dot = indicator.querySelector('.status-dot');
        const statusText = indicator.querySelector('.status-text');
        const color = palette[tone] || palette.info;

        if (dot) {
            dot.style.background = color;
            dot.style.animation = tone === 'danger' ? 'statusBlink 1s infinite' : 'statusBlink 2s infinite';
        }
        if (statusText) {
            statusText.textContent = text;
            statusText.style.color = color;
        }
    }

    function readNumericValue(rawValue) {
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            return rawValue;
        }
        const match = String(rawValue ?? '').match(/-?\d+(\.\d+)?/);
        return match ? Number.parseFloat(match[0]) : null;
    }

    function getSensorTimestamp(sensor) {
        return sensor?.last_reading || sensor?.latest_reading?.recorded_at || null;
    }

    function getSensorNumericValue(sensor) {
        const directNumeric = sensor?.latest_reading?.numeric_value;
        if (directNumeric !== null && directNumeric !== undefined && directNumeric !== '') {
            const parsed = Number.parseFloat(directNumeric);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
        if (sensor?.type && ['temperature', 'humidity', 'vibration'].includes(sensor.type)) {
            return readNumericValue(sensor.last_value ?? sensor.latest_reading?.value);
        }
        return null;
    }

    function normalizeSensorUnit(unit, type) {
        if (!unit || ['ON/OFF', 'OPEN/CLOSED', 'state'].includes(unit)) return '';
        if (unit === '°C' || (type === 'temperature' && unit === 'C')) return 'C';
        return unit;
    }

    function getSensorDisplay(sensor) {
        const numeric = getSensorNumericValue(sensor);
        const rawUnit = normalizeSensorUnit(sensor?.unit, sensor?.type);
        const unit = sensor?.type === 'temperature' && rawUnit === 'C'
            ? '°C'
            : sensor?.type === 'temperature' && rawUnit === 'F'
                ? '°F'
                : rawUnit;
        if (numeric !== null && ['temperature', 'humidity', 'vibration'].includes(sensor?.type || '')) {
            return {
                text: formatNumber(numeric, sensor.type === 'vibration' ? 2 : 1),
                unit,
                numeric
            };
        }
        return {
            text: String(sensor?.last_value ?? sensor?.latest_reading?.value ?? 'N/A'),
            unit: '',
            numeric: null
        };
    }

    function getSensorTone(sensor) {
        if (!sensor) return 'offline';
        const runtimeStatus = String(sensor.runtime_status || '').toLowerCase();
        const readingStatus = String(sensor.latest_reading?.status || '').toLowerCase();
        const connectionState = String(sensor.connection_state || '').toLowerCase();
        let isOnline = sensor.is_online === true || connectionState === 'online';
        if (sensor.is_online !== true && sensor.is_online !== false && connectionState !== 'online' && connectionState !== 'offline') {
            const ageSeconds = Number(sensor.age_seconds);
            isOnline = Number.isFinite(ageSeconds) ? ageSeconds <= 10 : true;
        }

        if (runtimeStatus === 'offline' || readingStatus === 'offline' || connectionState === 'offline' || !isOnline) return 'offline';
        if (String(sensor.latest_reading?.status || '').toLowerCase() === 'alert') return 'alert';
        if (sensor.status === 'inactive' || sensor.status === 'maintenance') return 'offline';
        if (sensor.status === 'error') return 'alert';
        return 'active';
    }

    function getSensorThreshold(sensor) {
        const threshold = Number.parseFloat(sensor?.threshold_alert);
        return Number.isFinite(threshold) ? threshold : null;
    }

    function isActuatorOn(actuator) {
        const status = String(actuator?.status || '').toLowerCase();
        return ['on', 'active', 'true', '1'].includes(status);
    }

    function findActuatorByType(actuators, type) {
        return (Array.isArray(actuators) ? actuators : []).find((actuator) => actuator.type === type) || null;
    }

    function getActuatorStateText(actuator) {
        if (!actuator) return 'Unavailable';
        const active = isActuatorOn(actuator);
        if (actuator.type === 'lock') return active ? 'Locked' : 'Unlocked';
        if (actuator.type === 'valve') return active ? 'Open' : 'Closed';
        return active ? 'On' : 'Off';
    }

    function getActuatorActionLabels(type) {
        if (type === 'lock') {
            return { on: 'Lock', off: 'Unlock' };
        }
        if (type === 'valve') {
            return { on: 'Open', off: 'Close' };
        }
        return { on: 'On', off: 'Off' };
    }

    function getActuatorIconPath(type) {
        if (type === 'lock') {
            return 'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9zm3 4a2 2 0 0 1 1 3.73V19h-2v-1.27A2 2 0 0 1 12 14z';
        }
        if (type === 'valve') {
            return 'M7 2h10v2H7V2zm2 4h6v3.59l3.7 3.7-1.4 1.41-3.3-3.3V6H9v5.99l3.29 3.3-1.41 1.41L7.59 13.4A2 2 0 0 1 7 12V6zM5 18h14v4H5v-4z';
        }
        return 'M12 2L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z';
    }

    function renderControlActuators(actuators) {
        const grid = document.getElementById('actuatorControlGrid');
        if (!grid) return;

        const targets = ['lock', 'valve']
            .map((type) => findActuatorByType(actuators, type))
            .filter(Boolean);

        if (targets.length === 0) {
            grid.innerHTML = `
                <div class="control-item">
                    <div class="control-name">No lock/valve actuators found</div>
                    <p style="font-size:0.8rem;color:var(--text-secondary);">Add LOCK-001 and VALVE-001 actuators in the backend.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = targets.map((actuator) => {
            const labels = getActuatorActionLabels(actuator.type);
            const active = isActuatorOn(actuator);
            const stateText = getActuatorStateText(actuator);
            const lastUpdated = actuator.last_activated_at || actuator.last_deactivated_at || actuator.updated_at || null;
            return `
                <div class="control-item">
                    <div class="control-icon"><svg viewBox="0 0 24 24"><path d="${getActuatorIconPath(actuator.type)}"/></svg></div>
                    <div class="control-name">${escapeHtml(actuator.name || `${toTitleCase(actuator.type)} Actuator`)}</div>
                    <div class="quick-action-status">${escapeHtml(stateText)}</div>
                    <p style="font-size:0.8rem;color:var(--text-secondary);">${lastUpdated ? `Updated ${escapeHtml(formatTimeAgo(lastUpdated))}` : 'Awaiting first command'}</p>
                    <div class="control-actions">
                        <button class="btn btn-primary ${active ? 'is-active' : ''}" type="button" data-actuator-id="${escapeHtml(actuator.actuator_id)}" data-actuator-state="true">${escapeHtml(labels.on)}</button>
                        <button class="btn btn-secondary ${!active ? 'is-active' : ''}" type="button" data-actuator-id="${escapeHtml(actuator.actuator_id)}" data-actuator-state="false">${escapeHtml(labels.off)}</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderControlPageView(controlStatus) {
        const mode = controlStatus?.security_mode || 'unknown';
        const actuators = controlStatus?.actuators || [];
        PageState.controlStatus = controlStatus || {};

        setText('securityModeStatus', toTitleCase(mode));
        updateStatusIndicator(
            mode === 'armed'
                ? 'System Armed'
                : mode === 'disarmed'
                    ? 'System Disarmed'
                    : `System ${toTitleCase(mode)}`,
            mode === 'armed' ? 'success' : mode === 'disarmed' ? 'warning' : 'info'
        );
        renderControlActuators(actuators);
        renderAccessProfilesTable(PageState.accessProfiles);
    }

    function populateAccessProfileForm(profile) {
        const userNameInput = document.getElementById('accessUserNameInput');
        const rfidInput = document.getElementById('accessRfidInput');
        const fingerprintInput = document.getElementById('accessFingerprintInput');
        const roleInput = document.getElementById('accessRoleInput');

        if (userNameInput) userNameInput.value = String(profile?.name || '');
        if (rfidInput) rfidInput.value = String(profile?.rfid_uid || '');
        if (fingerprintInput) fingerprintInput.value = String(profile?.fingerprint_id || '');
        if (roleInput) roleInput.value = String(profile?.role || '');

        PageState.accessProfileEditingRfid = profile?.rfid_uid ? String(profile.rfid_uid).toUpperCase() : null;
    }

    function clearAccessProfileForm() {
        populateAccessProfileForm(null);
    }

    function renderAccessProfilesTable(profiles) {
        const tableBody = document.getElementById('accessProfilesTableBody');
        const countBadge = document.getElementById('accessProfileCountBadge');
        if (!tableBody) return;

        const rows = Array.isArray(profiles) ? profiles : [];
        if (countBadge) {
            countBadge.textContent = `${rows.length} profile${rows.length === 1 ? '' : 's'}`;
        }

        if (rows.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="color:var(--text-secondary);">No access profiles found. Add an admin profile to enable RFID + fingerprint access.</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = rows.map((profile) => {
            const rfid = String(profile?.rfid_uid || '').toUpperCase();
            const isEditing = PageState.accessProfileEditingRfid && rfid === PageState.accessProfileEditingRfid;
            return `
                <tr>
                    <td>${escapeHtml(profile?.name || 'Authorized User')}</td>
                    <td>${escapeHtml(rfid || 'N/A')}</td>
                    <td>${escapeHtml(profile?.fingerprint_id || 'N/A')}</td>
                    <td>${escapeHtml(profile?.role || 'User')}</td>
                    <td>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <button class="btn btn-secondary ${isEditing ? 'is-active' : ''}" type="button" data-access-action="edit" data-rfid-uid="${escapeHtml(rfid)}">Edit</button>
                            <button class="btn btn-danger" type="button" data-access-action="delete" data-rfid-uid="${escapeHtml(rfid)}">Delete</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Override legacy unit formatting so sensor pages show stable ASCII labels.
    function normalizeSensorUnit(unit, type) {
        if (!unit || ['ON/OFF', 'OPEN/CLOSED', 'state'].includes(unit)) return '';
        if (unit === 'Â°C' || unit === '°C' || (type === 'temperature' && unit === 'C')) return 'C';
        return unit;
    }

    function getSensorDisplay(sensor) {
        const numeric = getSensorNumericValue(sensor);
        const rawUnit = String(normalizeSensorUnit(sensor?.unit, sensor?.type) || '').trim();
        const unit = sensor?.type === 'temperature'
            ? /F$/i.test(rawUnit) ? 'deg F' : /C$/i.test(rawUnit) ? 'deg C' : rawUnit
            : rawUnit;

        if (numeric !== null && ['temperature', 'humidity', 'vibration'].includes(sensor?.type || '')) {
            return {
                text: formatNumber(numeric, sensor.type === 'vibration' ? 2 : 1),
                unit,
                numeric
            };
        }

        return {
            text: String(sensor?.last_value ?? sensor?.latest_reading?.value ?? 'N/A'),
            unit: '',
            numeric: null
        };
    }

    function getSensorTone(sensor) {
        if (!sensor) return 'offline';
        const runtimeStatus = String(sensor.runtime_status || '').toLowerCase();
        const readingStatus = String(sensor.latest_reading?.status || '').toLowerCase();
        const connectionState = String(sensor.connection_state || '').toLowerCase();
        let isOnline = sensor.is_online === true || connectionState === 'online';
        if (sensor.is_online !== true && sensor.is_online !== false && connectionState !== 'online' && connectionState !== 'offline') {
            const ageSeconds = Number(sensor.age_seconds);
            isOnline = Number.isFinite(ageSeconds) ? ageSeconds <= 10 : true;
        }

        if (runtimeStatus === 'offline' || readingStatus === 'offline' || connectionState === 'offline' || !isOnline) return 'offline';
        if (sensor.status === 'inactive' || sensor.status === 'maintenance') return 'offline';
        if (sensor.status === 'error') return 'alert';
        if (String(sensor.latest_reading?.status || '').toLowerCase() === 'alert') return 'alert';
        return 'active';
    }

    function getSeverityWeight(severity) {
        if (severity === 'critical') return 4;
        if (severity === 'high') return 3;
        if (severity === 'medium') return 2;
        return 1;
    }

    function getSeverityBadge(severity) {
        if (severity === 'critical') return 'danger';
        if (severity === 'high' || severity === 'medium') return 'warning';
        if (severity === 'resolved') return 'success';
        return 'info';
    }

    function getLogTone(log) {
        const type = String(log?.type || '').toUpperCase();
        const severity = Number(log?.severity || 0);
        if (severity >= 4 || type === 'CRITICAL') return 'danger';
        if (severity >= 3 || type === 'ERROR') return 'danger';
        if (severity >= 2 || type === 'WARNING' || type === 'SECURITY') return 'warning';
        if (type === 'ACCESS' || type === 'SENSOR') return 'success';
        return 'info';
    }

    function getLogTypeFilterValue(log) {
        const type = String(log?.type || '').toLowerCase();
        if (type === 'warning' || type === 'critical') return 'security';
        if (['access', 'sensor', 'system', 'error', 'security'].includes(type)) return type;
        return 'all';
    }

    function getLevelFilterValue(log) {
        const severity = Number(log?.severity || 0);
        const type = String(log?.type || '').toLowerCase();
        if (type === 'critical' || severity >= 4) return 'critical';
        if (type === 'error' || severity >= 3) return 'error';
        if (type === 'warning' || severity >= 2 || type === 'security') return 'warning';
        return 'info';
    }

    function buildLogsQuery(filters = PageState.logFilters) {
        const params = new URLSearchParams();
        params.set('limit', '50');

        if (filters.type && filters.type !== 'all') {
            params.set('type', filters.type.toUpperCase());
        }

        if (filters.level && filters.level !== 'all') {
            const severityMap = { info: '1', warning: '2', error: '3', critical: '4' };
            if (severityMap[filters.level]) {
                params.set('severity', severityMap[filters.level]);
            }
        }

        if (filters.search) {
            params.set('search', filters.search);
        }

        return `?${params.toString()}`;
    }

    function filterLogsClientSide(logs, filters = PageState.logFilters) {
        return (Array.isArray(logs) ? logs : []).filter((log) => {
            if (filters.type && filters.type !== 'all') {
                if (filters.type === 'security') {
                    const isSecurityMatch = getLogTypeFilterValue(log) === 'security'
                        || String(log?.source || '').toLowerCase().includes('security');
                    if (!isSecurityMatch) return false;
                } else if (getLogTypeFilterValue(log) !== filters.type) {
                    return false;
                }
            }

            if (filters.level && filters.level !== 'all' && getLevelFilterValue(log) !== filters.level) {
                return false;
            }

            if (filters.search) {
                const haystack = `${log?.message || ''} ${log?.source || ''}`.toLowerCase();
                if (!haystack.includes(filters.search.toLowerCase())) {
                    return false;
                }
            }

            return true;
        });
    }

    function getLatestAccessLog(logs) {
        return (Array.isArray(logs) ? logs : []).find((log) => String(log?.type || '').toUpperCase() === 'ACCESS') || null;
    }

    function maskIdentifier(value) {
        const text = String(value || '').trim();
        if (!text) return 'Unknown';
        if (text.length <= 4) return text;
        return `${text.slice(0, 4)}••${text.slice(-2)}`;
    }

    function setStepState(id, tone, message) {
        const card = document.getElementById(id);
        if (!card) return;
        card.classList.remove('success', 'warning', 'danger');
        const normalizedTone = tone && tone !== 'idle' ? tone : 'idle';
        card.dataset.tone = normalizedTone;
        if (normalizedTone !== 'idle') {
            card.classList.add(normalizedTone);
        }
        const text = card.querySelector('[data-step-message]') || card.querySelector('p');
        if (text && message) {
            text.textContent = message;
        }
    }

    function setStepScanning(id, isScanning) {
        const card = document.getElementById(id);
        if (!card) return;
        card.classList.toggle('is-scanning', Boolean(isScanning));
    }

    function setAccessLiveChip(label, tone = 'idle') {
        const chip = document.getElementById('accessLiveMode');
        if (!chip) return;
        chip.classList.remove('idle', 'active', 'success', 'error');
        chip.classList.add(tone || 'idle');
        chip.textContent = String(label || 'Standby');
    }

    function setAccessLiveTile(tileId, labelId, tone, text) {
        const tile = document.getElementById(tileId);
        const label = document.getElementById(labelId);
        if (tile) {
            tile.classList.remove('idle', 'active', 'success', 'error');
            tile.classList.add(tone || 'idle');
        }
        if (label && text) {
            label.textContent = String(text);
        }
    }

    function appendAccessFeedLine(message, dedupeKey = '') {
        const feed = document.getElementById('accessLiveFeed');
        if (!feed || !message) return;

        if (!Array.isArray(PageState.accessEventTracker.feedKeys)) {
            PageState.accessEventTracker.feedKeys = [];
        }

        if (dedupeKey && PageState.accessEventTracker.feedKeys.includes(dedupeKey)) {
            return;
        }

        if (dedupeKey) {
            PageState.accessEventTracker.feedKeys.push(dedupeKey);
            if (PageState.accessEventTracker.feedKeys.length > 20) {
                PageState.accessEventTracker.feedKeys = PageState.accessEventTracker.feedKeys.slice(-20);
            }
        }

        const line = document.createElement('div');
        const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        line.className = 'access-feed-line';
        line.textContent = `[${stamp}] ${message}`;
        feed.prepend(line);

        while (feed.children.length > 8) {
            feed.removeChild(feed.lastElementChild);
        }
    }

    function syncAccessLiveConsole({
        awaitingFingerprint,
        lastStatus,
        lastEvent,
        accessControl,
        doorUnlocked,
        activeUser,
        lastEventMessage
    }) {
        const currentPhase = awaitingFingerprint
            ? 'awaiting_fingerprint'
            : lastStatus === 'granted'
                ? 'granted'
                : lastStatus === 'denied'
                    ? 'denied'
                    : 'idle';
        const previousPhase = PageState.accessEventTracker.lastPhase;

        if (currentPhase === 'awaiting_fingerprint') {
            setAccessLiveChip('RFID Matched', 'active');
            setAccessLiveTile('accessLiveRfidTile', 'accessLiveRfid', 'success', `UID ${maskIdentifier(accessControl.pending_rfid_uid)} verified`);
            setAccessLiveTile('accessLiveFingerprintTile', 'accessLiveFingerprint', 'active', 'Place finger on scanner');
            setAccessLiveTile('accessLiveDoorTile', 'accessLiveDoor', 'active', 'LOCK HOLD');

            setStepScanning('rfidStepCard', false);
            setStepScanning('fingerprintStepCard', true);
            setStepScanning('doorStepCard', false);

            appendAccessFeedLine(
                `RFID matched for ${activeUser}. Fingerprint verification window is live.`,
                `awaiting:${accessControl.pending_rfid_uid || ''}:${accessControl.expires_at || ''}`
            );
        } else if (currentPhase === 'granted') {
            setAccessLiveChip('Access Granted', 'success');
            setAccessLiveTile('accessLiveRfidTile', 'accessLiveRfid', 'success', `UID ${maskIdentifier(lastEvent?.rfid_uid)} matched`);
            setAccessLiveTile('accessLiveFingerprintTile', 'accessLiveFingerprint', 'success', `ID ${maskIdentifier(lastEvent?.fingerprint_id)} verified`);
            setAccessLiveTile('accessLiveDoorTile', 'accessLiveDoor', 'success', 'UNLOCK PULSE');

            setStepScanning('rfidStepCard', false);
            setStepScanning('fingerprintStepCard', false);
            setStepScanning('doorStepCard', false);

            appendAccessFeedLine(
                `Access granted for ${activeUser}. Door unlock command sent.`,
                `event:${lastEvent?.log_id || ''}:${lastEvent?.created_at || ''}:granted`
            );
        } else if (currentPhase === 'denied') {
            setAccessLiveChip('Access Denied', 'error');
            setAccessLiveTile('accessLiveRfidTile', 'accessLiveRfid', 'error', lastEvent?.rfid_uid ? `UID ${maskIdentifier(lastEvent.rfid_uid)} rejected` : 'No valid RFID context');
            setAccessLiveTile('accessLiveFingerprintTile', 'accessLiveFingerprint', 'error', lastEvent?.fingerprint_id ? `ID ${maskIdentifier(lastEvent.fingerprint_id)} mismatch` : 'Fingerprint verification failed');
            setAccessLiveTile('accessLiveDoorTile', 'accessLiveDoor', 'error', 'LOCKDOWN');

            setStepScanning('rfidStepCard', false);
            setStepScanning('fingerprintStepCard', false);
            setStepScanning('doorStepCard', false);

            appendAccessFeedLine(
                `Access denied. ${lastEventMessage || 'Verification mismatch detected.'}`,
                `event:${lastEvent?.log_id || ''}:${lastEvent?.created_at || ''}:denied`
            );
        } else {
            setAccessLiveChip('Standby', 'idle');
            setAccessLiveTile('accessLiveRfidTile', 'accessLiveRfid', 'active', 'Reader armed - waiting for card');
            setAccessLiveTile('accessLiveFingerprintTile', 'accessLiveFingerprint', 'idle', 'Idle until RFID match');
            setAccessLiveTile('accessLiveDoorTile', 'accessLiveDoor', doorUnlocked ? 'success' : 'idle', doorUnlocked ? 'UNLOCK HOLD' : 'LOCK HOLD');

            setStepScanning('rfidStepCard', true);
            setStepScanning('fingerprintStepCard', false);
            setStepScanning('doorStepCard', false);

            if (previousPhase && previousPhase !== 'idle') {
                appendAccessFeedLine('Verification sequence reset. Reader returned to standby.', `idle:${Date.now()}`);
            }
        }

        PageState.accessEventTracker.lastPhase = currentPhase;
    }

    function buildSensorStats(sensors) {
        const motion = sensors.filter((sensor) => sensor.type === 'motion').length;
        const vibration = sensors.filter((sensor) => sensor.type === 'vibration').length;
        return {
            total: sensors.length,
            active: sensors.filter((sensor) => sensor.status === 'active').length,
            motion,
            vibration,
            others: Math.max(0, sensors.length - motion - vibration)
        };
    }

    function buildThreatStats(threats, existing = {}, options = {}) {
        const list = Array.isArray(threats) ? threats : [];
        const preferLive = Boolean(options.preferLive);

        const critical = list.filter((threat) => threat.severity === 'critical').length;
        const high = list.filter((threat) => threat.severity === 'high').length;
        const medium = list.filter((threat) => threat.severity === 'medium').length;
        const low = list.filter((threat) => threat.severity === 'low').length;
        const active = list.length;

        const resolvedParsed = Number(existing?.resolved);
        const resolved = Number.isFinite(resolvedParsed) && resolvedParsed >= 0 ? resolvedParsed : 0;

        const historicalTotalParsed = Number(existing?.total);
        const historicalTotal = Number.isFinite(historicalTotalParsed) && historicalTotalParsed >= 0
            ? historicalTotalParsed
            : (active + resolved);

        const total = preferLive ? (active + resolved) : historicalTotal;

        return {
            total,
            critical,
            high,
            medium,
            low,
            active,
            resolved
        };
    }

    function loadCaptureHistory() {
        try {
            const raw = localStorage.getItem('jarvis-camera-captures');
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Unable to read capture history:', error);
            return [];
        }
    }

    function saveCaptureHistory() {
        localStorage.setItem('jarvis-camera-captures', JSON.stringify(PageState.captureHistory.slice(0, 12)));
    }

    function addCaptureHistory(entry) {
        PageState.captureHistory = [
            entry,
            ...PageState.captureHistory.filter((item) => item.id !== entry.id)
        ].slice(0, 12);
        saveCaptureHistory();
    }

    function getPrimaryCamera(cameras = PageState.cameras) {
        if (!Array.isArray(cameras) || cameras.length === 0) return null;
        return cameras.find((camera) => camera.camera_id === 'CAM-001') || cameras[0];
    }

    function getCameraStreamUrl(camera) {
        if (!camera) return '';
        if (camera.stream_url) return camera.stream_url;
        return camera.ip_address ? `http://${camera.ip_address}:81/stream` : '';
    }

    function getCameraSnapshotUrl(camera) {
        if (!camera) return '';
        if (camera.snapshot_url) return camera.snapshot_url;
        if (!camera.ip_address) return '';
        const port = camera.port && Number(camera.port) !== 80 ? `:${camera.port}` : '';
        return `http://${camera.ip_address}${port}/capture?download=1`;
    }

    function withCacheBust(url) {
        if (!url) return '';
        return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    }

    function setOptionalLink(id, url) {
        const link = document.getElementById(id);
        if (!link) return;

        if (url) {
            link.href = url;
            link.style.pointerEvents = 'auto';
            link.style.opacity = '1';
            return;
        }

        link.removeAttribute('href');
        link.style.pointerEvents = 'none';
        link.style.opacity = '0.55';
    }

    function getRealtimeSensorHistory(sensorId) {
        return window.JarvisRealtime?.getSensorHistory ? window.JarvisRealtime.getSensorHistory(sensorId) : [];
    }

    function extractSensorSeries(detail) {
        return (detail?.readings || [])
            .slice()
            .reverse()
            .map((reading) => {
                const numeric = reading.numeric_value !== null && reading.numeric_value !== undefined && reading.numeric_value !== ''
                    ? Number.parseFloat(reading.numeric_value)
                    : readNumericValue(reading.value);
                if (!Number.isFinite(numeric)) return null;
                return {
                    timestamp: reading.recorded_at,
                    label: new Date(reading.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    value: numeric
                };
            })
            .filter(Boolean)
            .slice(-30);
    }

    function hydrateSensorHistory(sensorId) {
        if (!sensorId || PageState.sensorHistoryPromises[sensorId]) {
            return PageState.sensorHistoryPromises[sensorId];
        }
        PageState.sensorHistoryPromises[sensorId] = apiGet('sensors.php', `?sensor_id=${encodeURIComponent(sensorId)}`)
            .then((response) => {
                const series = extractSensorSeries(response.data);
                if (series.length > 0) {
                    window.JarvisRealtime?.seedSensorHistory?.(sensorId, series);
                }
            })
            .catch((error) => {
                console.warn(`Unable to hydrate history for ${sensorId}:`, error);
            });
        return PageState.sensorHistoryPromises[sensorId];
    }

    async function refreshLiveData() {
        if (window.JarvisRealtime?.fetchAllData) {
            await window.JarvisRealtime.fetchAllData();
        }
    }

    async function ensureAuthenticated() {
        if (pageName === 'login.html') return;
        try {
            const auth = await apiGet('auth.php');
            if (!auth.data?.logged_in) {
                window.location.href = getLoginPath();
            }
        } catch (error) {
            window.location.href = getLoginPath();
        }
    }

    function renderSensorCards(container, sensors, showControls, options = {}) {
        if (!container) return;
        if (!Array.isArray(sensors) || sensors.length === 0) {
            container.innerHTML = `
                <div class="sensor-card">
                    <div class="sensor-header">
                        <span class="sensor-name">No sensors</span>
                        <span class="sensor-status offline"></span>
                    </div>
                    <div class="sensor-value">--</div>
                    <div class="sensor-meta">
                        <span>Waiting for data</span>
                        <span>Offline</span>
                    </div>
                </div>
            `;
            return;
        }

        const companionHumidity = options?.companionHumidity || null;

        container.innerHTML = sensors.map((sensor) => {
            const display = getSensorDisplay(sensor);
            const tone = getSensorTone(sensor);
            const threshold = getSensorThreshold(sensor);
            const isActive = sensor.status === 'active';
            const thresholdLabel = threshold !== null
                ? `Threshold ${formatNumber(threshold, sensor.type === 'vibration' ? 2 : 1)}${display.unit ? ` ${display.unit}` : ''}`
                : 'Monitoring';
            const humidityDisplay = sensor.type === 'temperature' && companionHumidity
                ? getSensorDisplay(companionHumidity)
                : null;
            const humidityTone = sensor.type === 'temperature' && companionHumidity
                ? getSensorTone(companionHumidity)
                : null;
            const humidityMeta = sensor.type === 'temperature' && companionHumidity
                ? formatTimeAgo(getSensorTimestamp(companionHumidity))
                : null;
            return `
                <div class="sensor-card ${tone === 'alert' ? 'alert' : ''}">
                    <div class="sensor-header">
                        <span class="sensor-name">${escapeHtml(sensor.name)}</span>
                        <span class="sensor-status ${tone === 'offline' ? 'offline' : tone === 'alert' ? 'alert' : 'active'}"></span>
                    </div>
                    <div class="sensor-value">${escapeHtml(display.text)}${display.unit ? `<span class="sensor-unit">${escapeHtml(display.unit)}</span>` : ''}</div>
                    ${humidityDisplay ? `
                        <div class="sensor-companion ${humidityTone === 'alert' ? 'alert' : humidityTone === 'offline' ? 'offline' : 'active'}">
                            <span class="sensor-companion-label">Humidity</span>
                            <span class="sensor-companion-value">${escapeHtml(humidityDisplay.text)}${humidityDisplay.unit ? ` ${escapeHtml(humidityDisplay.unit)}` : ''}</span>
                            <span class="sensor-companion-time">${escapeHtml(humidityMeta)}</span>
                        </div>
                    ` : ''}
                    <div class="sensor-reading-inline">
                        <span class="badge ${tone === 'alert' ? 'danger' : tone === 'offline' ? 'warning' : 'success'}">${escapeHtml(toTitleCase(tone === 'active' ? 'live' : tone))}</span>
                        <span>${escapeHtml(thresholdLabel)}</span>
                    </div>
                    <div class="sensor-meta">
                        <span>${escapeHtml(formatTimeAgo(getSensorTimestamp(sensor)))}</span>
                        <span>${escapeHtml(sensor.zone || sensor.location || 'Unknown')}</span>
                    </div>
                    ${showControls ? `
                        <div class="sensor-control-actions">
                            <button class="btn btn-primary ${isActive ? 'is-active' : ''}" type="button" data-sensor-id="${escapeHtml(sensor.sensor_id)}" data-sensor-status="active"${isActive ? ' disabled' : ''}>On</button>
                            <button class="btn btn-secondary ${!isActive ? 'is-active' : ''}" type="button" data-sensor-id="${escapeHtml(sensor.sensor_id)}" data-sensor-status="inactive"${!isActive ? ' disabled' : ''}>Off</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    function renderDashboardRecentActivity(threats, logs, sensors) {
        const container = document.getElementById('dashboardActivityTimeline');
        if (!container) return;

        const activity = [];
        threats.slice(0, 3).forEach((threat) => {
            activity.push({
                severity: threat.severity || 'medium',
                title: threat.type || 'Threat',
                badge: threat.location || threat.source || 'Security',
                message: threat.description || 'Threat is being monitored.',
                timestamp: threat.detected_at
            });
        });
        sensors.filter((sensor) => getSensorTone(sensor) === 'alert').slice(0, 2).forEach((sensor) => {
            const display = getSensorDisplay(sensor);
            activity.push({
                severity: sensor.type === 'fire' ? 'critical' : sensor.type === 'temperature' ? 'high' : 'medium',
                title: `${toTitleCase(sensor.type)} alert`,
                badge: sensor.zone || sensor.location || 'Sensor',
                message: `${sensor.name} reported ${display.text}${display.unit ? ` ${display.unit}` : ''}.`,
                timestamp: getSensorTimestamp(sensor)
            });
        });
        logs.slice(0, 2).forEach((log) => {
            const severity = log.severity >= 4 ? 'critical' : log.severity >= 3 ? 'high' : log.severity >= 2 ? 'medium' : 'low';
            activity.push({
                severity,
                title: log.type || 'System log',
                badge: log.source || 'System',
                message: log.message || 'No details available.',
                timestamp: log.created_at
            });
        });

        const items = activity
            .sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime())
            .slice(0, 4);

        container.innerHTML = items.length > 0
            ? items.map((item) => `
                <div class="threat-item ${escapeHtml(item.severity)}">
                    <div style="display:flex;justify-content:space-between;">
                        <strong>${escapeHtml(item.title)}</strong>
                        <span class="badge ${getSeverityBadge(item.severity)}">${escapeHtml(item.badge)}</span>
                    </div>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:5px;">${escapeHtml(item.message)}</p>
                    <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:5px;">${escapeHtml(formatTimeAgo(item.timestamp))}</p>
                </div>
            `).join('')
            : `
                <div class="threat-item low">
                    <div style="display:flex;justify-content:space-between;">
                        <strong>No recent alerts</strong>
                        <span class="badge success">Clear</span>
                    </div>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:5px;">Sensors and cameras are idle right now.</p>
                </div>
            `;
    }

    function renderVibrationChart(sensor) {
        const container = document.getElementById('vibrationChart');
        if (!container) return;

        if (!sensor) {
            container.innerHTML = '<div class="chart-empty-state">No vibration sensor connected yet.</div>';
            setText('vibrationCurrentValue', 'N/A');
            setText('vibrationPeakValue', 'N/A');
            setText('vibrationLastUpdated', 'Awaiting data');
            setText('vibrationSensorName', 'No sensor');
            setText('vibrationTrendNote', 'Connect a vibration sensor to draw the live chart.');
            setText('vibrationStatusBadge', 'Offline');
            return;
        }

        let points = getRealtimeSensorHistory(sensor.sensor_id);
        if (points.length < 2 && !PageState.sensorHistoryPromises[sensor.sensor_id]) {
            const currentValue = getSensorNumericValue(sensor);
            if (currentValue !== null) {
                points = [{
                    timestamp: getSensorTimestamp(sensor) || new Date().toISOString(),
                    label: 'Now',
                    value: currentValue
                }];
            }
            hydrateSensorHistory(sensor.sensor_id).then(() => {
                if (pageName === 'index.html' && PageState.dashboardSnapshot) {
                    renderVibrationChart(sensor);
                }
            });
        }

        if (points.length === 0) {
            container.innerHTML = '<div class="chart-empty-state">Waiting for numeric vibration readings.</div>';
            return;
        }

        const chartPoints = points.slice(-18);
        const threshold = getSensorThreshold(sensor);
        const values = chartPoints.map((point) => point.value);
        if (threshold !== null) values.push(threshold);
        let minValue = Math.min(...values);
        let maxValue = Math.max(...values);
        if (minValue === maxValue) {
            minValue -= 1;
            maxValue += 1;
        }

        const width = 640;
        const height = 220;
        const paddingX = 30;
        const paddingY = 20;
        const usableWidth = width - paddingX * 2;
        const usableHeight = height - paddingY * 2;
        const coordinates = chartPoints.map((point, index) => {
            const x = paddingX + (chartPoints.length === 1 ? usableWidth / 2 : (index / (chartPoints.length - 1)) * usableWidth);
            const y = paddingY + ((maxValue - point.value) / (maxValue - minValue)) * usableHeight;
            return { x, y, value: point.value };
        });
        const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
        const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(1)} ${(height - paddingY).toFixed(1)} L ${coordinates[0].x.toFixed(1)} ${(height - paddingY).toFixed(1)} Z`;
        const thresholdY = threshold !== null ? paddingY + ((maxValue - threshold) / (maxValue - minValue)) * usableHeight : null;

        container.innerHTML = `
            <svg viewBox="0 0 ${width} ${height}" class="vibration-chart-svg" aria-label="Live vibration chart">
                <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" class="vibration-axis"></line>
                <line x1="${paddingX}" y1="${paddingY}" x2="${paddingX}" y2="${height - paddingY}" class="vibration-axis"></line>
                ${thresholdY !== null ? `<line x1="${paddingX}" y1="${thresholdY.toFixed(1)}" x2="${width - paddingX}" y2="${thresholdY.toFixed(1)}" class="vibration-threshold"></line>` : ''}
                <path d="${areaPath}" class="vibration-area"></path>
                <path d="${linePath}" class="vibration-line"></path>
                ${coordinates.map((point) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" class="vibration-point"></circle>`).join('')}
                <text x="${paddingX}" y="${paddingY - 4}" class="vibration-scale">${formatNumber(maxValue, 2)}</text>
                <text x="${paddingX}" y="${height - 4}" class="vibration-scale">${formatNumber(minValue, 2)}</text>
            </svg>
        `;

        const currentValue = chartPoints[chartPoints.length - 1].value;
        const peakValue = Math.max(...chartPoints.map((point) => point.value));
        const averageValue = chartPoints.reduce((sum, point) => sum + point.value, 0) / chartPoints.length;

        setText('vibrationCurrentValue', `${formatNumber(currentValue, 2)} g`);
        setText('vibrationPeakValue', `${formatNumber(peakValue, 2)} g`);
        setText('vibrationLastUpdated', formatTimeAgo(getSensorTimestamp(sensor)));
        setText('vibrationSensorName', sensor.name || sensor.sensor_id);
        setText('vibrationTrendNote', currentValue >= averageValue ? 'Current vibration is above the recent baseline.' : 'Current vibration is below the recent baseline.');
        setText('vibrationStatusBadge', getSensorTone(sensor) === 'alert' ? 'Alert' : 'Stable');
    }

    function renderGauge(containerId, sensor, label, maxValue) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const numeric = sensor ? getSensorNumericValue(sensor) : null;
        const threshold = sensor ? getSensorThreshold(sensor) : null;
        const percent = numeric !== null ? Math.max(0, Math.min(100, (numeric / maxValue) * 100)) : 0;
        const radius = 68;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (percent / 100) * circumference;

        let tone = 'info';
        if (numeric !== null) {
            if (threshold !== null && numeric >= threshold) {
                tone = 'danger';
            } else if (percent >= 70) {
                tone = 'warning';
            } else {
                tone = 'success';
            }
        }

        const unitRaw = String(normalizeSensorUnit(sensor?.unit, sensor?.type) || '').trim();
        const unit = sensor?.type === 'temperature'
            ? /F$/i.test(unitRaw) ? 'deg F' : /C$/i.test(unitRaw) ? 'deg C' : unitRaw
            : unitRaw;
        const statusText = numeric === null
            ? 'Awaiting sensor data'
            : threshold !== null
                ? `Threshold ${formatNumber(threshold, sensor?.type === 'humidity' ? 0 : 1)} ${unit}`.trim()
                : 'Realtime reading';

        container.innerHTML = `
            <div class="gauge-card">
                <div class="gauge-shell ${tone}">
                    <svg viewBox="0 0 180 180" class="gauge-svg" aria-label="${escapeHtml(label)} gauge">
                        <circle class="gauge-track" cx="90" cy="90" r="${radius}"></circle>
                        <circle class="gauge-progress ${tone}" cx="90" cy="90" r="${radius}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
                    </svg>
                    <div class="gauge-center">
                        <span class="gauge-value">${numeric !== null ? escapeHtml(formatNumber(numeric, sensor?.type === 'humidity' ? 0 : 1)) : 'N/A'}</span>
                        <span class="gauge-unit">${escapeHtml(unit || '--')}</span>
                    </div>
                </div>
                <div class="gauge-caption">${escapeHtml(label)}</div>
                <div class="gauge-meta">${escapeHtml(statusText)}</div>
            </div>
        `;
    }

    function renderDashboardSensorOverview(vibrationSensor, temperatureSensor) {
        const vibrationDisplay = getSensorDisplay(vibrationSensor);
        const temperatureDisplay = getSensorDisplay(temperatureSensor);
        const temperatureUnitRaw = String(normalizeSensorUnit(temperatureSensor?.unit, temperatureSensor?.type) || '').trim();
        const temperatureUnit = /F$/i.test(temperatureUnitRaw) ? 'deg F' : /C$/i.test(temperatureUnitRaw) ? 'deg C' : temperatureDisplay.unit;
        const latestTimestamp = [vibrationSensor, temperatureSensor]
            .map((sensor) => getSensorTimestamp(sensor))
            .filter(Boolean)
            .sort()
            .pop();

        setText('overviewVibrationValue', vibrationSensor ? `${vibrationDisplay.text}${vibrationDisplay.unit ? ` ${vibrationDisplay.unit}` : ''}` : 'N/A');
        setText('overviewTemperatureValue', temperatureSensor ? `${temperatureDisplay.text}${temperatureUnit ? ` ${temperatureUnit}` : ''}` : 'N/A');
        setText('overviewUpdatedAt', latestTimestamp ? formatTimeAgo(latestTimestamp) : 'Awaiting sensor updates');
    }

    function renderDashboardEnvironment(temperatureSensor, humiditySensor) {
        renderGauge('temperatureGauge', temperatureSensor, 'Temperature', 60);
        const humidityDisplay = getSensorDisplay(humiditySensor);
        const humidityNumeric = getSensorNumericValue(humiditySensor);

        if (!temperatureSensor) {
            setText('temperatureStatusBadge', 'Offline');
            setText('temperatureThresholdValue', 'Not set');
            setText('humidityCurrentValue', humiditySensor ? `${humidityDisplay.text}${humidityDisplay.unit ? ` ${humidityDisplay.unit}` : ''}` : 'No humidity sensor');
            setText('environmentUpdatedAt', 'Waiting for sensor feed');
            setText('temperatureSensorName', 'No sensor');
            setText('temperatureTrendNote', humiditySensor ? 'Humidity is online. Connect a temperature sensor to enable the gauge.' : 'Connect temperature and humidity sensors to activate the environment panel.');
            setText('temperatureGaugeNote', 'Waiting for the live temperature feed to arrive.');
            return;
        }

        const updatedAt = getSensorTimestamp(temperatureSensor);
        const threshold = getSensorThreshold(temperatureSensor);
        const numeric = getSensorNumericValue(temperatureSensor);
        const unitRaw = String(normalizeSensorUnit(temperatureSensor?.unit, temperatureSensor?.type) || '').trim();
        const unit = /F$/i.test(unitRaw) ? 'deg F' : /C$/i.test(unitRaw) ? 'deg C' : (unitRaw || 'C');
        const tone = getSensorTone(temperatureSensor);

        setText('temperatureStatusBadge', tone === 'alert' ? 'Alert' : tone === 'offline' ? 'Offline' : 'Stable');
        setText('temperatureThresholdValue', threshold !== null ? `${formatNumber(threshold, 1)} ${unit}` : 'Not set');
        setText('humidityCurrentValue', humiditySensor ? `${humidityDisplay.text}${humidityDisplay.unit ? ` ${humidityDisplay.unit}` : ''}` : 'No humidity sensor');
        setText('environmentUpdatedAt', updatedAt ? formatTimeAgo(updatedAt) : 'Waiting for sensor feed');
        setText('temperatureSensorName', temperatureSensor.name || temperatureSensor.sensor_id);
        setText(
            'temperatureTrendNote',
            threshold !== null && numeric !== null && numeric >= threshold
                ? `Temperature is above the configured threshold.${humidityNumeric !== null ? ` Humidity is ${formatNumber(humidityNumeric, 0)}%.` : ''}`
                : `Temperature is holding within the expected operating range.${humidityNumeric !== null ? ` Humidity is ${formatNumber(humidityNumeric, 0)}%.` : ''}`
        );
        setText(
            'temperatureGaugeNote',
            numeric !== null
                ? `Live reading is ${formatNumber(numeric, 1)} ${unit}${humidityNumeric !== null ? ` with humidity at ${formatNumber(humidityNumeric, 0)}%.` : '.'}`
                : 'Live temperature data is pending.'
        );
    }

    function renderDashboardAccessPanel(snapshot) {
        const accessControl = snapshot.systemStatus?.access_control || {};
        const lockActuator = findActuatorByType(snapshot.systemStatus?.actuators || [], 'lock');
        const doorSensor = (snapshot.sensors || []).find((sensor) => sensor.type === 'door') || null;
        const latestAccessLog = getLatestAccessLog(snapshot.logs || []);
        const awaitingFingerprint = Boolean(accessControl.awaiting_fingerprint);
        const lastEvent = accessControl.recent_event || null;
        const lastStatus = String(lastEvent?.status || '').toLowerCase();
        const doorUnlocked = Boolean(lastEvent?.door_unlocked) || (lockActuator ? !isActuatorOn(lockActuator) : false);
        const doorRawValue = String(doorSensor?.last_value ?? doorSensor?.latest_reading?.value ?? '').trim().toUpperCase();
        const doorIsOpen = ['OPEN', '1', 'ON', 'TRUE', 'DETECTED'].includes(doorRawValue);
        const doorOffline = doorSensor && (
            String(doorSensor?.runtime_status || '').toLowerCase() === 'offline'
            || String(doorSensor?.connection_state || '').toLowerCase() === 'offline'
            || String(doorSensor?.latest_reading?.status || '').toLowerCase() === 'offline'
            || doorSensor?.is_online === false
            || (Number.isFinite(Number(doorSensor?.age_seconds)) && Number(doorSensor?.age_seconds) > 10)
        );
        const doorStateText = !doorSensor
            ? 'No sensor'
            : doorOffline
                ? 'OFFLINE'
            : doorRawValue
                ? (doorIsOpen ? 'OPEN' : 'CLOSED')
                : 'Waiting...';
        const doorUpdatedAt = doorSensor ? getSensorTimestamp(doorSensor) : null;

        PageState.accessControl = accessControl;
        emitAccessEventFeedback(lastEvent, lastStatus, awaitingFingerprint);

        const workflowBadge = document.getElementById('accessWorkflowBadge');
        if (workflowBadge) {
            workflowBadge.className = `badge ${awaitingFingerprint ? 'warning' : lastStatus === 'granted' ? 'success' : lastStatus === 'denied' ? 'danger' : 'info'}`;
            workflowBadge.textContent = awaitingFingerprint ? 'Awaiting Fingerprint' : lastStatus === 'granted' ? 'Access Granted' : lastStatus === 'denied' ? 'Access Denied' : 'Idle';
        }

        const activeUser = accessControl.pending_user || lastEvent?.user_name || 'No active verification';
        const lastEventTime = lastEvent?.created_at || latestAccessLog?.created_at || null;
        const lastEventMessage = latestAccessLog?.message || 'No recent access event';
        syncAccessLiveConsole({
            awaitingFingerprint,
            lastStatus,
            lastEvent,
            accessControl,
            doorUnlocked,
            activeUser,
            lastEventMessage
        });

        if (awaitingFingerprint) {
            setStepState('rfidStepCard', 'success', `RFID ${maskIdentifier(accessControl.pending_rfid_uid)} accepted.`);
            setStepState('fingerprintStepCard', 'warning', 'Waiting for the matching fingerprint scan.');
            setStepState('doorStepCard', 'warning', 'Door stays locked until fingerprint verification succeeds.');
            setText('accessInstruction', `RFID verified for ${activeUser}. Complete fingerprint verification before ${formatTime(accessControl.expires_at)}.`);
        } else if (lastStatus === 'granted') {
            setStepState('rfidStepCard', 'success', `RFID ${maskIdentifier(lastEvent?.rfid_uid)} matched.`);
            setStepState('fingerprintStepCard', 'success', `Fingerprint ${maskIdentifier(lastEvent?.fingerprint_id)} verified.`);
            setStepState('doorStepCard', 'success', 'Two correct scans received. Door unlock command sent.');
            setText('accessInstruction', 'Dual verification succeeded. The main door lock actuator has been switched to unlock.');
        } else if (lastStatus === 'denied') {
            setStepState('rfidStepCard', 'danger', lastEvent?.rfid_uid ? `RFID ${maskIdentifier(lastEvent.rfid_uid)} was denied or incomplete.` : 'No valid RFID scan on record.');
            setStepState('fingerprintStepCard', 'danger', lastEvent?.fingerprint_id ? `Fingerprint ${maskIdentifier(lastEvent.fingerprint_id)} did not match.` : 'Fingerprint verification failed.');
            setStepState('doorStepCard', 'danger', 'Door remained locked after the failed verification.');
            setText('accessInstruction', 'Access was denied. Start again with a registered RFID card, then verify with the matching fingerprint.');
        } else {
            setStepState('rfidStepCard', 'idle', 'Waiting for RFID card.');
            setStepState('fingerprintStepCard', 'idle', 'Blocked until RFID is verified.');
            setStepState('doorStepCard', 'idle', doorUnlocked ? 'Door is currently unlocked.' : 'Waiting for dual verification.');
            setText('accessInstruction', 'Scan a registered RFID card first. After verification, scan the matching fingerprint to unlock the door.');
        }

        setText('rfidScanStatus', awaitingFingerprint
            ? `RFID ${maskIdentifier(accessControl.pending_rfid_uid)} accepted.`
            : lastStatus === 'granted'
                ? `RFID ${maskIdentifier(lastEvent?.rfid_uid)} verified.`
                : lastStatus === 'denied'
                    ? 'RFID verification failed or expired.'
                    : 'Waiting for RFID card.');
        setText('fingerprintScanStatus', awaitingFingerprint
            ? 'Waiting for the matching fingerprint scan.'
            : lastStatus === 'granted'
                ? `Fingerprint ${maskIdentifier(lastEvent?.fingerprint_id)} verified.`
                : lastStatus === 'denied'
                    ? 'Fingerprint verification failed.'
                    : 'Blocked until RFID is verified.');
        setText('doorAccessStatus', lastStatus === 'granted'
            ? 'Door unlocked after two correct scans.'
            : lastStatus === 'denied'
                ? 'Door stayed locked.'
                : doorUnlocked
                    ? 'Door is currently unlocked.'
                    : 'Waiting for dual verification.');
        setText('accessUserLabel', activeUser);
        setText('accessLastVerified', lastEventTime ? `${formatTimeAgo(lastEventTime)} - ${lastEventMessage}` : 'No recent access event');
        setText('doorSensorStatusLabel', doorStateText);
        setText('doorSensorUpdated', doorUpdatedAt ? `Updated ${formatTimeAgo(doorUpdatedAt)}` : 'Waiting for updates');

        const fingerprintInput = document.getElementById('fingerprintScanInput');
        if (fingerprintInput) {
            fingerprintInput.disabled = !awaitingFingerprint;
        }
    }

    function renderDashboard(snapshot) {
        PageState.dashboardSnapshot = snapshot;
        PageState.sensors = snapshot.sensors || [];
        PageState.cameras = snapshot.cameras || [];

        const sensors = PageState.sensors;
        const threats = snapshot.threats || [];
        const logs = snapshot.logs || [];
        const blockchain = snapshot.blockchain || [];
        const cameras = PageState.cameras;
        const vibrationSensor = sensors.find((sensor) => sensor.type === 'vibration');
        const temperatureSensor = sensors.find((sensor) => sensor.type === 'temperature');
        const humiditySensor = sensors.find((sensor) => sensor.type === 'humidity');
        const securityMode = snapshot.systemStatus?.security_mode || 'armed';

        setStatValues([
            threats.length,
            sensors.filter((sensor) => sensor.status === 'active').length,
            blockchain[0]?.block_number || blockchain.length || 0,
            cameras.filter((camera) => camera.status !== 'offline').length
        ]);

        updateStatusIndicator(securityMode === 'armed' ? 'System Armed' : 'System Disarmed', securityMode === 'armed' ? 'success' : 'warning');
        renderDashboardRecentActivity(threats, logs, sensors);
        renderDashboardSensorOverview(vibrationSensor, temperatureSensor);
        renderVibrationChart(vibrationSensor);
        renderDashboardEnvironment(temperatureSensor, humiditySensor);
        renderDashboardAccessPanel(snapshot);
    }

    function renderSensorsPageView(sensors, stats) {
        PageState.sensors = sensors;
        const motionSensors = sensors.filter((sensor) => sensor.type === 'motion');
        const vibrationSensors = sensors.filter((sensor) => sensor.type === 'vibration');
        const entrySensors = sensors.filter((sensor) => ['door', 'window'].includes(sensor.type));
        const environmentalSensors = sensors
            .filter((sensor) => ['temperature', 'humidity', 'fire', 'gas'].includes(sensor.type))
            .sort((left, right) => {
                const order = { temperature: 1, humidity: 2, fire: 3, gas: 4 };
                const leftRank = order[left.type] || 99;
                const rightRank = order[right.type] || 99;
                if (leftRank !== rightRank) return leftRank - rightRank;
                return String(left.name || left.sensor_id).localeCompare(String(right.name || right.sensor_id));
            });
        const firstHumiditySensor = environmentalSensors.find((sensor) => sensor.type === 'humidity') || null;
        const grids = document.querySelectorAll('.sensor-grid');

        renderSensorCards(grids[0], motionSensors, true);
        renderSensorCards(grids[1], vibrationSensors, true);
        renderSensorCards(grids[2], entrySensors, true);
        renderSensorCards(grids[3], environmentalSensors, true, { companionHumidity: firstHumiditySensor });

        setStatValues([
            stats.total || sensors.length,
            stats.motion || motionSensors.length,
            stats.vibration || vibrationSensors.length,
            stats.others || Math.max(0, sensors.length - motionSensors.length - vibrationSensors.length)
        ]);

        updateStatusIndicator(`${stats.active || sensors.filter((sensor) => sensor.status === 'active').length} Sensors Online`, 'success');
    }

    function renderThreatTable(threats) {
        const tbody = document.getElementById('threatTableBody');
        if (!tbody) return;

        tbody.innerHTML = threats.length > 0
            ? threats.map((threat) => `
                <tr>
                    <td>${escapeHtml(threat.threat_id)}</td>
                    <td>${escapeHtml(threat.type)}</td>
                    <td><span class="badge ${getSeverityBadge(threat.severity)}">${escapeHtml(toTitleCase(threat.severity))}</span></td>
                    <td>${escapeHtml(threat.source || 'System')}</td>
                    <td>${escapeHtml(threat.location || 'Unknown')}</td>
                    <td>${escapeHtml(formatTimeAgo(threat.detected_at))}</td>
                    <td><span class="badge info">${escapeHtml(toTitleCase(threat.status))}</span></td>
                    <td><button class="btn btn-secondary" type="button" style="padding:5px 10px;font-size:0.75rem;" data-threat-id="${escapeHtml(threat.threat_id)}">Resolve</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);">No active threats detected.</td></tr>';
    }

    function renderThreatTimeline(threats) {
        const timeline = document.getElementById('threatTimeline');
        if (!timeline) return;

        timeline.innerHTML = threats.length > 0
            ? threats.slice(0, 5).map((threat) => `
                <div class="threat-item ${escapeHtml(threat.severity || 'low')}">
                    <div style="display:flex;justify-content:space-between;">
                        <strong>${escapeHtml(threat.type)}</strong>
                        <span class="badge ${getSeverityBadge(threat.severity)}">${escapeHtml(toTitleCase(threat.severity))}</span>
                    </div>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:5px;">${escapeHtml(threat.description || 'No description provided.')}</p>
                    <p style="font-size:0.75rem;color:var(--text-secondary);margin-top:5px;">${escapeHtml(formatTimeAgo(threat.detected_at))}</p>
                </div>
            `).join('')
            : `
                <div class="threat-item low">
                    <div style="display:flex;justify-content:space-between;">
                        <strong>Threat timeline clear</strong>
                        <span class="badge success">Clear</span>
                    </div>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:5px;">No unresolved threats are flowing through the system right now.</p>
                </div>
            `;
    }

    function normalizeThreatLocation(location) {
        const normalized = String(location || 'Unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        return normalized || 'unknown';
    }

    function renderThreatMap(threats) {
        const stage = document.getElementById('threatDistributionMap');
        const statsContainer = document.getElementById('threatZoneStats');
        if (!stage || !statsContainer) return;

        const positions = {
            'main entrance': { x: 18, y: 68, label: 'Main Entrance' },
            'main hall': { x: 37, y: 58, label: 'Main Hall' },
            'server room': { x: 73, y: 28, label: 'Server Room' },
            'main server': { x: 70, y: 36, label: 'Main Server' },
            'parking lot': { x: 24, y: 22, label: 'Parking Lot' },
            'perimeter north': { x: 55, y: 18, label: 'Perimeter North' },
            'perimeter south': { x: 55, y: 82, label: 'Perimeter South' },
            'zone a': { x: 26, y: 46, label: 'Zone A' },
            'zone b': { x: 50, y: 50, label: 'Zone B' },
            'zone c': { x: 74, y: 58, label: 'Zone C' },
            unknown: { x: 50, y: 50, label: 'Unknown' }
        };
        const fallbackPositions = [
            { x: 22, y: 28 },
            { x: 42, y: 68 },
            { x: 62, y: 48 },
            { x: 78, y: 74 }
        ];
        const groups = {};

        threats.forEach((threat) => {
            const key = normalizeThreatLocation(threat.location);
            if (!groups[key]) {
                groups[key] = {
                    key,
                    label: positions[key]?.label || toTitleCase(threat.location || 'Unknown'),
                    count: 0,
                    severity: threat.severity || 'low',
                    latest: threat
                };
            }
            groups[key].count += 1;
            if (getSeverityWeight(threat.severity) >= getSeverityWeight(groups[key].severity)) {
                groups[key].severity = threat.severity;
                groups[key].latest = threat;
            }
        });

        const groupedZones = Object.values(groups).sort((left, right) => {
            const severityDiff = getSeverityWeight(right.severity) - getSeverityWeight(left.severity);
            return severityDiff !== 0 ? severityDiff : right.count - left.count;
        });

        if (groupedZones.length === 0) {
            stage.innerHTML = `
                <div class="threat-map-empty">
                    <strong>All monitored zones are clear.</strong>
                    <span>No active threat clusters are being tracked.</span>
                </div>
            `;
            statsContainer.innerHTML = `
                <div class="threat-zone-card clear">
                    <strong>Facility status</strong>
                    <span>0 active hot zones</span>
                </div>
            `;
            setText('activeThreatBadge', '0 Active');
            setText('threatMapSummary', 'All clear');
            return;
        }

        stage.innerHTML = groupedZones.map((zone, index) => {
            const position = positions[zone.key] || fallbackPositions[index % fallbackPositions.length];
            return `
                <div class="threat-map-node ${escapeHtml(zone.severity)}" style="left:${position.x}%;top:${position.y}%;">
                    <span class="threat-map-count">${zone.count}</span>
                    <span class="threat-map-label">${escapeHtml(zone.label)}</span>
                </div>
            `;
        }).join('');

        statsContainer.innerHTML = groupedZones.map((zone) => `
            <div class="threat-zone-card ${escapeHtml(zone.severity)}">
                <strong>${escapeHtml(zone.label)}</strong>
                <span>${zone.count} active threat${zone.count > 1 ? 's' : ''}</span>
                <span>${escapeHtml(zone.latest.type || 'Threat')}</span>
            </div>
        `).join('');

        setText('activeThreatBadge', `${threats.length} Active`);
        setText('threatMapSummary', `${groupedZones.length} hot zone${groupedZones.length > 1 ? 's' : ''}`);
    }

    function renderThreatAnalysis(threats, stats) {
        const total = stats.total || threats.length || 0;
        const critical = Number(stats.critical || 0);
        const high = Number(stats.high || 0);
        const medium = Number(stats.medium || 0);
        const low = Number(stats.low || 0);
        const resolved = Number(stats.resolved || 0);
        const weightedRisk = Math.min(100, (critical * 28) + (high * 16) + (medium * 9) + (low * 4));
        const containmentRate = total > 0 ? Math.max(0, Math.min(100, Math.round((resolved / total) * 100))) : 100;
        const detectionAccuracy = `${Math.max(91, 99 - Math.min(critical * 2 + high, 8))}%`;
        const responseTime = `${(0.2 + Math.min(1.8, threats.length * 0.12 + critical * 0.25)).toFixed(1)}s`;
        const highestThreat = threats.slice().sort((left, right) => getSeverityWeight(right.severity) - getSeverityWeight(left.severity))[0] || null;
        const dominantZone = highestThreat?.location || highestThreat?.source || 'Facility Clear';

        let tone = 'success';
        let state = 'Calm';
        let recommendation = 'Threat engine is waiting for live security data.';

        if (critical > 0) {
            tone = 'danger';
            state = 'Critical';
            recommendation = 'Critical threats are active. Prioritize containment on the highest severity source, isolate exposed entry points, and escalate operator review immediately.';
        } else if (high > 0) {
            tone = 'warning';
            state = 'Elevated';
            recommendation = 'High-risk activity is present. Tighten monitoring around the dominant zone and keep rapid response paths open for the next event burst.';
        } else if (medium > 0 || low > 0) {
            tone = 'info';
            state = 'Watching';
            recommendation = 'Low and medium signals are being tracked. Correlate motion, access, and environmental anomalies before promoting them to active intervention.';
        } else {
            recommendation = 'No unresolved threats are active. AI analysis recommends maintaining baseline surveillance and scheduled scan cycles.';
        }

        const analysisBadge = document.getElementById('threatAnalysisBadge');
        if (analysisBadge) {
            analysisBadge.className = `badge ${tone}`;
            analysisBadge.textContent = state;
        }

        setText('threatRadarScore', `${weightedRisk}%`);
        setText('threatRadarState', state);
        setText('threatCriticalCount', critical);
        setText('threatHighCount', high);
        setText('threatMediumCount', medium);
        setText('threatLowCount', low);
        setText('threatRecommendationText', recommendation);
        setText('threatDetectionAccuracy', detectionAccuracy);
        setText('threatResponseTime', responseTime);
        setText('threatDominantZone', dominantZone);
        setText('threatContainmentRate', `${containmentRate}%`);
    }

    function renderLogsPageView(logs, stats = {}) {
        PageState.logs = Array.isArray(logs) ? logs : [];
        const filteredLogs = filterLogsClientSide(PageState.logs);
        const logStream = document.getElementById('logStream');
        const streamBadge = document.getElementById('logStreamBadge');

        const total = Number(stats.total || filteredLogs.length || 0);
        const warnings = Number(stats.warnings || 0);
        const errors = Number(stats.errors || 0) + Number(stats.critical || 0);
        const accessLogs = filteredLogs.filter((log) => String(log?.type || '').toUpperCase() === 'ACCESS').length;
        const sensorLogs = filteredLogs.filter((log) => String(log?.type || '').toUpperCase() === 'SENSOR').length;

        setStatValues([
            total,
            warnings,
            accessLogs,
            sensorLogs
        ]);

        updateStatusIndicator(filteredLogs.length > 0 ? `${filteredLogs.length} Logs In View` : 'No Matching Logs', filteredLogs.length > 0 ? 'success' : 'warning');

        if (streamBadge) {
            streamBadge.className = `badge ${filteredLogs.length > 0 ? 'success' : 'warning'}`;
            streamBadge.textContent = filteredLogs.length > 0 ? 'Streaming' : 'No Match';
        }

        if (logStream) {
            logStream.innerHTML = filteredLogs.length > 0
                ? filteredLogs.map((log) => {
                    const tone = getLogTone(log);
                    const type = String(log?.type || 'LOG').toUpperCase();
                    const source = String(log?.source || 'SYSTEM').toUpperCase();
                    const palette = {
                        danger: 'var(--danger-color)',
                        warning: 'var(--warning-color)',
                        success: 'var(--accent-color)',
                        info: 'var(--primary-color)'
                    };
                    const typeColor = palette[tone] || palette.info;
                    return `
                        <div class="log-entry" style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                            <span style="color: var(--text-secondary);">[${escapeHtml(formatTime(log.created_at))}]</span>
                            <span style="color: ${typeColor};">[${escapeHtml(type)}]</span>
                            <span style="color: var(--primary-color);">[${escapeHtml(source)}]</span>
                            <span>${escapeHtml(log.message || 'No message available.')}</span>
                        </div>
                    `;
                }).join('')
                : '<div class="log-entry" style="padding: 8px 0; color: var(--text-secondary);">No logs matched the current filter.</div>';
        }
    }

    function renderThreatsPageView(threats, stats) {
        PageState.threats = threats;
        PageState.threatStats = stats;
        const warningCount = (stats.high || 0) + (stats.medium || 0);
        const totalThreats = stats.total || threats.length;
        const protectionRate = totalThreats > 0
            ? Math.max(0, Math.min(100, Math.round(((stats.resolved || 0) / totalThreats) * 100)))
            : 100;

        setStatValues([
            stats.critical || 0,
            warningCount,
            stats.resolved || 0,
            `${protectionRate}%`
        ]);

        updateStatusIndicator(`${stats.active || threats.length} Active Threats`, threats.length > 0 ? 'warning' : 'success');
        renderThreatTable(threats);
        renderThreatTimeline(threats);
        renderThreatAnalysis(threats, stats);
        renderThreatMap(threats);
    }

    async function initLogsPage() {
        const logsRes = await apiGet('logs.php', buildLogsQuery());
        renderLogsPageView(logsRes.data?.logs || [], logsRes.data?.stats || {});
        bindLogsPageControls();
    }

    function renderCameraGallery(camera) {
        const gallery = document.getElementById('cameraCaptureGallery');
        if (!gallery) return;
        const captures = PageState.captureHistory.filter((capture) => capture.cameraId === (camera?.camera_id || 'CAM-001'));
        const snapshotUrl = getCameraSnapshotUrl(camera);
        const galleryItems = [...captures];

        if (camera?.last_snapshot_at && snapshotUrl) {
            galleryItems.unshift({
                id: 'LATEST',
                cameraId: camera.camera_id,
                cameraName: camera.name,
                url: snapshotUrl,
                capturedAt: camera.last_snapshot_at
            });
        }

        gallery.innerHTML = galleryItems.length > 0
            ? galleryItems.map((capture) => `
                <div class="capture-thumbnail" style="position: relative; border-radius: 8px; overflow: hidden; background: var(--bg-darker); border: 1px solid var(--border-color); cursor: pointer;" data-capture-id="${escapeHtml(capture.id)}" data-capture-url="${escapeHtml(capture.url || '')}" data-capture-title="${escapeHtml(capture.cameraName || capture.id || 'Captured image')}">
                    <img src="${escapeHtml(capture.url)}" alt="${escapeHtml(capture.id)}" style="width: 100%; height: 100px; object-fit: cover; transition: opacity 0.2s;" onload="this.style.opacity=1" style="opacity:0">
                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.75); padding: 5px 8px; font-size: 0.75rem; color: #fff; display: flex; justify-content: space-between;">
                        <span>${escapeHtml(formatTime(capture.capturedAt))}</span>
                    </div>
                </div>
            `).join('')
            : '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 20px;">No captured images yet.</div>';
    }

    function renderCameraPreview(camera) {
        const image = document.getElementById('cameraLiveImage');
        const placeholder = document.getElementById('cameraPlaceholder');
        const streamAction = document.getElementById('cameraStreamActionBtn');
        if (!image || !placeholder) return;

        if (!camera) {
            image.hidden = true;
            image.removeAttribute('src');
            placeholder.hidden = false;
            setText('cameraNameLabel', 'No camera');
            setText('cameraBadge', 'Offline');
            setText('cameraLocationText', 'No camera configured');
            setText('cameraSourceText', 'Add an ESP32-CAM record with IP, stream_url, or snapshot_url to display media.');
            setText('cameraLastSnapshot', 'No snapshots');
            setOptionalLink('cameraOpenStreamLink', '');
            setOptionalLink('cameraOpenSnapshotLink', '');
            if (streamAction) {
                streamAction.textContent = 'Start Stream';
            }
            return;
        }

        const isStreaming = camera.status === 'recording' || camera.recording;
        const streamUrl = getCameraStreamUrl(camera);
        const fallbackSnapshot = PageState.captureHistory.find((capture) => capture.cameraId === camera.camera_id)?.url || getCameraSnapshotUrl(camera);
        const showLivePreview = Boolean(streamUrl) && (isStreaming || (pageName === 'camera.html' && camera.status !== 'offline'));
        const mediaUrl = showLivePreview ? streamUrl : withCacheBust(fallbackSnapshot || streamUrl);
        const snapshotLink = getCameraSnapshotUrl(camera) || fallbackSnapshot;

        if (mediaUrl) {
            image.alt = `${camera.name || camera.camera_id} ${showLivePreview ? 'live stream' : 'snapshot'}`;
            image.onerror = () => {
                image.onerror = null;

                if (showLivePreview && fallbackSnapshot) {
                    image.src = withCacheBust(fallbackSnapshot);
                    image.onerror = () => {
                        image.onerror = null;
                        image.hidden = true;
                        image.removeAttribute('src');
                        placeholder.hidden = false;
                        setText('cameraSourceText', 'Unable to reach the camera stream or snapshot. Check the ESP32-CAM URL settings.');
                    };
                    setText('cameraSourceText', 'Live stream unavailable. Showing the latest captured image instead.');
                    return;
                }

                image.hidden = true;
                image.removeAttribute('src');
                placeholder.hidden = false;
                setText('cameraSourceText', 'Unable to reach the camera feed. Check the ESP32-CAM IP, stream URL, or snapshot URL.');
            };
            image.src = mediaUrl;
            image.hidden = false;
            placeholder.hidden = true;
        } else {
            image.hidden = true;
            image.removeAttribute('src');
            placeholder.hidden = false;
        }

        setText('cameraNameLabel', camera.name || camera.camera_id);
        setText('cameraBadge', showLivePreview ? 'LIVE' : toTitleCase(camera.status || 'offline'));
        setText('cameraLocationText', camera.location || camera.zone || 'Unknown');
        setText(
            'cameraSourceText',
            showLivePreview
                ? (isStreaming ? 'ESP32-CAM live stream is active.' : 'Showing the direct ESP32-CAM live preview.')
                : (fallbackSnapshot ? 'Showing the latest captured image.' : 'Capture an image or start the live stream to load media.')
        );
        setText('cameraLastSnapshot', camera.last_snapshot_at ? formatTime(camera.last_snapshot_at) : 'No snapshots');
        setOptionalLink('cameraOpenStreamLink', streamUrl);
        setOptionalLink('cameraOpenSnapshotLink', snapshotLink ? withCacheBust(snapshotLink) : '');
        if (streamAction) {
            streamAction.textContent = isStreaming ? 'Stop Stream' : 'Start Stream';
        }
    }

    function renderCameraPageView(camera) {
        PageState.cameras = camera ? [camera] : [];
        const captures = PageState.captureHistory.filter((capture) => capture.cameraId === (camera?.camera_id || 'CAM-001'));

        setStatValues([
            camera ? 1 : 0,
            camera?.resolution || 'N/A',
            camera ? String(camera.type || 'camera').toUpperCase() : 'N/A',
            captures.length
        ]);

        updateStatusIndicator(camera ? ((camera.status === 'recording' || camera.recording) ? 'Streaming' : 'Camera Ready') : 'Camera Offline', camera ? ((camera.status === 'recording' || camera.recording) ? 'warning' : 'success') : 'danger');
        renderCameraPreview(camera);
        renderCameraGallery(camera);
    }

    function openCaptureModal(capture) {
        const modal = document.getElementById('cameraImageModal');
        const title = document.getElementById('cameraImageModalTitle');
        const image = document.getElementById('cameraImageModalPreview');
        const currentCamera = getPrimaryCamera(PageState.cameras);
        const sourceUrl = capture?.url || getCameraSnapshotUrl(currentCamera);
        if (!modal || !title || !image || !sourceUrl) return;
        title.textContent = capture.cameraName || capture.id || 'Captured image';
        image.onerror = () => {
            image.onerror = null;
            modal.classList.remove('active');
            image.removeAttribute('src');
            notify('Camera', 'Unable to load the captured image preview from the ESP32-CAM.', 'error');
        };
        image.src = withCacheBust(sourceUrl);
        image.alt = title.textContent;
        modal.classList.add('active');
    }

    function closeCaptureModal() {
        const modal = document.getElementById('cameraImageModal');
        const image = document.getElementById('cameraImageModalPreview');
        if (modal) modal.classList.remove('active');
        if (image) image.removeAttribute('src');
    }

    async function setAllSensorsStatus(status) {
        await apiSend('sensors.php', 'PUT', { all: true, status });
        await refreshLiveData();
    }

    async function clearTemporarySensorData(types = ['vibration', 'temperature']) {
        const typeList = (Array.isArray(types) ? types : ['vibration', 'temperature'])
            .map((type) => String(type || '').trim())
            .filter(Boolean);
        const query = `?clear_temporary=1&types=${encodeURIComponent(typeList.join(','))}`;
        const response = await apiDelete('sensors.php', query);

        const sensorIds = Array.isArray(response?.data?.sensor_ids)
            ? response.data.sensor_ids
            : [];

        if (sensorIds.length > 0 && window.JarvisRealtime?.clearSensorHistory) {
            window.JarvisRealtime.clearSensorHistory(sensorIds);
        }

        await refreshLiveData();
        return response;
    }

    async function setActuatorState(actuatorId, state) {
        if (!actuatorId) {
            throw new Error('Actuator ID is required.');
        }

        const response = await apiSend('control.php', 'POST', {
            action: 'control_actuator',
            actuator_id: actuatorId,
            state: Boolean(state)
        });

        await refreshLiveData();
        if (pageName === 'control.html') {
            await initControlPage();
        }

        return response;
    }

    async function setActuatorByType(type, state) {
        const statusRes = await apiGet('control.php', '?status=1');
        const actuator = findActuatorByType(statusRes.data?.actuators || [], type);
        if (!actuator) {
            throw new Error(`No ${type} actuator available.`);
        }
        return setActuatorState(actuator.actuator_id, state);
    }

    async function submitAccessVerification(payload) {
        const response = await apiSend('control.php', 'POST', {
            action: 'verify_access',
            source: 'DASHBOARD',
            ...payload
        });

        await refreshLiveData();
        return response;
    }

    async function fetchAccessProfiles() {
        const response = await apiGet('control.php', '?access_profiles=1');
        return Array.isArray(response?.data?.profiles) ? response.data.profiles : [];
    }

    async function upsertAccessProfile(profile) {
        const response = await apiSend('control.php', 'POST', {
            action: 'upsert_access_profile',
            ...profile
        });
        return response;
    }

    async function removeAccessProfileByRfid(rfidUid) {
        const response = await apiSend('control.php', 'POST', {
            action: 'remove_access_profile',
            rfid_uid: rfidUid
        });
        return response;
    }

    async function resetAccessVerification() {
        const response = await apiSend('control.php', 'POST', {
            action: 'reset_access_flow',
            source: 'DASHBOARD'
        });

        await refreshLiveData();
        return response;
    }

    async function updateSingleSensorStatus(sensorId, status) {
        await apiSend('sensors.php', 'PUT', { sensor_id: sensorId, status });
        await refreshLiveData();
    }

    async function resolveThreat(threatId) {
        await apiSend('threats.php', 'PUT', {
            threat_id: threatId,
            status: 'resolved'
        });
        await initThreatsPage();
        notify('Threats', 'Threat marked as resolved.', 'success');
    }

    async function updateCameraSetting(field, value) {
        const camera = getPrimaryCamera(PageState.cameras);
        if (!camera) throw new Error('No camera configured.');
        await apiSend('cameras.php', 'PUT', {
            camera_id: camera.camera_id,
            [field]: value
        });
        await refreshLiveData();
    }

    async function captureImage() {
        const camera = getPrimaryCamera(PageState.cameras);
        if (!camera) {
            notify('Camera', 'No camera configured.', 'warning');
            return;
        }

        const response = await apiSend('cameras.php', 'POST', {
            action: 'capture',
            camera_id: camera.camera_id
        });

        const snapshotUrl = withCacheBust(response.data?.snapshot_url || getCameraSnapshotUrl(camera));
        const capturedAt = response.data?.captured_at || new Date().toISOString();
        if (snapshotUrl) {
            const capture = {
                id: `IMG-${Date.now()}`,
                cameraId: camera.camera_id,
                cameraName: camera.name,
                url: snapshotUrl,
                capturedAt
            };
            addCaptureHistory(capture);
            renderCameraPageView({
                ...camera,
                last_snapshot_at: capturedAt,
                snapshot_url: response.data?.snapshot_url || camera.snapshot_url
            });
            openCaptureModal(capture);
        } else {
            renderCameraPageView({
                ...camera,
                last_snapshot_at: capturedAt
            });
        }

        notify('Camera', 'Capture command sent to the ESP32-CAM.', 'success');
        await refreshLiveData();
    }

    async function startCameraStream() {
        const camera = getPrimaryCamera(PageState.cameras);
        if (!camera) {
            notify('Camera', 'No camera configured.', 'warning');
            return;
        }

        const response = await apiSend('cameras.php', 'POST', {
            action: 'start_stream',
            camera_id: camera.camera_id
        });
        renderCameraPageView({
            ...camera,
            status: 'recording',
            recording: true,
            stream_url: response.data?.stream_url || camera.stream_url
        });
        notify('Camera', 'Live stream started.', 'success');
        await refreshLiveData();
    }

    async function stopCameraStream() {
        const camera = getPrimaryCamera(PageState.cameras);
        if (!camera) {
            notify('Camera', 'No camera configured.', 'warning');
            return;
        }

        await apiSend('cameras.php', 'POST', {
            action: 'stop_stream',
            camera_id: camera.camera_id
        });
        renderCameraPageView({
            ...camera,
            status: 'online',
            recording: false
        });
        notify('Camera', 'Live stream stopped.', 'warning');
        await refreshLiveData();
    }

    async function toggleStream() {
        const camera = getPrimaryCamera(PageState.cameras);
        if (!camera) {
            notify('Camera', 'No camera configured.', 'warning');
            return;
        }

        if (camera.status === 'recording' || camera.recording) {
            await stopCameraStream();
            return;
        }

        await startCameraStream();
    }

    function exportThreats() {
        const blob = new Blob([JSON.stringify(PageState.threats, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `threat-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function initDashboardPage() {
        const [sensorRes, threatRes, logsRes, blockRes, cameraRes, statusRes] = await Promise.all([
            apiGet('sensors.php'),
            apiGet('threats.php', '?status=active'),
            apiGet('logs.php', '?limit=20'),
            apiGet('blockchain.php', '?limit=10'),
            apiGet('cameras.php'),
            apiGet('control.php', '?status=1')
        ]);

        renderDashboard({
            sensors: sensorRes.data?.sensors || [],
            threats: threatRes.data?.threats || [],
            logs: logsRes.data?.logs || [],
            blockchain: blockRes.data?.blocks || [],
            cameras: cameraRes.data?.cameras || [],
            systemStatus: statusRes.data || {}
        });

        bindDashboardControls();
    }

    async function initSensorsPage() {
        const [sensorRes, statsRes] = await Promise.all([
            apiGet('sensors.php'),
            apiGet('sensors.php', '?stats=1')
        ]);

        const sensors = sensorRes.data?.sensors || [];
        const stats = statsRes.data?.stats
            ? {
                total: Number(statsRes.data.stats.total || 0),
                active: Number(statsRes.data.stats.active || 0),
                motion: sensors.filter((sensor) => sensor.type === 'motion').length,
                vibration: sensors.filter((sensor) => sensor.type === 'vibration').length,
                others: Math.max(0, sensors.length - sensors.filter((sensor) => sensor.type === 'motion').length - sensors.filter((sensor) => sensor.type === 'vibration').length)
            }
            : buildSensorStats(sensors);

        renderSensorsPageView(sensors, stats);
        bindSensorsPageControls();
    }

    async function initControlPage() {
        const [statusRes, profiles] = await Promise.all([
            apiGet('control.php', '?status=1'),
            fetchAccessProfiles()
        ]);
        PageState.accessProfiles = profiles;
        renderControlPageView(statusRes.data || {});
        bindControlPageControls();
    }

    async function initThreatsPage() {
        const [threatRes, statsRes] = await Promise.all([
            apiGet('threats.php', '?status=active'),
            apiGet('threats.php', '?stats=1')
        ]);

        const threats = threatRes.data?.threats || [];
        const stats = buildThreatStats(threats, statsRes.data?.stats || {}, { preferLive: true });
        renderThreatsPageView(threats, stats);
    }

    async function initCameraPage() {
        const camerasRes = await apiGet('cameras.php');
        const camera = getPrimaryCamera(camerasRes.data?.cameras || []);
        PageState.cameras = camerasRes.data?.cameras || [];
        renderCameraPageView(camera);
        bindCameraControls(camera);
    }

    function bindSensorsPageControls() {
        if (PageState.bindings.sensorsPage) return;

        const refreshButton = document.getElementById('refreshSensorsPageBtn');
        const turnOnButton = document.getElementById('turnAllSensorsOnBtn');
        const turnOffButton = document.getElementById('turnAllSensorsOffBtn');
        const bindBusyButton = (button, action) => {
            if (!button) return;
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await action();
                } finally {
                    button.disabled = false;
                }
            });
        };

        bindBusyButton(refreshButton, async () => {
            await window.refreshSensors();
        });

        bindBusyButton(turnOnButton, async () => {
            await window.turnAllSensorsOn();
        });

        bindBusyButton(turnOffButton, async () => {
            await window.turnAllSensorsOff();
        });

        PageState.bindings.sensorsPage = true;
    }

    function bindControlPageControls() {
        if (PageState.bindings.controlPage) return;

        const saveButton = document.getElementById('saveAccessProfileBtn');
        const clearButton = document.getElementById('clearAccessProfileFormBtn');
        const userNameInput = document.getElementById('accessUserNameInput');
        const rfidInput = document.getElementById('accessRfidInput');
        const fingerprintInput = document.getElementById('accessFingerprintInput');
        const roleInput = document.getElementById('accessRoleInput');

        if (saveButton) {
            saveButton.addEventListener('click', async () => {
                const name = String(userNameInput?.value || '').trim();
                const rfidUid = String(rfidInput?.value || '').trim().toUpperCase();
                const fingerprintId = String(fingerprintInput?.value || '').trim();
                const role = String(roleInput?.value || '').trim();

                if (!rfidUid || !fingerprintId) {
                    notify('Access Profiles', 'RFID UID and Fingerprint ID are required.', 'warning');
                    return;
                }

                saveButton.disabled = true;
                try {
                    await upsertAccessProfile({
                        name: name || 'Authorized User',
                        rfid_uid: rfidUid,
                        fingerprint_id: fingerprintId,
                        role: role || 'Administrator'
                    });
                    await initControlPage();
                    populateAccessProfileForm(null);
                    notify('Access Profiles', 'Profile saved successfully.', 'success');
                } catch (error) {
                    notify('Access Profiles', error.message || 'Failed to save profile.', 'error');
                } finally {
                    saveButton.disabled = false;
                }
            });
        }

        if (clearButton) {
            clearButton.addEventListener('click', () => {
                clearAccessProfileForm();
            });
        }

        PageState.bindings.controlPage = true;
    }

    function bindLogsPageControls() {
        if (PageState.bindings.logsPage) return;

        const typeSelect = document.getElementById('logType');
        const levelSelect = document.getElementById('logLevel');
        const searchInput = document.getElementById('logSearch');

        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                PageState.logFilters.type = typeSelect.value || 'all';
            });
        }
        if (levelSelect) {
            levelSelect.addEventListener('change', () => {
                PageState.logFilters.level = levelSelect.value || 'all';
            });
        }
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                PageState.logFilters.search = String(searchInput.value || '').trim();
            });
        }

        PageState.bindings.logsPage = true;
    }

    function bindDashboardControls() {
        if (PageState.bindings.dashboard) return;

        const rfidScanBtn = document.getElementById('rfidScanBtn');
        const fingerprintScanBtn = document.getElementById('fingerprintScanBtn');
        const resetAccessFlowBtn = document.getElementById('resetAccessFlowBtn');
        const rfidScanInput = document.getElementById('rfidScanInput');
        const fingerprintScanInput = document.getElementById('fingerprintScanInput');
        const bindBusyButton = (button, action) => {
            if (!button) return;
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await action();
                } finally {
                    button.disabled = false;
                }
            });
        };

        bindBusyButton(rfidScanBtn, async () => {
            const rfidUid = String(rfidScanInput?.value || '').trim();
            if (!rfidUid) {
                notify('Access Control', 'Enter or scan an RFID UID first.', 'warning');
                return;
            }
            try {
                const response = await submitAccessVerification({ rfid_uid: rfidUid });
                if (fingerprintScanInput) {
                    fingerprintScanInput.focus();
                }
                notify('Access Control', response.message || 'RFID verified. Scan fingerprint next.', 'success');
            } catch (error) {
                notify('Access Control', error.message || 'RFID scan failed.', 'error');
            }
        });

        bindBusyButton(fingerprintScanBtn, async () => {
            const fingerprintId = String(fingerprintScanInput?.value || '').trim();
            if (!fingerprintId) {
                notify('Access Control', 'Enter or scan a fingerprint ID.', 'warning');
                return;
            }
            try {
                const response = await submitAccessVerification({ fingerprint_id: fingerprintId });
                if (rfidScanInput) rfidScanInput.value = '';
                if (fingerprintScanInput) fingerprintScanInput.value = '';
                notify('Access Control', response.message || 'Fingerprint verified. Door unlocked.', 'success');
            } catch (error) {
                notify('Access Control', error.message || 'Fingerprint verification failed.', 'error');
            }
        });

        bindBusyButton(resetAccessFlowBtn, async () => {
            try {
                const response = await resetAccessVerification();
                if (rfidScanInput) rfidScanInput.value = '';
                if (fingerprintScanInput) fingerprintScanInput.value = '';
                notify('Access Control', response.message || 'Verification flow reset.', 'success');
            } catch (error) {
                notify('Access Control', error.message || 'Unable to reset verification flow.', 'error');
            }
        });

        PageState.bindings.dashboard = true;
    }

    function bindCameraControls(camera) {
        if (PageState.bindings.camera) return;

        const modal = document.getElementById('cameraImageModal');

        if (modal) {
            modal.addEventListener('click', (event) => {
                if (event.target === modal) {
                    closeCaptureModal();
                }
            });
        }

        PageState.bindings.camera = true;
    }

    function bindDelegatedHandlers() {
        if (PageState.bindings.delegated) return;

        document.addEventListener('click', async (event) => {
            const actuatorButton = event.target.closest('[data-actuator-id][data-actuator-state]');
            if (actuatorButton) {
                const actuatorId = actuatorButton.dataset.actuatorId;
                const desiredState = String(actuatorButton.dataset.actuatorState).toLowerCase() === 'true';
                const siblingButtons = Array.from(actuatorButton.parentElement?.querySelectorAll('[data-actuator-id][data-actuator-state]') || []);
                siblingButtons.forEach((button) => {
                    button.disabled = true;
                });
                try {
                    await setActuatorState(actuatorId, desiredState);
                    notify('Actuators', `Command sent to ${actuatorId}: ${desiredState ? 'ON' : 'OFF'}.`, 'success');
                } catch (error) {
                    notify('Actuators', error.message || 'Unable to control actuator.', 'error');
                } finally {
                    siblingButtons.forEach((button) => {
                        button.disabled = false;
                    });
                }
                return;
            }

            const sensorButton = event.target.closest('[data-sensor-id][data-sensor-status]');
            if (sensorButton) {
                const siblingButtons = Array.from(sensorButton.parentElement?.querySelectorAll('[data-sensor-id][data-sensor-status]') || []);
                siblingButtons.forEach((button) => {
                    button.disabled = true;
                });
                try {
                    await updateSingleSensorStatus(sensorButton.dataset.sensorId, sensorButton.dataset.sensorStatus);
                    notify('Sensors', `Sensor ${sensorButton.dataset.sensorId} monitoring set to ${sensorButton.dataset.sensorStatus}.`, 'success');
                } catch (error) {
                    notify('Sensors', error.message || 'Unable to update sensor.', 'error');
                } finally {
                    siblingButtons.forEach((button) => {
                        button.disabled = false;
                    });
                }
                return;
            }

            const threatButton = event.target.closest('[data-threat-id]');
            if (threatButton) {
                try {
                    await resolveThreat(threatButton.dataset.threatId);
                } catch (error) {
                    notify('Threats', error.message || 'Unable to resolve threat.', 'error');
                }
                return;
            }

            const captureButton = event.target.closest('[data-capture-id]');
            if (captureButton) {
                const capture = PageState.captureHistory.find((item) => item.id === captureButton.dataset.captureId)
                    || {
                        id: captureButton.dataset.captureId,
                        cameraName: captureButton.dataset.captureTitle || 'Captured image',
                        url: captureButton.dataset.captureUrl || getCameraSnapshotUrl(getPrimaryCamera(PageState.cameras))
                    };
                if (capture) openCaptureModal(capture);
                return;
            }

            const accessProfileButton = event.target.closest('[data-access-action][data-rfid-uid]');
            if (accessProfileButton) {
                const action = String(accessProfileButton.dataset.accessAction || '');
                const rfidUid = String(accessProfileButton.dataset.rfidUid || '').trim().toUpperCase();
                if (!rfidUid) return;

                if (action === 'edit') {
                    const profile = (PageState.accessProfiles || []).find((item) => String(item?.rfid_uid || '').toUpperCase() === rfidUid);
                    if (!profile) {
                        notify('Access Profiles', `Profile ${rfidUid} not found.`, 'warning');
                        return;
                    }
                    populateAccessProfileForm(profile);
                    notify('Access Profiles', `Editing profile ${rfidUid}.`, 'info');
                    return;
                }

                if (action === 'delete') {
                    const confirmed = window.confirm(`Delete access profile for RFID ${rfidUid}?`);
                    if (!confirmed) return;

                    accessProfileButton.disabled = true;
                    try {
                        await removeAccessProfileByRfid(rfidUid);
                        await initControlPage();
                        if (PageState.accessProfileEditingRfid === rfidUid) {
                            clearAccessProfileForm();
                        }
                        notify('Access Profiles', `Profile ${rfidUid} deleted.`, 'success');
                    } catch (error) {
                        notify('Access Profiles', error.message || 'Failed to delete profile.', 'error');
                    } finally {
                        accessProfileButton.disabled = false;
                    }
                }
            }
        });

        PageState.bindings.delegated = true;
    }

    function handleRealtimeUpdate(event) {
        const snapshot = event.detail || {};

        if (pageName === 'index.html') {
            renderDashboard(snapshot);
            return;
        }
        if (pageName === 'sensors.html') {
            renderSensorsPageView(snapshot.sensors || [], buildSensorStats(snapshot.sensors || []));
            return;
        }
        if (pageName === 'threats.html') {
            renderThreatsPageView(
                snapshot.threats || [],
                buildThreatStats(snapshot.threats || [], PageState.threatStats, { preferLive: true })
            );
            return;
        }
        if (pageName === 'logs.html') {
            renderLogsPageView(snapshot.logs || []);
            return;
        }
        if (pageName === 'camera.html') {
            PageState.cameras = snapshot.cameras || [];
            renderCameraPageView(getPrimaryCamera(snapshot.cameras || []));
            return;
        }
        if (pageName === 'control.html') {
            renderControlPageView(snapshot.systemStatus || {});
        }
    }

    function handleRealtimeError() {
        if (pageName !== 'login.html') {
            updateStatusIndicator('Connection Lost', 'danger');
        }
    }

    async function initializePage() {
        await ensureAuthenticated();

        if (pageName === 'index.html') {
            await initDashboardPage();
            return;
        }
        if (pageName === 'sensors.html') {
            await initSensorsPage();
            return;
        }
        if (pageName === 'threats.html') {
            await initThreatsPage();
            return;
        }
        if (pageName === 'logs.html') {
            await initLogsPage();
            return;
        }
        if (pageName === 'camera.html') {
            await initCameraPage();
            return;
        }
        if (pageName === 'control.html') {
            await initControlPage();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        bindDelegatedHandlers();
        window.addEventListener('jarvis:realtime', handleRealtimeUpdate);
        window.addEventListener('jarvis:realtime-error', handleRealtimeError);

        initializePage().catch((error) => {
            notify('System', error.message, 'warning');
        });
    });

    window.refreshDashboard = async function refreshDashboard() {
        await initDashboardPage();
        notify('Dashboard', 'Dashboard refreshed.', 'success');
    };

    window.refreshSensors = async function refreshSensors() {
        await initSensorsPage();
        notify('Sensors', 'Sensor readings refreshed.', 'success');
    };

    window.turnAllSensorsOn = async function turnAllSensorsOn() {
        await setAllSensorsStatus('active');
        notify('Sensors', 'All sensors set to active monitoring. Dashboard and sensor page are synced.', 'success');
    };

    window.turnAllSensorsOff = async function turnAllSensorsOff() {
        await setAllSensorsStatus('inactive');
        notify('Sensors', 'All sensors set to off. New sensor data will now be ignored until sensors are turned on again.', 'warning');
    };

    window.clearTemporarySensorData = async function clearTemporarySensorDataFromUI() {
        const response = await clearTemporarySensorData(['vibration', 'temperature']);
        const deletedReadings = Number(response?.data?.deleted_readings || 0);
        const resetSensors = Number(response?.data?.reset_sensors || 0);
        setText('tempDataQuickStatus', 'Cleared just now');
        notify('Sensors', `Cleared ${deletedReadings} readings and reset ${resetSensors} sensor cache values.`, 'success');
    };

    window.scanForThreats = async function scanForThreats() {
        await initThreatsPage();
        notify('Threat Scan', 'Threat data refreshed from the backend.', 'success');
    };

    window.exportLogs = async function exportLogs() {
        const payload = JSON.stringify(filterLogsClientSide(PageState.logs), null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `system-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        notify('Logs', 'Logs exported successfully.', 'success');
    };

    window.clearLogs = async function clearLogs() {
        const response = await apiDelete('logs.php');
        await refreshLiveData();
        notify('Logs', response.message || 'Old logs cleared successfully.', 'success');
    };

    window.applyFilters = async function applyFilters() {
        const typeSelect = document.getElementById('logType');
        const levelSelect = document.getElementById('logLevel');
        const searchInput = document.getElementById('logSearch');

        PageState.logFilters = {
            type: typeSelect?.value || 'all',
            level: levelSelect?.value || 'all',
            search: String(searchInput?.value || '').trim()
        };

        const response = await apiGet('logs.php', buildLogsQuery());
        renderLogsPageView(response.data?.logs || [], response.data?.stats || {});
        notify('Logs', 'Log filters applied.', 'success');
    };

    window.resetFilters = async function resetFilters() {
        const typeSelect = document.getElementById('logType');
        const levelSelect = document.getElementById('logLevel');
        const searchInput = document.getElementById('logSearch');

        if (typeSelect) typeSelect.value = 'all';
        if (levelSelect) levelSelect.value = 'all';
        if (searchInput) searchInput.value = '';

        PageState.logFilters = { type: 'all', level: 'all', search: '' };

        const response = await apiGet('logs.php', buildLogsQuery());
        renderLogsPageView(response.data?.logs || [], response.data?.stats || {});
        notify('Logs', 'Log filters reset.', 'success');
    };

    window.saveSettings = async function saveSettings() {
        if (pageName === 'control.html') {
            await initControlPage();
        }
        notify('Control', 'Control state synced from backend.', 'success');
    };

    window.resetSettings = async function resetSettings() {
        if (pageName === 'control.html') {
            await initControlPage();
        }
        notify('Control', 'Control panel refreshed.', 'success');
    };

    window.emergencyContacts = function emergencyContacts() {
        notify('Emergency Contacts', 'Police: 100 | Fire: 101 | Ambulance: 102', 'info');
    };

    window.systemReport = async function systemReport() {
        try {
            const statusRes = await apiGet('control.php', '?status=1');
            const health = statusRes.data?.system_health || {};
            const summary = `CPU: ${health.cpu ?? 'N/A'} | Memory: ${health.memory ?? 'N/A'} | Disk: ${health.disk ?? 'N/A'}`;
            notify('System Report', summary, 'info');
        } catch (error) {
            notify('System Report', error.message || 'Unable to fetch system health.', 'warning');
        }
    };

    window.exportThreats = exportThreats;
    window.captureImage = captureImage;
    window.startCameraStream = startCameraStream;
    window.stopCameraStream = stopCameraStream;
    window.toggleStream = toggleStream;
    window.closeCaptureModal = closeCaptureModal;
})();
