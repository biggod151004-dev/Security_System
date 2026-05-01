/**
 * JARVIS Security System - Real-time Data Handler
 */
(function () {
    'use strict';

    const RTState = {
        snapshot: {
            sensors: [],
            threats: [],
            logs: [],
            blockchain: [],
            cameras: [],
            systemStatus: {}
        },
        sensorHistory: {},
        pollTimers: {},
        alertState: {
            sensorActive: {}
        }
    };

    function getApiBase() {
        if (window.JarvisApp?.getApiBase) {
            return window.JarvisApp.getApiBase();
        }

        const path = window.location.pathname.replace(/\\/g, '/');
        if (path.includes('/frontend/pages/')) {
            return '../../backend/php/api';
        }
        if (path.includes('/frontend/')) {
            return '../backend/php/api';
        }
        return '/backend/php/api';
    }

    async function apiGet(endpoint, query = '') {
        const response = await fetch(`${getApiBase()}/${endpoint}${query}`, {
            headers: { Accept: 'application/json' }
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }

        return data;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function readNumericValue(rawValue) {
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
            return rawValue;
        }

        const match = String(rawValue ?? '').match(/-?\d+(\.\d+)?/);
        return match ? Number.parseFloat(match[0]) : null;
    }

    function getSensorNumericValue(sensor) {
        const numericReading = sensor?.latest_reading?.numeric_value;
        if (numericReading !== null && numericReading !== undefined && numericReading !== '') {
            const parsed = Number.parseFloat(numericReading);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }

        if (sensor?.type && ['temperature', 'humidity', 'vibration'].includes(sensor.type)) {
            return readNumericValue(sensor.last_value ?? sensor.latest_reading?.value);
        }

        return null;
    }

    function getSensorTimestamp(sensor) {
        return sensor?.last_reading || sensor?.latest_reading?.recorded_at || new Date().toISOString();
    }

    function appendSensorHistory(sensor) {
        if (!sensor?.sensor_id) {
            return;
        }

        const numericValue = getSensorNumericValue(sensor);
        if (numericValue === null || Number.isNaN(numericValue)) {
            return;
        }

        const sensorId = sensor.sensor_id;
        const history = RTState.sensorHistory[sensorId] || [];
        const timestamp = getSensorTimestamp(sensor);
        const label = new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        const lastPoint = history[history.length - 1];
        if (!lastPoint || lastPoint.timestamp !== timestamp || lastPoint.value !== numericValue) {
            history.push({
                timestamp,
                label,
                value: numericValue
            });
        }

        RTState.sensorHistory[sensorId] = history.slice(-30);
    }

    function dispatchRealtimeEvent(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function getSensorIdentity(sensor) {
        return String(sensor?.sensor_id || sensor?.name || sensor?.type || '').trim();
    }

    function isSensorInAlert(sensor) {
        if (!sensor) return false;
        if (String(sensor.latest_reading?.status || '').toLowerCase() === 'alert') return true;
        if (String(sensor.status || '').toLowerCase() === 'error') return true;
        return false;
    }

    function evaluateSensorAlertTransitions(sensors) {
        const previous = RTState.alertState.sensorActive || {};
        const next = {};
        const newAlerts = [];

        (Array.isArray(sensors) ? sensors : []).forEach((sensor) => {
            const identity = getSensorIdentity(sensor);
            if (!identity) return;

            const activeNow = isSensorInAlert(sensor);
            next[identity] = activeNow;

            if (activeNow && !previous[identity]) {
                newAlerts.push({
                    sensor_id: sensor.sensor_id || identity,
                    name: sensor.name || identity,
                    type: sensor.type || 'sensor',
                    status: sensor.status || sensor.latest_reading?.status || 'alert'
                });
            }
        });

        RTState.alertState.sensorActive = next;

        if (newAlerts.length > 0) {
            dispatchRealtimeEvent('jarvis:sound-alert', {
                kind: 'sensor',
                count: newAlerts.length,
                sensors: newAlerts
            });
        }
    }

    function getSnapshot() {
        return {
            ...clone(RTState.snapshot),
            sensorHistory: clone(RTState.sensorHistory)
        };
    }

    async function fetchAllData() {
        try {
            const [sensorRes, threatRes, logsRes, blockRes, cameraRes, statusRes] = await Promise.all([
                apiGet('sensors.php'),
                apiGet('threats.php', '?status=active'),
                apiGet('logs.php', '?limit=20'),
                apiGet('blockchain.php', '?limit=10'),
                apiGet('cameras.php'),
                apiGet('control.php', '?status=1')
            ]);

            RTState.snapshot = {
                sensors: sensorRes?.data?.sensors || [],
                threats: threatRes?.data?.threats || [],
                logs: logsRes?.data?.logs || [],
                blockchain: blockRes?.data?.blocks || [],
                cameras: cameraRes?.data?.cameras || [],
                systemStatus: statusRes?.data || {}
            };

            RTState.snapshot.sensors.forEach(appendSensorHistory);
            evaluateSensorAlertTransitions(RTState.snapshot.sensors);
            dispatchRealtimeEvent('jarvis:realtime', getSnapshot());
        } catch (error) {
            console.error('Realtime fetch failed:', error);
            dispatchRealtimeEvent('jarvis:realtime-error', {
                message: error.message || 'Realtime polling failed'
            });
        }
    }

    function seedSensorHistory(sensorId, points) {
        if (!sensorId || !Array.isArray(points) || points.length === 0) {
            return;
        }

        const normalized = points
            .map((point) => ({
                timestamp: point.timestamp || new Date().toISOString(),
                label: point.label || new Date(point.timestamp || Date.now()).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                value: Number(point.value)
            }))
            .filter((point) => Number.isFinite(point.value))
            .slice(-30);

        if (normalized.length > 0) {
            RTState.sensorHistory[sensorId] = normalized;
        }
    }

    function getSensorHistory(sensorId) {
        return clone(RTState.sensorHistory[sensorId] || []);
    }

    function clearSensorHistory(sensorIds) {
        const targets = Array.isArray(sensorIds) ? sensorIds : [sensorIds];
        targets
            .map((sensorId) => String(sensorId || '').trim())
            .filter((sensorId) => sensorId.length > 0)
            .forEach((sensorId) => {
                delete RTState.sensorHistory[sensorId];
            });
    }

    function startPolling() {
        if (RTState.pollTimers.general) {
            return;
        }

        fetchAllData();
        RTState.pollTimers.general = window.setInterval(fetchAllData, 4000);
    }

    function stopPolling() {
        if (RTState.pollTimers.general) {
            window.clearInterval(RTState.pollTimers.general);
            RTState.pollTimers.general = null;
        }
    }

    document.addEventListener('DOMContentLoaded', startPolling);

    window.JarvisRealtime = {
        state: RTState,
        fetchAllData,
        startPolling,
        stopPolling,
        getSnapshot,
        getSensorHistory,
        seedSensorHistory,
        clearSensorHistory
    };
})();
