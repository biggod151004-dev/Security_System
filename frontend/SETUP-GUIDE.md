# JARVIS Security System Setup Guide

## Architecture

- `ESP32 main controller` reads PIR, vibration, temperature, fire and door sensors.
- `ESP32-CAM` exposes `/capture` and sends alert photos to Telegram.
- `PHP backend` stores sensor readings, logs, alerts, threats and blockchain blocks.
- `Frontend dashboard` polls the PHP API every 3 seconds for live status.

## 1. Database setup

1. Create a MySQL database named `jarvis_security`.
2. Import [Security.sql](/D:/Security_System/database/Security.sql).
3. Update DB host, port, user and password in [database.php](/D:/Security_System/backend/php/config/database.php).

## 2. Backend setup

1. Copy the project into your PHP server root.
2. Confirm these folders are writable:
   - [logs](/D:/Security_System/logs)
3. Update [config.php](/D:/Security_System/backend/php/config/config.php):
   - `APP_URL`
   - `APP_TIMEZONE`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `TELEGRAM_ENABLED`

## 3. ESP32 main controller setup

Edit [esp32_main_controller.ino](/D:/Security_System/hardware/esp32/esp32_main_controller/esp32_main_controller.ino):

- Set `WIFI_SSID` and `WIFI_PASSWORD`
- Set `API_BASE_URL` to your server LAN URL (not `localhost` from the ESP32)
- Set `CAMERA_CAPTURE_URL`
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

Pin mapping used by the sketch:

- PIR: GPIO 4
- Vibration: GPIO 5
- DHT22: GPIO 18
- Fire: GPIO 19
- Door: GPIO 21
- Lock relay: GPIO 22
- Valve relay: GPIO 23
- LED: GPIO 25
- Buzzer: GPIO 26
- Relay: GPIO 27

## 4. ESP32-CAM setup

Edit [esp32_cam_controller.ino](/D:/Security_System/hardware/esp32-cam/esp32_cam_controller/esp32_cam_controller.ino):

- Set Wi-Fi credentials
- Set Telegram token and chat ID
- Set `API_BASE_URL`
- Keep `CAMERA_ID = "CAM-001"` unless you also update the DB

This sketch:

- Registers the camera in the backend
- Exposes `http://<esp32-cam-ip>/status`
- Exposes `http://<esp32-cam-ip>/capture`
- Exposes `http://<esp32-cam-ip>/capture?download=1` for dashboard snapshot preview

## 5. Telegram bot setup

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather).
2. Create a bot and copy the token.
3. Send a message to your bot.
4. Visit:
   - `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
5. Copy your `chat.id`.
6. Put the token and chat ID into:
   - [config.php](/D:/Security_System/backend/php/config/config.php)
   - [esp32_main_controller.ino](/D:/Security_System/hardware/esp32/esp32_main_controller/esp32_main_controller.ino)
   - [esp32_cam_controller.ino](/D:/Security_System/hardware/esp32-cam/esp32_cam_controller/esp32_cam_controller.ino)

## 6. Dashboard behavior

The dashboard uses:

- [app.js](/D:/Security_System/frontend/js/app.js) for control actions
- [realtime.js](/D:/Security_System/frontend/js/realtime.js) for live polling
- [camera.html](/D:/Security_System/frontend/pages/camera.html) for camera control and preview

Live data now comes from the backend instead of placeholder-only demo content.

## 7. Event flow

When motion is detected:

1. ESP32 turns on LED, buzzer, valve, lock and relay.
2. ESP32 pushes the event to `sensors.php`.
3. Backend stores logs, alert, threat and blockchain block.
4. ESP32 requests `ESP32-CAM /capture`.
5. ESP32-CAM sends the photo to Telegram.
6. Dashboard updates on the next polling cycle.

## 8. Recommended test order

1. Import the database.
2. Open the frontend dashboard.
3. Flash the ESP32-CAM and verify `/status`.
4. Flash the main ESP32 and watch `sensors`, `logs`, `threats` and `blockchain`.
5. Trigger PIR and confirm:
   - Telegram text arrives
   - Telegram photo arrives
   - Dashboard updates

## 9. Important note

The backend is still HTTP-based and polling-based. For production, move secrets into environment variables, secure the APIs, and place relays behind proper driver circuits and power isolation.
