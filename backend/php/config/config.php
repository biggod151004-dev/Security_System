<?php
/**
 * JARVIS Security System - Main Configuration
 */

declare(strict_types=1);

if (!defined('JARVIS_SECURE')) {
    define('JARVIS_SECURE', true);
}

define('APP_NAME', 'JARVIS Security System');
define('APP_VERSION', '1.0.1');
define('APP_DEBUG', true);
define('APP_URL','http://localhost:8080/Security_System');
define('APP_TIMEZONE', 'Asia/Kolkata');

date_default_timezone_set(APP_TIMEZONE);

define('HASH_ALGO', 'sha256');
define('SESSION_NAME', 'JARVIS_SESSION');
define('SESSION_LIFETIME', 86400);
define('MAX_LOGIN_ATTEMPTS', 5);
define('LOCKOUT_DURATION', 900);
define('PASSWORD_MIN_LENGTH', 8);

define('API_KEY_LENGTH', 32);
define('API_RATE_LIMIT', 100);
define('API_RATE_WINDOW', 60);

define('MQTT_HOST', 'localhost');
define('MQTT_PORT', 1883);
define('MQTT_USER', '');
define('MQTT_PASS', '');
define('MQTT_CLIENT_ID', 'JARVIS_PHP');

define('TELEGRAM_BOT_TOKEN', '');
define('TELEGRAM_CHAT_ID', '');
define('TELEGRAM_ENABLED', true);

define('BLOCKCHAIN_ENABLED', true);
define('BLOCKCHAIN_DIFFICULTY', 4);

define('TEMPERATURE_THRESHOLD', 35.0);
define('HUMIDITY_THRESHOLD', 70.0);
define('VIBRATION_THRESHOLD', 0.5);

define('CORS_ALLOWED_ORIGINS', '*');
define('CORS_ALLOWED_METHODS', 'GET, POST, PUT, DELETE, OPTIONS');
define('CORS_ALLOWED_HEADERS', 'Content-Type, Authorization, X-API-Key');

define('LOG_PATH', getenv('LOG_PATH') ?: (__DIR__ . '/../../../logs/'));
define('LOG_LEVEL', 'DEBUG');
define('LOG_MAX_SIZE', 10485760);
define('LOG_RETENTION_DAYS', 90);

if (APP_DEBUG) {
    error_reporting(E_ALL);
} else {
    error_reporting(0);
}

$requestUri = str_replace('\\', '/', (string) ($_SERVER['REQUEST_URI'] ?? ''));
$isApiRequest = strpos($requestUri, '/backend/php/api/') !== false;
$isCli = PHP_SAPI === 'cli';

// Keep API responses clean JSON even in debug mode.
if (APP_DEBUG && !$isApiRequest && !$isCli) {
    ini_set('display_errors', '1');
} else {
    ini_set('display_errors', '0');
}

set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) {
        return false;
    }

    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function ($exception) {
    error_log('Uncaught Exception: ' . $exception->getMessage());

    $payload = [
        'success' => false,
        'error' => APP_DEBUG ? $exception->getMessage() : 'Internal Server Error'
    ];

    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json');
    }

    echo json_encode($payload);
    exit;
});

function generateToken(int $length = 32): string {
    return bin2hex(random_bytes($length));
}

function hashString(string $string): string {
    return hash(HASH_ALGO, $string);
}

function verifyHash(string $string, string $hash): bool {
    return hash_equals($hash, hashString($string));
}

function sanitize($input) {
    if (is_array($input)) {
        return array_map('sanitize', $input);
    }

    return htmlspecialchars(strip_tags(trim((string) $input)), ENT_QUOTES, 'UTF-8');
}

function jsonResponse(array $data, int $statusCode = 200): void {
    if (!headers_sent()) {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
    }

    echo json_encode($data, JSON_PRETTY_PRINT);
    exit;
}

function errorResponse(string $message, int $statusCode = 400): void {
    jsonResponse(['error' => $message, 'success' => false], $statusCode);
}

function successResponse($data = [], string $message = 'Success'): void {
    jsonResponse(['success' => true, 'message' => $message, 'data' => $data]);
}

function logMessage(string $level, string $message, array $context = []): void {
    $baseLogPath = rtrim(LOG_PATH, '/\\');
    $fallbackPath = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'jarvis-logs';
    $logDir = $baseLogPath !== '' ? $baseLogPath : $fallbackPath;

    $timestamp = date('Y-m-d H:i:s');
    $contextStr = !empty($context) ? ' | ' . json_encode($context) : '';
    $line = "[{$timestamp}] [{$level}] {$message}{$contextStr}\n";
    $logFile = $logDir . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log';

    if (!is_dir($logDir)) {
        @mkdir($logDir, 0775, true);
    }

    if (is_dir($logDir) && is_writable($logDir)) {
        $written = @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);
        if ($written !== false) {
            return;
        }
    }

    // Never crash request handling because file logging is unavailable.
    error_log(trim($line));
}

function getClientIP(): string {
    if (!empty($_SERVER['HTTP_CLIENT_IP'])) {
        return (string) $_SERVER['HTTP_CLIENT_IP'];
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        return (string) $_SERVER['HTTP_X_FORWARDED_FOR'];
    }

    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function getRequestHeaders(): array {
    $headers = [];

    foreach ($_SERVER as $key => $value) {
        if (strpos($key, 'HTTP_') === 0) {
            $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
            $headers[$name] = $value;
        }
    }

    return $headers;
}

function validateAPIKey(?string $apiKey): bool {
    return !empty($apiKey);
}

function sendCORSHeaders(): void {
    header('Access-Control-Allow-Origin: ' . CORS_ALLOWED_ORIGINS);
    header('Access-Control-Allow-Methods: ' . CORS_ALLOWED_METHODS);
    header('Access-Control-Allow-Headers: ' . CORS_ALLOWED_HEADERS);
    header('Access-Control-Max-Age: 86400');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    sendCORSHeaders();
    exit;
}

sendCORSHeaders();
