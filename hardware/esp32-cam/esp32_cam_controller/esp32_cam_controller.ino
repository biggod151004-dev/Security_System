/*
 * AI-Powered Multi-Layer Physical & Cyber Security System
 * ESP32-CAM controller
 *
 * Required libraries:
 * - esp32 camera core
 * - WiFi
 * - WebServer
 * - HTTPClient
 * - WiFiClientSecure
 * - ArduinoJson
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "esp_camera.h"

// ---------------------------------------------------------------------------
// User configuration
// ---------------------------------------------------------------------------

const char* WIFI_SSID = "";
const char* WIFI_PASSWORD = "";

const char* TELEGRAM_BOT_TOKEN = "";
const char* TELEGRAM_CHAT_ID = "";

// Use the LAN IP or hostname of the machine running the PHP backend.
// "localhost" points back to the ESP32-CAM itself after flashing.
const char* API_BASE_URL = "http://localhost:8080/Security_System/backend/php/api/";
const char* CAMERA_ID = "CAM-001";
const char* CAMERA_NAME = "ESP32-CAM Main";
const char* CAMERA_LOCATION = "Main Entrance";
const char* CAMERA_ZONE = "Zone A";

constexpr uint8_t FLASH_LED_PIN = 4;
constexpr unsigned long CAPTURE_COOLDOWN_MS = 5000;
constexpr unsigned long STREAM_FRAME_INTERVAL_MS = 150;
constexpr unsigned long STREAM_REQUEST_TIMEOUT_MS = 1500;
constexpr uint16_t STREAM_PORT = 81;

// AI Thinker pin map
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

WebServer server(80);
WiFiServer streamServer(STREAM_PORT);
WiFiClient streamClient;
WiFiClientSecure secureClient;

unsigned long lastCaptureAt = 0;
unsigned long lastStreamFrameAt = 0;
bool flashEnabled = true;

String apiUrl(const char* endpoint) {
  String base = String(API_BASE_URL);
  while (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }
  return base + "/" + endpoint;
}

String localCameraBaseUrl(uint16_t port = 80) {
  String url = "http://" + WiFi.localIP().toString();
  if (port != 80) {
    url += ":" + String(port);
  }
  return url;
}

String getSnapshotUrl() {
  return localCameraBaseUrl() + "/capture?download=1";
}

String getStreamUrl() {
  return localCameraBaseUrl(STREAM_PORT) + "/stream";
}

bool postJson(const String& url, const String& body, bool secure = false) {
  HTTPClient http;
  bool started = false;

  if (secure) {
    secureClient.setInsecure();
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(url);
  }

  if (!started) {
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
    Serial.print("ESP32-CAM IP: ");
    Serial.println(WiFi.localIP());
  }
}

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_SVGA;
  config.jpeg_quality = 12;
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return false;
  }

  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_brightness(sensor, 0);
    sensor->set_saturation(sensor, 0);
    sensor->set_vflip(sensor, 0);
    sensor->set_hmirror(sensor, 0);
  }

  return true;
}

camera_fb_t* captureFrame(bool useFlash, bool trackCaptureTime) {
  if (useFlash) {
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(120);
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (useFlash) {
    digitalWrite(FLASH_LED_PIN, LOW);
  }

  if (fb != nullptr && trackCaptureTime) {
    lastCaptureAt = millis();
  }
  return fb;
}

bool sendPhotoToTelegram(camera_fb_t* fb, const String& caption) {
  if (fb == nullptr) {
    return false;
  }

  if (String(TELEGRAM_BOT_TOKEN) == "YOUR_TELEGRAM_BOT_TOKEN" || String(TELEGRAM_CHAT_ID) == "YOUR_TELEGRAM_CHAT_ID") {
    return true;
  }

  String boundary = "CodexBoundary" + String(millis());
  String head =
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n" + String(TELEGRAM_CHAT_ID) + "\r\n"
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"caption\"\r\n\r\n" + caption + "\r\n"
    "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"photo\"; filename=\"capture.jpg\"\r\n"
    "Content-Type: image/jpeg\r\n\r\n";
  String tail = "\r\n--" + boundary + "--\r\n";

  WiFiClientSecure client;
  client.setInsecure();

  if (!client.connect("api.telegram.org", 443)) {
    return false;
  }

  const size_t contentLength = head.length() + fb->len + tail.length();
  client.println("POST /bot" + String(TELEGRAM_BOT_TOKEN) + "/sendPhoto HTTP/1.1");
  client.println("Host: api.telegram.org");
  client.println("Content-Type: multipart/form-data; boundary=" + boundary);
  client.println("Content-Length: " + String(contentLength));
  client.println("Connection: close");
  client.println();
  client.print(head);
  client.write(fb->buf, fb->len);
  client.print(tail);

  unsigned long timeout = millis();
  while (client.connected() && millis() - timeout < 8000) {
    if (client.available()) {
      String response = client.readString();
      return response.indexOf("\"ok\":true") >= 0;
    }
    delay(10);
  }

  return false;
}

void registerCamera() {
  StaticJsonDocument<512> doc;
  doc["action"] = "register";
  doc["camera_id"] = CAMERA_ID;
  doc["name"] = CAMERA_NAME;
  doc["location"] = CAMERA_LOCATION;
  doc["zone"] = CAMERA_ZONE;
  doc["status"] = "recording";
  doc["resolution"] = "800x600";
  doc["ip_address"] = WiFi.localIP().toString();
  doc["port"] = 80;
  doc["stream_url"] = getStreamUrl();
  doc["snapshot_url"] = getSnapshotUrl();

  String payload;
  serializeJson(doc, payload);
  postJson(apiUrl("cameras.php"), payload);
}

void updateCameraStatus(const char* status, bool includeSnapshotTimestamp) {
  StaticJsonDocument<512> doc;
  doc["action"] = "update_status";
  doc["camera_id"] = CAMERA_ID;
  doc["status"] = status;
  doc["ip_address"] = WiFi.localIP().toString();
  doc["resolution"] = "800x600";
  doc["stream_url"] = getStreamUrl();
  doc["snapshot_url"] = getSnapshotUrl();

  if (includeSnapshotTimestamp) {
    doc["captured_at"] = millis();
  }

  String payload;
  serializeJson(doc, payload);
  postJson(apiUrl("cameras.php"), payload);
}

void handleStatus() {
  StaticJsonDocument<256> doc;
  doc["camera_id"] = CAMERA_ID;
  doc["name"] = CAMERA_NAME;
  doc["status"] = "recording";
  doc["ip_address"] = WiFi.localIP().toString();
  doc["stream_url"] = getStreamUrl();
  doc["snapshot_url"] = getSnapshotUrl();
  doc["last_capture_ms"] = lastCaptureAt;

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void handleCapture() {
  bool download = server.hasArg("download") && server.arg("download") == "1";

  if (!download && lastCaptureAt != 0 && millis() - lastCaptureAt < CAPTURE_COOLDOWN_MS) {
    server.send(429, "application/json", "{\"success\":false,\"error\":\"Capture cooldown active\"}");
    return;
  }

  camera_fb_t* fb = captureFrame(!download && flashEnabled, !download);
  if (fb == nullptr) {
    server.send(500, "application/json", "{\"success\":false,\"error\":\"Camera capture failed\"}");
    return;
  }

  if (download) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    server.setContentLength(fb->len);
    server.send(200, "image/jpeg", "");
    WiFiClient client = server.client();
    client.write(fb->buf, fb->len);
    esp_camera_fb_return(fb);
    return;
  }

  String caption = "Security alert image from " + String(CAMERA_LOCATION);
  bool telegramOk = sendPhotoToTelegram(fb, caption);
  esp_camera_fb_return(fb);
  updateCameraStatus("recording", true);

  StaticJsonDocument<256> doc;
  doc["success"] = true;
  doc["telegram_sent"] = telegramOk;
  doc["camera_id"] = CAMERA_ID;
  doc["captured_at_ms"] = lastCaptureAt;

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

void handleRoot() {
  server.send(200, "text/plain", "ESP32-CAM online. Use /status, /capture, /settings, or http://<ip>:81/stream");
}

void handleSettings() {
  if (server.hasArg("flash")) {
    flashEnabled = (server.arg("flash") == "1" || server.arg("flash") == "true");
  }

  if (server.hasArg("resolution")) {
    String res = server.arg("resolution");
    sensor_t *s = esp_camera_sensor_get();
    if (s != nullptr) {
      if (res == "UXGA") s->set_framesize(s, FRAMESIZE_UXGA);
      else if (res == "SXGA") s->set_framesize(s, FRAMESIZE_SXGA);
      else if (res == "XGA") s->set_framesize(s, FRAMESIZE_XGA);
      else if (res == "SVGA") s->set_framesize(s, FRAMESIZE_SVGA);
      else if (res == "VGA") s->set_framesize(s, FRAMESIZE_VGA);
      else if (res == "CIF") s->set_framesize(s, FRAMESIZE_CIF);
      else if (res == "QVGA") s->set_framesize(s, FRAMESIZE_QVGA);
    }
  }

  StaticJsonDocument<256> doc;
  doc["success"] = true;
  doc["flash"] = flashEnabled;
  doc["resolution"] = server.hasArg("resolution") ? server.arg("resolution") : "current";
  
  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

bool readStreamRequest(WiFiClient& client, String& requestLine) {
  unsigned long started = millis();
  while (client.connected() && millis() - started < STREAM_REQUEST_TIMEOUT_MS) {
    while (client.available()) {
      String line = client.readStringUntil('\n');
      line.trim();

      if (requestLine.length() == 0) {
        requestLine = line;
      }

      if (line.length() == 0) {
        return true;
      }
    }
    delay(1);
  }
  return false;
}

bool startStreamSession(WiFiClient& client) {
  String requestLine;
  if (!readStreamRequest(client, requestLine)) {
    return false;
  }

  if (!requestLine.startsWith("GET /stream")) {
    client.print("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    return false;
  }

  client.print("HTTP/1.1 200 OK\r\n");
  client.print("Access-Control-Allow-Origin: *\r\n");
  client.print("Cache-Control: no-cache, no-store, must-revalidate\r\n");
  client.print("Pragma: no-cache\r\n");
  client.print("Connection: close\r\n");
  client.print("Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n");
  return true;
}

void stopStreamSession() {
  if (streamClient) {
    streamClient.stop();
  }
  lastStreamFrameAt = 0;
}

void handleStreamServer() {
  if (!streamClient || !streamClient.connected()) {
    if (streamClient) {
      streamClient.stop();
    }

    WiFiClient candidate = streamServer.available();
    if (!candidate) {
      return;
    }

    if (startStreamSession(candidate)) {
      streamClient = candidate;
      lastStreamFrameAt = 0;
    } else {
      candidate.stop();
    }
    return;
  }

  if (millis() - lastStreamFrameAt < STREAM_FRAME_INTERVAL_MS) {
    return;
  }

  camera_fb_t* fb = captureFrame(false, false);
  if (fb == nullptr) {
    delay(30);
    return;
  }

  const size_t frameLength = fb->len;
  streamClient.print("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + String(frameLength) + "\r\n\r\n");
  size_t written = streamClient.write(fb->buf, frameLength);
  streamClient.print("\r\n");
  esp_camera_fb_return(fb);

  lastStreamFrameAt = millis();

  if (written != frameLength || !streamClient.connected()) {
    stopStreamSession();
  }
}

void setupServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/capture", HTTP_GET, handleCapture);
  server.on("/settings", HTTP_GET, handleSettings);
  server.begin();
  streamServer.begin();
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  connectWiFi();
  initCamera();
  setupServer();
  registerCamera();
}

void loop() {
  connectWiFi();
  server.handleClient();
  handleStreamServer();
}
