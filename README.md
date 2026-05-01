# JARVIS AI-Powered Multi-Layer Physical & Cyber Security System

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-ESP32-orange)

## Overview

A comprehensive security system combining physical sensors, cyber threat detection, AI-powered monitoring, and blockchain-based log integrity. Inspired by the JARVIS interface from Iron Man.

## Features

### Hardware Integration
- **PIR Motion Sensor** - Real-time motion detection
- **Vibration Sensor** - Perimeter security
- **Temperature/Humidity Sensor** - Environmental monitoring
- **Fire/Flame Sensor** - Early fire detection
- **Door/Window Sensors** - Access monitoring
- **Solenoid Door Lock** - Automated locking
- **Solenoid Valve** - Water/gas control
- **ESP32-CAM** - Image capture and streaming

### Software Features
- **JARVIS-style Dashboard** - Futuristic UI design
- **Real-time Updates** - Live sensor data display
- **Voice Commands** - Control via speech
- **Chat Interface** - AI assistant integration
- **Admin Authentication** - Secure login system
- **Telegram Alerts** - Instant notifications
- **Blockchain Logging** - Tamper-proof records

## Project Structure

```
jarvis-security-system/
├── hardware/                 # ESP32 Arduino code
│   ├── esp32/               # Main controller
│   └── esp32-cam/           # Camera module
├── backend/                  # PHP backend
│   └── php/
│       ├── config/          # Configuration
│       └── api/             # REST API endpoints
├── database/                 # MySQL schema
├── frontend/                 # Web dashboard
│   ├── css/                 # Styles
│   ├── js/                  # JavaScript
│   └── pages/               # HTML pages
├── blockchain/               # Blockchain storage
├── docs/                     # Documentation
└── logs/                     # System logs
```

## Quick Start

### Prerequisites
- XAMPP/WAMP/LAMP server
- Arduino IDE with ESP32 support
- ESP32 and ESP32-CAM boards
- Various sensors and actuators

### Installation

1. **Clone or download** the project
2. **Import database** from `database/Security.sql`
3. **Copy to web server** (htdocs or www folder)
4. **Configure** `backend/php/config/config.php`
5. **Program ESP32** with the code from `hardware/`
6. **Access dashboard** at `http://localhost/jarvis-security-system/frontend/`

### Default Login
- **Username**: admin
- **Password**: admin123

## Dashboard Pages

| Page | Description |
|------|-------------|
| Dashboard | Main overview with system stats |
| Sensors | Real-time sensor monitoring |
| Threats | Active threat detection |
| Logs | System event history |
| Blockchain | Log integrity verification |
| Camera | Live video feed |
| Control | Actuator control panel |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sensors.php` | GET/POST | Sensor data operations |
| `/api/logs.php` | GET/POST | Log management |
| `/api/blockchain.php` | GET/POST | Blockchain operations |
| `/api/auth.php` | POST | Authentication |
| `/api/threats.php` | GET/POST | Threat management |
| `/api/control.php` | GET/POST | System control |
| `/api/cameras.php` | GET/POST | Camera operations |

## Hardware Wiring

### ESP32 Main Controller
```
PIR Sensor       → GPIO 4
Vibration Sensor → GPIO 5
DHT22            → GPIO 18
Fire Sensor      → GPIO 19
Door Sensor      → GPIO 21
Solenoid Lock    → GPIO 22 (via Relay)
Solenoid Valve   → GPIO 23 (via Relay)
LED              → GPIO 25
Buzzer           → GPIO 26
Relay Module     → GPIO 27
```

## Telegram Bot Setup

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Get your bot token and chat ID
3. Update the configuration in:
   - `backend/php/config/config.php`
   - `hardware/esp32/esp32_main_controller.ino`

## Security Features

- **AES-256 Encryption** - Data protection
- **Blockchain Integrity** - Tamper-proof logs
- **Role-based Access** - Admin, Operator, Viewer
- **Session Management** - Secure authentication
- **Rate Limiting** - API protection

## Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: PHP 8.0+
- **Database**: MySQL 8.0+
- **Hardware**: ESP32, ESP32-CAM
- **Protocols**: MQTT, HTTP, WebSocket
- **APIs**: Telegram Bot API

## Documentation

See [SETUP-GUIDE.md](docs/SETUP-GUIDE.md) for detailed installation instructions.

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Author

JARVIS Security System Team

---

**Note**: This is an educational project. For production use, ensure proper security measures are implemented.
