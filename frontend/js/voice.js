/**
 * JARVIS Voice Command System
 */
(function () {
    'use strict';

    class VoiceCommandSystem {
        constructor() {
            this.recognition = null;
            this.isListening = false;
            this.commands = [];
            this.initialize();
        }

        initialize() {
            this.bindUI();

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                window.showNotification?.('Voice Commands', 'Speech recognition is not supported in this browser.', 'warning');
                return;
            }

            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = navigator.language || 'en-US';
            this.recognition.maxAlternatives = 1;

            this.recognition.onstart = () => this.onStart();
            this.recognition.onresult = (event) => this.onResult(event);
            this.recognition.onerror = (event) => this.onError(event);
            this.recognition.onend = () => this.onEnd();

            this.registerDefaultCommands();
        }

        bindUI() {
            const voiceBtn = document.getElementById('voiceControlBtn');
            if (voiceBtn) {
                voiceBtn.addEventListener('click', () => this.toggleListening());
            }

            const voiceModal = document.getElementById('voiceModal');
            if (voiceModal) {
                voiceModal.addEventListener('click', (event) => {
                    if (event.target === voiceModal) {
                        this.stopListening();
                    }
                });
            }
        }

        normalize(text) {
            return String(text || '')
                .toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
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

        register(phrases, callback, reply) {
            this.commands.push({
                phrases: phrases.map((phrase) => this.normalize(phrase)),
                callback,
                reply
            });
        }

        registerDefaultCommands() {
            this.register(['go to dashboard', 'open dashboard', 'dashboard'], () => this.navigate('index.html'), 'Opening dashboard.');
            this.register(['go to sensors', 'open sensors', 'sensor page'], () => this.navigate('sensors.html'), 'Opening sensors page.');
            this.register(['go to threats', 'open threats'], () => this.navigate('threats.html'), 'Opening threats page.');
            this.register(['go to camera', 'open camera', 'open live camera'], () => this.navigate('camera.html'), 'Opening camera page.');
            this.register(['arm system', 'activate security'], () => window.setSecurityMode?.('armed'), 'Arming the system.');
            this.register(['disarm system', 'disable security'], () => window.setSecurityMode?.('disarmed'), 'Disarming the system.');
            this.register(['turn all sensors on', 'enable all sensors'], () => window.turnAllSensorsOn?.(), 'Turning all sensors on.');
            this.register(['turn all sensors off', 'disable all sensors'], () => window.turnAllSensorsOff?.(), 'Turning all sensors off.');
            this.register(['refresh dashboard', 'refresh sensors', 'refresh data'], () => window.refreshDashboard?.() || window.refreshSensors?.(), 'Refreshing live data.');
            this.register(['capture image', 'take snapshot', 'capture camera image'], () => window.captureImage?.(), 'Capturing image from the camera.');
            this.register(['start camera stream', 'start stream'], () => window.startCameraStream?.(), 'Starting the camera stream.');
            this.register(['stop camera stream', 'stop stream'], () => window.stopCameraStream?.(), 'Stopping the camera stream.');
            this.register(['scan threats', 'refresh threats', 'run threat scan'], () => window.scanForThreats?.(), 'Refreshing the threat feed.');
            this.register(['logout', 'log out', 'sign out'], () => window.logoutUser?.(), 'Logging out.');
            this.register(['what day is it', 'what is the day today', 'tell me the day'], () => {}, this.todayReply());
            this.register(['what time is it', 'tell me the time', 'current time'], () => {}, this.timeReply());
            this.register(['help', 'show commands'], () => {}, 'Try commands like open dashboard, open sensors, open camera, arm system, turn all sensors on, capture image, or what time is it.');
        }

        todayReply() {
            const now = new Date();
            return `Today is ${now.toLocaleDateString(navigator.language || undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
        }

        timeReply() {
            const now = new Date();
            return `The time is ${now.toLocaleTimeString(navigator.language || undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}.`;
        }

        toggleListening() {
            if (this.isListening) {
                this.stopListening();
                return;
            }

            this.startListening();
        }

        startListening() {
            if (!this.recognition) {
                window.showNotification?.('Voice Commands', 'Voice recognition is not available in this browser.', 'warning');
                return;
            }

            try {
                this.recognition.start();
                this.isListening = true;
                this.updateUI(true);
            } catch (error) {
                console.error('Unable to start voice recognition:', error);
            }
        }

        stopListening() {
            if (this.recognition) {
                this.recognition.stop();
            }
            this.isListening = false;
            this.updateUI(false);
        }

        updateUI(listening) {
            const modal = document.getElementById('voiceModal');
            const button = document.getElementById('voiceControlBtn');

            if (modal) {
                modal.classList.toggle('active', listening);
            }
            if (button) {
                button.classList.toggle('listening', listening);
            }
        }

        updateTranscript(text) {
            const transcriptElement = document.getElementById('voiceTranscript');
            if (transcriptElement) {
                transcriptElement.textContent = text;
            }
        }

        speak(text) {
            if (window.JarvisApp?.speak) {
                window.JarvisApp.speak(text);
                return;
            }

            if (!('speechSynthesis' in window) || !text) {
                return;
            }

            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(utterance);
        }

        onStart() {
            this.updateTranscript('Listening...');
        }

        onResult(event) {
            const transcript = Array.from(event.results)
                .map((result) => result[0].transcript)
                .join('')
                .trim();

            this.updateTranscript(transcript);
            if (event.results[event.results.length - 1].isFinal) {
                this.processCommand(transcript);
            }
        }

        onError(event) {
            const map = {
                'no-speech': 'No speech detected. Please try again.',
                'audio-capture': 'No microphone found.',
                'not-allowed': 'Microphone access denied.',
                network: 'Network error while processing voice.'
            };

            const message = map[event.error] || 'Voice recognition error occurred.';
            this.updateTranscript(message);
            this.speak(message);
            window.setTimeout(() => this.stopListening(), 1500);
        }

        onEnd() {
            this.isListening = false;
            this.updateUI(false);
        }

        processCommand(rawText) {
            const text = this.normalize(rawText);

            for (const command of this.commands) {
                if (command.phrases.some((phrase) => text.includes(phrase))) {
                    Promise.resolve(command.callback?.()).catch((error) => {
                        console.error('Voice command failed:', error);
                    });

                    const reply = typeof command.reply === 'function' ? command.reply() : command.reply;
                    if (reply) {
                        this.updateTranscript(reply);
                        this.speak(reply);
                    }

                    window.setTimeout(() => this.stopListening(), 700);
                    return;
                }
            }

            const message = 'Command not recognized. Say help for available commands.';
            this.updateTranscript(message);
            this.speak(message);
            window.setTimeout(() => this.stopListening(), 1500);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        window.voiceSystem = new VoiceCommandSystem();
    });

    window.closeVoiceModal = function closeVoiceModal() {
        window.voiceSystem?.stopListening();
    };
})();
