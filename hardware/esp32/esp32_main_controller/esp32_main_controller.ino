/*
 * AI-Powered Multi-Layer Physical & Cyber Security System
 * Main ESP32 controller
 *
 * Required libraries:
 * - WiFi
 * - HTTPClient
 * - WiFiClientSecure
 * - ArduinoJson
 * - DHT sensor library
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ---------------------------------------------------------------------------
// User configuration
// ---------------------------------------------------------------------------

const char* WIFI_SSID = "";
const char* WIFI_PASSWORD = "";

// ESP32 sends data to Render API; Render backend persists into TiDB.
const char* API_BASE_URL = "https://security-system-xxve.onrender.com/backend/php/api/";
const char* CAMERA_CAPTURE_URL = "http:///capture";  // Replace with http://<esp32-cam-ip>/capture

const char* TELEGRAM_BOT_TOKEN = "";
const char* TELEGRAM_CHAT_ID = "";

const char* DEVICE_ID = "ESP32-MAIN-01";
const char* DEVICE_LOCATION = "Server Room";
const char* DEVICE_ZONE = "Zone A";

// ---------------------------------------------------------------------------
// Pin mapping
// ---------------------------------------------------------------------------

constexpr uint8_t PIR_SENSOR_PIN = 4;
constexpr uint8_t VIBRATION_SENSOR_PIN = 5;
constexpr uint8_t DHT_PIN = 18;
constexpr uint8_t FIRE_SENSOR_PIN = 19;
constexpr uint8_t DOOR_SENSOR_PIN = 21;

constexpr uint8_t SOLENOID_LOCK_PIN = 22;
constexpr uint8_t SOLENOID_VALVE_PIN = 23;
constexpr uint8_t LED_PIN = 25;
constexpr uint8_t BUZZER_PIN = 26;
constexpr uint8_t RELAY_PIN = 27;
constexpr uint8_t RFID_SS_PIN = 13;
constexpr uint8_t RFID_RST_PIN = 14;
constexpr uint8_t FINGERPRINT_RX_PIN = 16;
constexpr uint8_t FINGERPRINT_TX_PIN = 17;

constexpr float TEMPERATURE_WARNING_THRESHOLD_C = 35.0f;
constexpr float TEMPERATURE_CRITICAL_THRESHOLD_C = 45.0f;
constexpr float TEMPERATURE_THRESHOLD_C = TEMPERATURE_WARNING_THRESHOLD_C;
constexpr unsigned long SENSOR_POLL_INTERVAL_MS = 2000;
constexpr unsigned long BACKEND_PUSH_INTERVAL_MS = 3000;
constexpr unsigned long ACTUATOR_SYNC_INTERVAL_MS = 2500;
constexpr unsigned long OUTPUT_HOLD_MS = 8000;
constexpr unsigned long TELEGRAM_COOLDOWN_MS = 15000;
constexpr unsigned long ACCESS_SESSION_TIMEOUT_MS = 15000;
constexpr uint8_t OUTPUT_ACTIVE_LEVEL = HIGH;
constexpr uint8_t OUTPUT_INACTIVE_LEVEL = LOW;
constexpr uint8_t LOCK_CLOSED_LEVEL = HIGH;
constexpr uint8_t LOCK_OPEN_LEVEL = LOW;
constexpr uint8_t VALVE_OPEN_LEVEL = HIGH;
constexpr uint8_t VALVE_CLOSED_LEVEL = LOW;

#define DHT_TYPE DHT22

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClientSecure secureClient;

struct SensorState {
  bool motion = false;
  bool vibration = false;
  bool fire = false;
  bool doorOpen = false;
  float temperature = NAN;
  float humidity = NAN;
};

struct AlertTracker {
  uint8_t temperatureAlertLevel = 0;
  bool outputsActive = false;
  unsigned long outputsActivatedAt = 0;
  unsigned long lastMotionTelegram = 0;
  unsigned long lastVibrationTelegram = 0;
  unsigned long lastDoorTelegram = 0;
  unsigned long lastFireTelegram = 0;
  unsigned long lastTempWarningTelegram = 0;
  unsigned long lastTempCriticalTelegram = 0;
  unsigned long lastAccessDeniedTelegram = 0;
};

struct AccessControlState {
  String pendingRfidUid = "";
  String pendingUserName = "";
  bool awaitingFingerprint = false;
  unsigned long lastStepAt = 0;
};

SensorState currentState;
SensorState previousState;
AlertTracker alertTracker;
AccessControlState accessControlState;

unsigned long lastSensorPoll = 0;
unsigned long lastBackendPush = 0;
unsigned long lastActuatorSync = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

bool canSendTelegram(unsigned long lastSentAt) {
  return millis() - lastSentAt >= TELEGRAM_COOLDOWN_MS;
}

String apiUrl(const char* endpoint) {
  String base = String(API_BASE_URL);
  while (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }
  return base + "/" + endpoint;
}

void logConfigurationWarnings() {
  const String apiBase = String(API_BASE_URL);
  if (apiBase.indexOf("localhost") >= 0 || apiBase.indexOf("127.0.0.1") >= 0) {
    Serial.println("WARNING: API_BASE_URL uses localhost/127.0.0.1. On ESP32 this points to itself. Use your server LAN IP instead.");
  }
}

bool isStatusOn(String status) {
  status.trim();
  status.toLowerCase();
  return status == "on" || status == "active" || status == "true" || status == "1";
}

String nowMillisString() {
  return String(millis());
}

String trimCopy(String value) {
  value.trim();
  return value;
}

void setOutputs(bool enabled) {
  digitalWrite(LED_PIN, enabled ? OUTPUT_ACTIVE_LEVEL : OUTPUT_INACTIVE_LEVEL);
  digitalWrite(BUZZER_PIN, enabled ? OUTPUT_ACTIVE_LEVEL : OUTPUT_INACTIVE_LEVEL);
  digitalWrite(SOLENOID_LOCK_PIN, enabled ? LOCK_CLOSED_LEVEL : LOCK_OPEN_LEVEL);
  digitalWrite(SOLENOID_VALVE_PIN, enabled ? VALVE_OPEN_LEVEL : VALVE_CLOSED_LEVEL);
  digitalWrite(RELAY_PIN, enabled ? OUTPUT_ACTIVE_LEVEL : OUTPUT_INACTIVE_LEVEL);

  alertTracker.outputsActive = enabled;
  alertTracker.outputsActivatedAt = enabled ? millis() : 0;
}

void resetOutputsIfNeeded() {
  if (alertTracker.outputsActive && (millis() - alertTracker.outputsActivatedAt >= OUTPUT_HOLD_MS)) {
    // Keep outputs latched while active motion/fire is still present.
    if (currentState.motion || currentState.fire) {
      alertTracker.outputsActivatedAt = millis();
      return;
    }
    setOutputs(false);
  }
}

bool postJson(const String& url, const String& body, bool secure = false) {
  HTTPClient http;
  bool started = false;
  const bool useSecure = secure || url.startsWith("https://");

  if (useSecure) {
    secureClient.setInsecure();
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(url);
  }

  if (!started) {
    Serial.println("HTTP begin failed: " + url);
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  String response = http.getString();
  http.end();

  Serial.printf("POST %s -> %d\n", url.c_str(), code);
  if (code <= 0) {
    Serial.println(response);
  }

  return code >= 200 && code < 300;
}

bool postJsonWithResponse(const String& url, const String& body, String& responseBody, int* responseCodeOut = nullptr) {
  HTTPClient http;
  const bool useSecure = url.startsWith("https://");
  bool started = false;

  if (useSecure) {
    secureClient.setInsecure();
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(url);
  }

  if (!started) {
    Serial.println("HTTP begin failed: " + url);
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  responseBody = http.getString();
  http.end();

  Serial.printf("POST %s -> %d\n", url.c_str(), code);
  if (responseCodeOut != nullptr) {
    *responseCodeOut = code;
  }
  return code >= 200 && code < 300;
}

void sendTelegramMessage(const String& message) {
  if (String(TELEGRAM_BOT_TOKEN) == "YOUR_TELEGRAM_BOT_TOKEN" || String(TELEGRAM_CHAT_ID) == "YOUR_TELEGRAM_CHAT_ID") {
    return;
  }

  StaticJsonDocument<384> doc;
  doc["chat_id"] = TELEGRAM_CHAT_ID;
  doc["text"] = message;

  String payload;
  serializeJson(doc, payload);

  postJson("https://api.telegram.org/bot" + String(TELEGRAM_BOT_TOKEN) + "/sendMessage", payload, true);
}

void sendBackendPayload(const char* eventType = nullptr, const char* message = nullptr, const char* severity = nullptr) {
  StaticJsonDocument<768> doc;
  doc["esp32_id"] = DEVICE_ID;
  doc["location"] = DEVICE_LOCATION;
  doc["zone"] = DEVICE_ZONE;

  JsonObject thresholds = doc.createNestedObject("thresholds");
  thresholds["temperature"] = TEMPERATURE_THRESHOLD_C;

  JsonObject readings = doc.createNestedObject("readings");
  readings["motion"] = currentState.motion;
  readings["vibration"] = currentState.vibration ? 1.0f : 0.0f;
  readings["temperature"] = isnan(currentState.temperature) ? 0 : currentState.temperature;
  readings["humidity"] = isnan(currentState.humidity) ? 0 : currentState.humidity;
  readings["fire"] = currentState.fire;
  readings["door"] = currentState.doorOpen;

  if (eventType != nullptr) {
    JsonObject event = doc.createNestedObject("event");
    event["type"] = eventType;
    event["severity"] = severity != nullptr ? severity : "medium";
    event["message"] = message != nullptr ? message : String(eventType) + " triggered";
    event["source"] = DEVICE_ID;
    event["location"] = DEVICE_LOCATION;
  }

  String payload;
  serializeJson(doc, payload);
  postJson(apiUrl("sensors.php"), payload);
}

void syncActuatorsFromBackend() {
  if (WiFi.status() != WL_CONNECTED || alertTracker.outputsActive) {
    return;
  }

  HTTPClient http;
  const String url = apiUrl("control.php") + "?actuators=1";
  const bool useSecure = url.startsWith("https://");
  bool started = false;

  if (useSecure) {
    secureClient.setInsecure();
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(url);
  }

  if (!started) {
    Serial.println("Unable to reach control endpoint for actuator sync");
    return;
  }

  const int code = http.GET();
  const String response = http.getString();
  http.end();

  if (code < 200 || code >= 300) {
    Serial.printf("Actuator sync failed: %d\n", code);
    return;
  }

  StaticJsonDocument<3072> doc;
  const DeserializationError error = deserializeJson(doc, response);
  if (error) {
    Serial.println("Actuator sync JSON parse failed");
    return;
  }

  JsonArray actuators = doc["data"]["actuators"].as<JsonArray>();
  if (actuators.isNull()) {
    return;
  }

  bool lockKnown = false;
  bool lockOn = false;
  bool valveKnown = false;
  bool valveOn = false;

  for (JsonObject actuator : actuators) {
    const String actuatorId = String((const char*)(actuator["actuator_id"] | ""));
    const String type = String((const char*)(actuator["type"] | ""));
    const String status = String((const char*)(actuator["status"] | "off"));
    const bool stateOn = isStatusOn(status);

    if (actuatorId == "LOCK-001" || type == "lock") {
      lockKnown = true;
      lockOn = stateOn;
    }

    if (actuatorId == "VALVE-001" || type == "valve") {
      valveKnown = true;
      valveOn = stateOn;
    }
  }

  if (lockKnown) {
    digitalWrite(SOLENOID_LOCK_PIN, lockOn ? HIGH : LOW);
  }
  if (valveKnown) {
    digitalWrite(SOLENOID_VALVE_PIN, valveOn ? HIGH : LOW);
  }
}

bool triggerCameraCapture() {
  const String captureUrl = String(CAMERA_CAPTURE_URL);
  if (captureUrl.length() < 10 || captureUrl.indexOf("http") != 0 || captureUrl.indexOf("///") >= 0) {
    Serial.println("CAMERA_CAPTURE_URL is invalid. Set it to http://<esp32-cam-ip>/capture");
    return false;
  }

  HTTPClient http;
  const bool useSecure = captureUrl.startsWith("https://");
  bool started = false;

  if (useSecure) {
    secureClient.setInsecure();
    started = http.begin(secureClient, captureUrl);
  } else {
    started = http.begin(captureUrl);
  }

  if (!started) {
    Serial.println("Unable to reach ESP32-CAM capture endpoint");
    return false;
  }

  int code = http.GET();
  Serial.printf("Camera trigger response: %d\n", code);
  http.end();
  return code >= 200 && code < 300;
}

void resetAccessSequence() {
  accessControlState.pendingRfidUid = "";
  accessControlState.pendingUserName = "";
  accessControlState.awaitingFingerprint = false;
  accessControlState.lastStepAt = 0;
}

void expireAccessSequenceIfNeeded() {
  if (!accessControlState.awaitingFingerprint) {
    return;
  }

  if (millis() - accessControlState.lastStepAt >= ACCESS_SESSION_TIMEOUT_MS) {
    Serial.println("Access verification timed out. RFID scan expired.");
    resetAccessSequence();
  }
}

bool sendAccessVerificationRequest(const String& rfidUid, const String& fingerprintId) {
  StaticJsonDocument<384> doc;
  doc["action"] = "verify_access";
  doc["source"] = "ESP32-HARDWARE";
  if (rfidUid.length() > 0) {
    doc["rfid_uid"] = rfidUid;
  }
  if (fingerprintId.length() > 0) {
    doc["fingerprint_id"] = fingerprintId;
  }

  String payload;
  String responseBody;
  serializeJson(doc, payload);

  int responseCode = 0;
  const bool ok = postJsonWithResponse(apiUrl("control.php"), payload, responseBody, &responseCode);

  StaticJsonDocument<1024> responseDoc;
  DeserializationError parseError = deserializeJson(responseDoc, responseBody);
  String responseMessage = "";
  if (!parseError) {
    if (!responseDoc["message"].isNull()) {
      responseMessage = String((const char*) responseDoc["message"]);
    } else if (!responseDoc["error"].isNull()) {
      responseMessage = String((const char*) responseDoc["error"]);
    }
  }

  if (!ok) {
    Serial.println("Access control request failed");
    if (responseCode == 403 || responseCode == 409) {
      setOutputs(true);
      if (canSendTelegram(alertTracker.lastAccessDeniedTelegram)) {
        const String deniedMessage = responseMessage.length() > 0
          ? responseMessage
          : "Unauthorized access attempt detected.";
        sendTelegramMessage("WARNING: Unauthorized access attempt at " + String(DEVICE_LOCATION) + ". " + deniedMessage);
        alertTracker.lastAccessDeniedTelegram = millis();
      }
    }
    return false;
  }

  if (parseError) {
    Serial.println("Access control JSON parse failed");
    return false;
  }

  JsonObject data = responseDoc["data"].as<JsonObject>();
  JsonObject accessControl = data["access_control"].as<JsonObject>();
  accessControlState.awaitingFingerprint = accessControl["awaiting_fingerprint"] | false;
  accessControlState.pendingRfidUid = String((const char*) (accessControl["pending_rfid_uid"] | ""));
  accessControlState.pendingUserName = String((const char*) (accessControl["pending_user"] | ""));
  accessControlState.lastStepAt = millis();

  if (data["door_unlocked"] | false) {
    Serial.println("Access granted by backend. Door unlock command has been issued.");
  } else if (accessControlState.awaitingFingerprint) {
    Serial.println("RFID accepted by backend. Waiting for fingerprint verification.");
  }

  return true;
}

String pollRfidUid() {
  if (!Serial.available()) {
    return "";
  }

  const String line = trimCopy(Serial.readStringUntil('\n'));
  if (!line.startsWith("RFID:")) {
    return "";
  }

  return trimCopy(line.substring(5));
}

String pollFingerprintId() {
  if (!Serial.available()) {
    return "";
  }

  const String line = trimCopy(Serial.readStringUntil('\n'));
  if (!line.startsWith("FINGER:")) {
    return "";
  }

  return trimCopy(line.substring(7));
}

void processAccessControlScans() {
  expireAccessSequenceIfNeeded();

  if (!accessControlState.awaitingFingerprint) {
    const String rfidUid = pollRfidUid();
    if (rfidUid.length() > 0) {
      Serial.println("RFID scan captured: " + rfidUid);
      if (sendAccessVerificationRequest(rfidUid, "")) {
        accessControlState.lastStepAt = millis();
      }
    }
    return;
  }

  const String fingerprintId = pollFingerprintId();
  if (fingerprintId.length() > 0) {
    Serial.println("Fingerprint scan captured: " + fingerprintId);
    if (sendAccessVerificationRequest("", fingerprintId)) {
      if (!accessControlState.awaitingFingerprint) {
        resetAccessSequence();
      }
    } else {
      resetAccessSequence();
    }
  }
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
    delay(300);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed");
  }
}

void readSensors() {
  currentState.motion = digitalRead(PIR_SENSOR_PIN) == HIGH;
  currentState.vibration = digitalRead(VIBRATION_SENSOR_PIN) == HIGH;
  currentState.fire = digitalRead(FIRE_SENSOR_PIN) == LOW;
  currentState.doorOpen = digitalRead(DOOR_SENSOR_PIN) == HIGH;

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (!isnan(temperature)) {
    currentState.temperature = temperature;
  }
  if (!isnan(humidity)) {
    currentState.humidity = humidity;
  }
}

void handleMotionAlert() {
  setOutputs(true);
  sendBackendPayload("motion", "Motion detected. Camera, buzzer, LED, valve and lock activated.", "high");
  const bool captureOk = triggerCameraCapture();
  if (canSendTelegram(alertTracker.lastMotionTelegram)) {
    sendTelegramMessage(
      String("Motion detected at ") + DEVICE_LOCATION +
      (captureOk ? ". ESP32-CAM captured and sent alert image." : ". ESP32-CAM capture request failed.")
    );
    alertTracker.lastMotionTelegram = millis();
  }
}

void handleVibrationAlert() {
  setOutputs(true);
  sendBackendPayload("vibration", "Suspicious vibration detected: possible tampering.", "high");
  if (canSendTelegram(alertTracker.lastVibrationTelegram)) {
    sendTelegramMessage("ALERT: Suspicious vibration detected at " + String(DEVICE_LOCATION) + ". Possible tampering.");
    alertTracker.lastVibrationTelegram = millis();
  }
}

void handleDoorAlert() {
  setOutputs(true);
  sendBackendPayload("door", "Warning: Door opened. Unauthorized access detected.", "high");
  if (canSendTelegram(alertTracker.lastDoorTelegram)) {
    sendTelegramMessage("WARNING: Door opened at " + String(DEVICE_LOCATION) + ". Unauthorized access detected.");
    alertTracker.lastDoorTelegram = millis();
  }
}

void handleFireAlert() {
  setOutputs(true);
  sendBackendPayload("fire", "Fire detected. Emergency alert raised.", "critical");
  if (canSendTelegram(alertTracker.lastFireTelegram)) {
    sendTelegramMessage("EMERGENCY: Fire detected in the room at " + String(DEVICE_LOCATION) + ". Immediate action required.");
    alertTracker.lastFireTelegram = millis();
  }
}

uint8_t resolveTemperatureAlertLevel(float temperatureC) {
  if (isnan(temperatureC) || temperatureC < TEMPERATURE_WARNING_THRESHOLD_C) {
    return 0;
  }
  if (temperatureC > TEMPERATURE_CRITICAL_THRESHOLD_C) {
    return 2;
  }
  return 1;
}

void handleTemperatureAlert(uint8_t level) {
  const bool isCritical = level >= 2;
  setOutputs(true);
  sendBackendPayload(
    "temperature",
    isCritical
      ? "Critical: High temperature detected. Risk of overheating."
      : "Warning: High temperature detected. Temperature rising. Risk of overheating.",
    isCritical ? "critical" : "high"
  );

  if (isCritical) {
    if (canSendTelegram(alertTracker.lastTempCriticalTelegram)) {
      sendTelegramMessage(
        "CRITICAL: High temperature detected at " + String(DEVICE_LOCATION) + " (" + String(currentState.temperature, 1) +
        " C). Risk of overheating."
      );
      alertTracker.lastTempCriticalTelegram = millis();
    }
  } else {
    if (canSendTelegram(alertTracker.lastTempWarningTelegram)) {
      sendTelegramMessage(
        "WARNING: Temperature rising at " + String(DEVICE_LOCATION) + " (" + String(currentState.temperature, 1) +
        " C). Risk of overheating."
      );
      alertTracker.lastTempWarningTelegram = millis();
    }
  }
}

void processStateChanges() {
  if (currentState.motion && !previousState.motion) {
    handleMotionAlert();
  }

  if (currentState.vibration && !previousState.vibration) {
    handleVibrationAlert();
  }

  if (currentState.doorOpen && !previousState.doorOpen) {
    handleDoorAlert();
  }

  if (currentState.fire && !previousState.fire) {
    handleFireAlert();
  }

  const uint8_t currentTempAlertLevel = resolveTemperatureAlertLevel(currentState.temperature);
  if (currentTempAlertLevel > alertTracker.temperatureAlertLevel) {
    handleTemperatureAlert(currentTempAlertLevel);
  }
  alertTracker.temperatureAlertLevel = currentTempAlertLevel;

  previousState = currentState;
}

void setup() {
  Serial.begin(115200);
  logConfigurationWarnings();

  pinMode(PIR_SENSOR_PIN, INPUT);
  pinMode(VIBRATION_SENSOR_PIN, INPUT);
  pinMode(FIRE_SENSOR_PIN, INPUT);
  pinMode(DOOR_SENSOR_PIN, INPUT_PULLUP);

  pinMode(SOLENOID_LOCK_PIN, OUTPUT);
  pinMode(SOLENOID_VALVE_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);

  setOutputs(false);
  dht.begin();

  connectWiFi();

  sendBackendPayload();
  syncActuatorsFromBackend();

  Serial.println("Access control serial test mode ready.");
  Serial.println("Send RFID:<uid> first, then FINGER:<id> to simulate real scans.");
}

void loop() {
  connectWiFi();

  resetOutputsIfNeeded();
  processAccessControlScans();

  if (millis() - lastSensorPoll >= SENSOR_POLL_INTERVAL_MS) {
    lastSensorPoll = millis();
    readSensors();
    processStateChanges();
  }

  if (millis() - lastBackendPush >= BACKEND_PUSH_INTERVAL_MS) {
    lastBackendPush = millis();
    sendBackendPayload();
  }

  if (millis() - lastActuatorSync >= ACTUATOR_SYNC_INTERVAL_MS) {
    lastActuatorSync = millis();
    syncActuatorsFromBackend();
  }
}
