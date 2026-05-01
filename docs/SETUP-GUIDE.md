# JARVIS AI-Powered Multi-Layer Physical & Cyber Security System

## Complete Setup and Installation Guide

---

## Table of Contents

1. [System Requirements](#1-system-requirements)
2. [Hardware Components List](#2-hardware-components-list)
3. [Hardware Setup](#3-hardware-setup)
4. [Software Installation](#4-software-installation)
5. [ESP32 Programming](#5-esp32-programming)
6. [Database Setup](#6-database-setup)
7. [Backend Configuration](#7-backend-configuration)
8. [Dashboard Configuration](#8-dashboard-configuration)
9. [Telegram Bot Setup](#9-telegram-bot-setup)
10. [Real-time Data Integration](#10-real-time-data-integration)
11. [Blockchain Log Storage](#11-blockchain-log-storage)
12. [Testing & Troubleshooting](#12-testing--troubleshooting)

---

## 1. System Requirements

### Software Requirements
- **Operating System**: Windows 10/11, macOS 10.15+, or Linux (Ubuntu 20.04+)
- **Web Server**: Apache 2.4+ or Nginx 1.18+
- **PHP**: Version 8.0 or higher
- **MySQL**: Version 8.0 or MariaDB 10.5+
- **Node.js**: Version 18+ (optional, for WebSocket server)
- **Arduino IDE**: Version 2.0+ (for ESP32 programming)

### Hardware Requirements
- Computer with minimum 4GB RAM
- ESP32 Development Board
- ESP32-CAM Module
- Various sensors and actuators (see detailed list below)
- Stable WiFi connection

---

## 2. Hardware Components List

### Sensors
| Component | Quantity | Purpose | Approximate Cost |
|-----------|----------|---------|------------------|
| PIR Sensor (HC-SR501) | 2 | Motion Detection | $3-5 each |
| Vibration Sensor (SW-420) | 2 | Vibration/Movement Detection | $2-3 each |
| DHT22 Temperature Sensor | 1 | Temperature & Humidity | $5-7 |
| Fire Sensor (Flame Sensor) | 2 | Fire/Flame Detection | $2-3 each |
| Magnetic Door Sensor (Reed Switch) | 2 | Door/Window Status | $1-2 each |

### Actuators
| Component | Quantity | Purpose | Approximate Cost |
|-----------|----------|---------|------------------|
| Solenoid Door Lock | 1 | Electronic Door Locking | $10-15 |
| Solenoid Valve | 1 | Water/Gas Control | $8-12 |
| 5V Relay Module (4-channel) | 1 | Control High Voltage Devices | $5-8 |
| Active Buzzer | 1 | Audio Alert | $1-2 |
| LED Pack (RGB) | 1 | Status Indication | $2-3 |

### Controllers
| Component | Quantity | Purpose | Approximate Cost |
|-----------|----------|---------|------------------|
| ESP32 DevKit V1 | 1 | Main Controller | $8-12 |
| ESP32-CAM | 1 | Camera Module | $10-15 |
| FTDI Programmer | 1 | Programming ESP32-CAM | $3-5 |
| Breadboard & Jumper Wires | 1 set | Prototyping | $5-10 |
| 5V 3A Power Supply | 2 | Power for Components | $5 each |

---

## 3. Hardware Setup

### 3.1 ESP32 Main Controller Wiring

```
ESP32 PIN CONNECTIONS
=====================

SENSORS:
--------
PIR Sensor (Motion)        → GPIO 4
Vibration Sensor           → GPIO 5
DHT22 Temperature Sensor   → GPIO 18
Fire/Flame Sensor          → GPIO 19
Door Sensor (Reed Switch)  → GPIO 21

ACTUATORS:
----------
Solenoid Door Lock         → GPIO 22 (via Relay)
Solenoid Valve             → GPIO 23 (via Relay)
LED Status                 → GPIO 25
Buzzer                     → GPIO 26
Relay Module               → GPIO 27

RGB LED (Status):
-----------------
Red Pin                    → GPIO 32
Green Pin                  → GPIO 33
Blue Pin                   → GPIO 34

POWER:
------
3.3V  → Sensors (PIR, DHT22, Fire, Vibration)
5V    → Relay Module, Solenoids (external power recommended)
GND   → Common Ground for all components
```

### 3.2 ESP32-CAM Wiring

```
ESP32-CAM CONNECTIONS
=====================

The ESP32-CAM has built-in connections:
- Camera Module: Connected internally
- Flash LED: GPIO 4
- SD Card: Various GPIOs (handled by library)

For Programming:
----------------
GPIO 0 → GND (for programming mode)
U0T   → RX of FTDI
U0R   → TX of FTDI
GND   → GND of FTDI
5V    → 5V of FTDI
```

### 3.3 Power Considerations

⚠️ **IMPORTANT**: 
- Solenoids require high current. Use external 5V power supply with relay isolation.
- Do NOT power solenoids directly from ESP32 GPIO pins.
- Use flyback diodes across inductive loads (solenoids, relays).

### 3.4 Circuit Diagram (Text Representation)

```
                    ┌─────────────────────────────────────────┐
                    │              ESP32 DEVKIT               │
                    │                                         │
     PIR Sensor ────┤ GPIO 4                   GPIO 22 ├────┤ Relay 1 (Door Lock)
                    │                                         │
 Vibration Sen ────┤ GPIO 5                   GPIO 23 ├────┤ Relay 2 (Valve)
                    │                                         │
   DHT22 Data ─────┤ GPIO 18                  GPIO 25 ├────┤ LED
                    │                                         │
  Fire Sensor ─────┤ GPIO 19                  GPIO 26 ├────┤ Buzzer
                    │                                         │
  Door Sensor ─────┤ GPIO 21                  GPIO 27 ├────┤ Relay 3 (Extra)
                    │                                         │
    RGB Red   ─────┤ GPIO 32                        3.3V ├───┤ Sensor Power
                    │                                         │
   RGB Green  ─────┤ GPIO 33                         5V  ├───┤ Actuator Power
                    │                                         │
    RGB Blue  ─────┤ GPIO 34                         GND ├───┤ Common Ground
                    │                                         │
                    └─────────────────────────────────────────┘
```

---

## 4. Software Installation

### 4.1 Install XAMPP (Windows) or LAMP (Linux)

#### Windows (XAMPP):
1. Download XAMPP from https://www.apachefriends.org/
2. Run the installer and select Apache, MySQL, PHP
3. Install to `C:\xampp`
4. Start Apache and MySQL from XAMPP Control Panel

#### Linux (Ubuntu):
```bash
sudo apt update
sudo apt install apache2 mysql-server php8.0 php8.0-mysql php8.0-curl php8.0-json
sudo systemctl start apache2
sudo systemctl start mysql
```

### 4.2 Install Arduino IDE

1. Download Arduino IDE from https://www.arduino.cc/en/software
2. Install the software
3. Open Arduino IDE

### 4.3 Configure Arduino IDE for ESP32

1. Open Arduino IDE
2. Go to **File → Preferences**
3. In "Additional Boards Manager URLs", add:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
4. Go to **Tools → Board → Boards Manager**
5. Search for "esp32" and install "ESP32 by Espressif Systems"

### 4.4 Install Required Arduino Libraries

In Arduino IDE, go to **Sketch → Include Library → Manage Libraries** and install:

- **PubSubClient** by Nick O'Leary (MQTT)
- **ArduinoJson** by Benoit Blanchon
- **DHT sensor library** by Adafruit
- **Adafruit Unified Sensor** by Adafruit

For ESP32-CAM, the camera library is included with ESP32 board package.

---

## 5. ESP32 Programming

### 5.1 Program the Main ESP32 Controller

1. Connect ESP32 to computer via USB
2. Open Arduino IDE
3. Open the file: `hardware/esp32/esp32_main_controller.ino`
4. Configure settings:
   ```cpp
   const char* WIFI_SSID = "YOUR_WIFI_SSID";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   const char* MQTT_SERVER = "192.168.1.100";  // Your server IP
   const char* TELEGRAM_BOT_TOKEN = "YOUR_BOT_TOKEN";
   const char* TELEGRAM_CHAT_ID = "YOUR_CHAT_ID";
   ```

5. Select board:
   - **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
   
6. Select port:
   - **Tools → Port → COMX** (Windows) or **/dev/ttyUSB0** (Linux)
   
7. Click **Upload** button

### 5.2 Program ESP32-CAM

⚠️ **Note**: ESP32-CAM requires an FTDI programmer.

1. Connect FTDI to ESP32-CAM:
   ```
   FTDI RX → ESP32-CAM TX
   FTDI TX → ESP32-CAM RX
   FTDI GND → ESP32-CAM GND
   FTDI 5V → ESP32-CAM 5V
   ```
   
2. Connect GPIO 0 to GND (programming mode)

3. Open Arduino IDE with `hardware/esp32-cam/esp32_cam_controller.ino`

4. Configure WiFi and Telegram settings

5. Select board:
   - **Tools → Board → ESP32 Arduino → AI Thinker ESP32-CAM**
   
6. Click Upload, then press the RST button on ESP32-CAM

7. After upload, disconnect GPIO 0 from GND and press RST

---

## 6. Database Setup

### 6.1 Create Database

1. Open phpMyAdmin (http://localhost/phpmyadmin)
2. Go to **SQL** tab
3. Execute the contents of `database/Security.sql`

Or via command line:
```bash
mysql -u root -p < database/Security.sql
```

### 6.2 Create Database User (Recommended)

```sql
CREATE USER 'jarvis_user'@'localhost' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON jarvis_security.* TO 'jarvis_user'@'localhost';
FLUSH PRIVILEGES;
```

### 6.3 Update Database Configuration

Edit `backend/php/config/database.php`:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'jarvis_security');
define('DB_USER', 'jarvis_user');
define('DB_PASS', 'secure_password');
```

---

## 7. Backend Configuration

### 7.1 Copy Files to Web Server

#### Windows (XAMPP):
```cmd
xcopy /E /I jarvis-security-system C:\xampp\htdocs\jarvis-security-system
```

#### Linux:
```bash
sudo cp -r jarvis-security-system /var/www/html/
sudo chown -R www-data:www-data /var/www/html/jarvis-security-system
```

### 7.2 Configure API Settings

Edit `backend/php/config/config.php`:

```php
// Application Settings
define('APP_URL', 'http://localhost/jarvis-security-system');

// Telegram Settings
define('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN');
define('TELEGRAM_CHAT_ID', 'YOUR_TELEGRAM_CHAT_ID');
define('TELEGRAM_ENABLED', true);

// Threshold Settings
define('TEMPERATURE_THRESHOLD', 35.0);
define('HUMIDITY_THRESHOLD', 70.0);
define('VIBRATION_THRESHOLD', 0.5);

// Blockchain Settings
define('BLOCKCHAIN_ENABLED', true);
define('BLOCKCHAIN_DIFFICULTY', 4);
```

### 7.3 Set File Permissions (Linux)

```bash
sudo chmod -R 755 /var/www/html/jarvis-security-system
sudo chmod -R 777 /var/www/html/jarvis-security-system/logs
```

---

## 8. Dashboard Configuration

### 8.1 Access Dashboard

Open your browser and navigate to:
```
http://localhost/jarvis-security-system/frontend/index.html
```

Or if deployed to production:
```
http://your-server-ip/jarvis-security-system/frontend/index.html
```

### 8.2 Default Login Credentials

- **Username**: admin
- **Password**: admin123

⚠️ **IMPORTANT**: Change the default password immediately after first login!

### 8.3 Dashboard Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | index.html | Main overview with stats |
| Sensors | pages/sensors.html | Sensor management |
| Threats | pages/threats.html | Threat detection |
| Logs | pages/logs.html | System logs |
| Blockchain | pages/blockchain.html | Blockchain records |
| Camera | pages/camera.html | Live camera feed |
| Control | pages/control.html | Actuator control panel |
| Login | pages/login.html | Admin authentication |

---

## 9. Telegram Bot Setup

### 9.1 Create Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send the command: `/newbot`
3. Follow the prompts:
   - Enter a name for your bot (e.g., "JARVIS Security Bot")
   - Enter a username ending in 'bot' (e.g., "jarvis_security_bot")
4. BotFather will provide you with a **BOT TOKEN** - save this!

### 9.2 Get Your Chat ID

1. Start a conversation with your new bot
2. Send any message to it
3. Open this URL in your browser:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
4. Look for `"chat":{"id":XXXXXXXXX}` - this is your **CHAT ID**

### 9.3 Configure Bot in ESP32 and PHP

Update both the ESP32 code and PHP config with your bot token and chat ID:

```cpp
const char* TELEGRAM_BOT_TOKEN = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz";
const char* TELEGRAM_CHAT_ID = "123456789";
```

---

## 10. Real-time Data Integration

### 10.1 Option 1: REST API Polling (Default)

The dashboard automatically polls the API every 2-3 seconds. No additional setup required.

### 10.2 Option 2: WebSocket Server (Advanced)

For true real-time updates, set up a WebSocket server:

1. Install Node.js dependencies:
   ```bash
   cd jarvis-security-system
   npm install ws express
   ```

2. Create WebSocket server (`websocket-server.js`):
   ```javascript
   const WebSocket = require('ws');
   const wss = new WebSocket.Server({ port: 8080 });
   
   wss.on('connection', (ws) => {
       console.log('Client connected');
       
       ws.on('message', (message) => {
           // Handle incoming messages
       });
   });
   
   console.log('WebSocket server running on port 8080');
   ```

3. Run the server:
   ```bash
   node websocket-server.js
   ```

4. Update frontend configuration:
   ```javascript
   const RTConfig = {
       websocketEnabled: true,
       websocketUrl: 'ws://localhost:8080'
   };
   ```

---

## 11. Blockchain Log Storage

### 11.1 How It Works

The system uses a simplified blockchain implementation for log integrity:

1. Each log entry is stored as a "block"
2. Each block contains:
   - Block number
   - Previous block's hash
   - Current block's hash (calculated from data)
   - Data hash
   - Nonce (for proof of work)

### 11.2 Verify Blockchain Integrity

Access the blockchain verification endpoint:
```
GET /backend/php/api/blockchain.php?verify
```

### 11.3 View Blockchain

Navigate to **Blockchain** page in the dashboard to see:
- Total blocks
- Recent blocks
- Verification status

---

## 12. Testing & Troubleshooting

### 12.1 Test ESP32 Connection

1. Open Serial Monitor in Arduino IDE (115200 baud)
2. Watch for connection messages
3. Check for WiFi and MQTT connection success

### 12.2 Test Sensor Readings

1. Wave hand in front of PIR sensor
2. Check Serial Monitor for "Motion detected" message
3. Verify alert appears in dashboard and Telegram

### 12.3 Test API Endpoints

Use Postman or curl to test API:

```bash
# Get all sensors
curl http://localhost/jarvis-security-system/backend/php/api/sensors.php

# Get logs
curl http://localhost/jarvis-security-system/backend/php/api/logs.php?limit=10

# Test authentication
curl -X POST http://localhost/jarvis-security-system/backend/php/api/auth.php \
  -H "Content-Type: application/json" \
  -d '{"action":"login","username":"admin","password":"admin123"}'
```

### 12.4 Common Issues

| Issue | Solution |
|-------|----------|
| ESP32 won't connect to WiFi | Check SSID/password, ensure 2.4GHz network |
| No data in dashboard | Check API URL, verify database connection |
| Telegram alerts not working | Verify bot token and chat ID |
| Camera not streaming | Check ESP32-CAM power (min 5V 2A) |
| Blockchain verification failed | Check database integrity, may need reset |

### 12.5 Debug Mode

Enable debug mode in `config.php`:
```php
define('APP_DEBUG', true);
define('LOG_LEVEL', 'DEBUG');
```

Check logs in `logs/` directory.

---

## Project Structure

```
jarvis-security-system/
├── hardware/
│   ├── esp32/
│   │   └── esp32_main_controller.ino
│   └── esp32-cam/
│       └── esp32_cam_controller.ino
├── backend/
│   └── php/
│       ├── config/
│       │   ├── config.php
│       │   └── database.php
│       └── api/
│           ├── sensors.php
│           ├── logs.php
│           ├── blockchain.php
│           ├── auth.php
│           ├── threats.php
│           ├── control.php
│           └── cameras.php
├── database/
│   └── Security.sql
├── frontend/
│   ├── index.html
│   ├── css/
│   │   ├── styles.css
│   │   └── animations.css
│   ├── js/
│   │   ├── app.js
│   │   ├── jarvis.js
│   │   ├── voice.js
│   │   └── realtime.js
│   └── pages/
│       ├── sensors.html
│       ├── threats.html
│       ├── logs.html
│       ├── blockchain.html
│       ├── camera.html
│       ├── control.html
│       └── login.html
├── blockchain/
│   └── (blockchain logs stored here)
├── docs/
│   └── SETUP-GUIDE.md
└── logs/
    └── (system logs stored here)
```

---

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review the logs in the `logs/` directory
3. Ensure all configuration settings are correct

---

**JARVIS Security System v1.0.0**
*AI-Powered Multi-Layer Physical & Cyber Security System*
