/**
 * JARVIS AI Assistant
 */
(function () {
    'use strict';

    class JarvisAI {
        hasAny(message, phrases) {
            return phrases.some((phrase) => message.includes(phrase));
        }

        navigate(page) {
            if (window.JarvisApp?.navigateToPage) {
                window.JarvisApp.navigateToPage(page);
                return;
            }

            const current = window.location.pathname.replace(/\\/g, '/').split('/').pop() || 'index.html';
            const target = current === 'index.html' ? `pages/${page}` : page === 'index.html' ? '../index.html' : page;
            window.location.href = target;
        }

        async processMessage(rawMessage) {
            const message = String(rawMessage || '').trim();
            if (!message) {
                return 'Please type a message so I can help.';
            }

            const lower = message.toLowerCase();

            if (this.hasAny(lower, ['hello', 'hi'])) {
                return 'JARVIS is online. How can I assist?';
            }

            if (this.hasAny(lower, ['what day is it', 'what is the day', 'today'])) {
                const now = new Date();
                return `Today is ${now.toLocaleDateString(navigator.language || undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
            }

            if (this.hasAny(lower, ['what time is it', 'current time', 'time'])) {
                const now = new Date();
                return `The time is ${now.toLocaleTimeString(navigator.language || undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}.`;
            }

            if (this.hasAny(lower, ['open dashboard', 'go to dashboard'])) {
                this.navigate('index.html');
                return 'Opening dashboard.';
            }

            if (this.hasAny(lower, ['open sensors', 'go to sensors'])) {
                this.navigate('sensors.html');
                return 'Opening sensors page.';
            }

            if (this.hasAny(lower, ['open threats', 'go to threats'])) {
                this.navigate('threats.html');
                return 'Opening threats page.';
            }

            if (this.hasAny(lower, ['open camera', 'go to camera'])) {
                this.navigate('camera.html');
                return 'Opening camera page.';
            }

            if (this.hasAny(lower, ['arm system', 'activate security'])) {
                window.setSecurityMode?.('armed');
                return 'Security system armed.';
            }

            if (this.hasAny(lower, ['disarm system', 'disable security'])) {
                window.setSecurityMode?.('disarmed');
                return 'Security system disarmed.';
            }

            if (this.hasAny(lower, ['turn all sensors on', 'enable all sensors'])) {
                await window.turnAllSensorsOn?.();
                return 'Turning on all sensors.';
            }

            if (this.hasAny(lower, ['turn all sensors off', 'disable all sensors'])) {
                await window.turnAllSensorsOff?.();
                return 'Turning off all sensors.';
            }

            if (this.hasAny(lower, ['capture image', 'take snapshot'])) {
                await window.captureImage?.();
                return 'Capturing an image from the ESP32-CAM.';
            }

            if (this.hasAny(lower, ['start stream', 'start camera stream'])) {
                await window.startCameraStream?.();
                return 'Starting the camera stream.';
            }

            if (this.hasAny(lower, ['stop stream', 'stop camera stream'])) {
                await window.stopCameraStream?.();
                return 'Stopping the camera stream.';
            }

            if (this.hasAny(lower, ['refresh threats', 'scan threats'])) {
                await window.scanForThreats?.();
                return 'Refreshing the threat feed.';
            }

            if (this.hasAny(lower, ['logout', 'log out', 'sign out'])) {
                window.logoutUser?.();
                return 'Logging out.';
            }

            if (this.hasAny(lower, ['system status', 'system health', 'status'])) {
                return 'The dashboard is live, sensor polling is active, and the quick actions are wired to the backend.';
            }

            if (this.hasAny(lower, ['help', 'commands'])) {
                return 'Try: open dashboard, open sensors, open threats, open camera, arm system, turn all sensors on, capture image, or what time is it.';
            }

            return 'I can help with navigation, arming or disarming security, sensor power commands, camera controls, threat refresh, date and time, or logout.';
        }

        addMessage(text, sender) {
            const container = document.getElementById('chatMessages');
            if (!container) return;

            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${sender}`;

            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.textContent = text;

            messageDiv.appendChild(bubble);
            container.appendChild(messageDiv);
            container.scrollTop = container.scrollHeight;
        }

        sendMessage() {
            const input = document.getElementById('chatInput');
            if (!input) return;

            const message = input.value.trim();
            if (!message) return;

            input.value = '';
            this.addMessage(message, 'user');

            window.setTimeout(async () => {
                const response = await this.processMessage(message);
                this.addMessage(response, 'jarvis');
                window.JarvisApp?.speak?.(response);
            }, 200);
        }
    }

    let jarvisAI = null;

    document.addEventListener('DOMContentLoaded', () => {
        jarvisAI = new JarvisAI();
    });

    window.sendChatMessage = function sendChatMessage() {
        jarvisAI?.sendMessage();
    };

    window.handleChatKeypress = function handleChatKeypress(event) {
        if (event.key === 'Enter') {
            window.sendChatMessage();
        }
    };
})();
