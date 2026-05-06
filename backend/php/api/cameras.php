<?php
/**
 * JARVIS Security System - Cameras API
 * Optimized for Single ESP32-CAM Setup
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

// Default camera ID for the single ESP32-CAM setup
define('DEFAULT_CAMERA_ID', 'CAM-001');

 $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
 $rawInput = file_get_contents('php://input');
 $input = json_decode($rawInput ?: '{}', true);
if (!is_array($input)) {
    $input = [];
}

 $db = getDB();

try {
    switch ($method) {
        case 'GET':
            handleGet($db, $_GET);
            break;
        case 'POST':
            handlePost($db, $input);
            break;
        case 'PUT':
            handlePut($db, $input);
            break;
        default:
            errorResponse('Method not allowed', 405);
    }
} catch (Throwable $e) {
    logMessage('ERROR', 'Cameras API failure', ['error' => $e->getMessage()]);
    errorResponse('Internal server error', 500);
}

function handleGet($db, array $params): void
{
    // If specific ID is requested
    if (!empty($params['camera_id'])) {
        $camera = $db->fetch(
            'SELECT * FROM cameras WHERE camera_id = :camera_id',
            ['camera_id' => sanitize((string) $params['camera_id'])]
        );

        if (!$camera) {
            errorResponse('Camera not found', 404);
        }
        successResponse(decorateCameraRecord($camera));
    }

    // Status summary
    if (isset($params['status'])) {
        $stats = $db->fetch(
            "SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) AS online,
                SUM(CASE WHEN status = 'recording' THEN 1 ELSE 0 END) AS recording,
                SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) AS offline
             FROM cameras"
        );
        successResponse($stats);
    }

    // Fetch all (should only be 1 ESP32-CAM based on schema)
    $cameras = $db->fetchAll('SELECT * FROM cameras ORDER BY zone, name');
    successResponse(['cameras' => array_map('decorateCameraRecord', $cameras)]);
}

function handlePost($db, array $input): void
{
    $action = $input['action'] ?? '';

    switch ($action) {
        case 'capture':
            triggerCapture($db, $input);
            break;
        case 'start_stream':
            startStream($db, $input);
            break;
        case 'stop_stream':
            stopStream($db, $input);
            break;
        case 'register':
            registerCamera($db, $input);
            break;
        case 'update_status':
            updateCameraStatus($db, $input);
            break;
        default:
            errorResponse('Invalid action');
    }
}

function handlePut($db, array $input): void
{
    // Default to the main ESP32 camera if ID not provided
    $cameraId = !empty($input['camera_id']) ? sanitize((string) $input['camera_id']) : DEFAULT_CAMERA_ID;

    $allowedFields = ['name', 'location', 'zone', 'resolution', 'fps', 'motion_detection_enabled', 'night_vision', 'ip_address'];
    $updateData = [];

    foreach ($allowedFields as $field) {
        if (array_key_exists($field, $input)) {
            $updateData[$field] = is_string($input[$field]) ? sanitize($input[$field]) : $input[$field];
        }
    }

    if (empty($updateData) && !isset($input['flash'])) {
        errorResponse('No valid fields to update');
    }

    if (!empty($updateData)) {
        $db->update('cameras', $updateData, 'camera_id = :camera_id', ['camera_id' => $cameraId]);
    }
    
    // Forward settings to ESP32-CAM
    $camera = $db->fetch('SELECT * FROM cameras WHERE camera_id = :camera_id', ['camera_id' => $cameraId]);
    if ($camera && !empty($camera['ip_address'])) {
        $port = !empty($camera['port']) ? (int) $camera['port'] : 80;
        $url = 'http://' . $camera['ip_address'] . ($port !== 80 ? ':' . $port : '') . '/settings?';
        $params = [];
        if (isset($input['flash'])) {
            $params[] = 'flash=' . ($input['flash'] ? '1' : '0');
        }
        if (isset($updateData['resolution'])) {
            $params[] = 'resolution=' . urlencode($updateData['resolution']);
        }
        if (!empty($params)) {
            $url .= implode('&', $params);
            sendCameraCommand($url);
        }
    }

    successResponse([], 'Camera updated successfully');
}

/**
 * Trigger Capture on ESP32-CAM
 */
function triggerCapture($db, array $input): void
{
    // Use provided ID or default to the single ESP32 Cam
    $cameraId = !empty($input['camera_id']) ? sanitize((string) $input['camera_id']) : DEFAULT_CAMERA_ID;

    $camera = ensureCameraExists($db, $cameraId);

    // --- ESP32 Interaction Logic ---
    // If the camera has an IP address stored, try to trigger capture on the device
    $captureResponse = null;
    $hardwareTriggered = false;
    $hardwareError = null;
    $telegramSent = false;
    $telegramError = null;
    if (!empty($camera['ip_address'])) {
        $port = !empty($camera['port']) ? (int) $camera['port'] : 80;
        $url = 'http://' . $camera['ip_address'] . ($port !== 80 ? ':' . $port : '') . '/capture';
        $captureResponse = sendCameraCommand($url);
        $responseData = is_array($captureResponse['data'] ?? null) ? $captureResponse['data'] : [];
        $httpStatus = (int) ($captureResponse['status_code'] ?? 0);
        $hardwareTriggered = !empty($captureResponse['ok'])
            || ($httpStatus >= 200 && $httpStatus < 300)
            || (!empty($responseData['success']));

        if ($hardwareTriggered) {
            $telegramSent = !empty($responseData['telegram_sent']);
            if (!$telegramSent) {
                $telegramError = !empty($responseData['telegram_error'])
                    ? (string) $responseData['telegram_error']
                    : 'Telegram send returned false';
                logMessage('WARNING', 'Camera capture succeeded but Telegram send failed', [
                    'camera_id' => $cameraId,
                    'telegram_error' => $telegramError,
                    'capture_response' => $responseData,
                ]);
            }
        } else {
            $hardwareError = !empty($captureResponse['error'])
                ? (string) $captureResponse['error']
                : 'ESP32-CAM capture endpoint unreachable or returned non-2xx';
            logMessage('ERROR', 'Camera capture hardware trigger failed', [
                'camera_id' => $cameraId,
                'url' => $url,
                'hardware_error' => $hardwareError,
                'http_status' => $captureResponse['status_code'] ?? null,
            ]);
        }
    } else {
        $hardwareError = 'Camera IP address is not configured';
        logMessage('ERROR', 'Camera capture skipped because camera IP is missing', [
            'camera_id' => $cameraId,
        ]);
    }
    // -- End ESP32 Logic --

    // Update database timestamp only when capture endpoint was triggered successfully.
    if ($hardwareTriggered) {
        $db->update(
            'cameras',
            ['last_snapshot_at' => date('Y-m-d H:i:s')],
            'camera_id = :camera_id',
            ['camera_id' => $cameraId]
        );
    }

    logCameraAction('capture', $cameraId);

    $camera = decorateCameraRecord($db->fetch(
        'SELECT * FROM cameras WHERE camera_id = :camera_id',
        ['camera_id' => $cameraId]
    ) ?: $camera);

    successResponse([
        'camera_id' => $cameraId,
        'camera_name' => $camera['name'],
        'captured_at' => date('Y-m-d H:i:s'),
        'snapshot_url' => $camera['snapshot_url'] ?? null,
        'hardware_triggered' => $hardwareTriggered,
        'hardware_error' => $hardwareError,
        'telegram_sent' => $telegramSent,
        'telegram_error' => $telegramError,
        'device_response' => $captureResponse['data'] ?? null
    ], 'Capture command sent to ' . $cameraId);
}

function startStream($db, array $input): void
{
    $cameraId = !empty($input['camera_id']) ? sanitize((string) $input['camera_id']) : DEFAULT_CAMERA_ID;
    $camera = ensureCameraExists($db, $cameraId);

    $db->update(
        'cameras',
        ['status' => 'recording', 'recording' => true],
        'camera_id = :camera_id',
        ['camera_id' => $cameraId]
    );

    logCameraAction('start_stream', $cameraId);

    $camera = decorateCameraRecord($db->fetch(
        'SELECT * FROM cameras WHERE camera_id = :camera_id',
        ['camera_id' => $cameraId]
    ) ?: $camera);

    successResponse([
        'camera_id' => $cameraId,
        'camera_name' => $camera['name'],
        'status' => 'recording',
        'stream_url' => $camera['stream_url'] ?? null
    ], 'Stream started');
}

function stopStream($db, array $input): void
{
    $cameraId = !empty($input['camera_id']) ? sanitize((string) $input['camera_id']) : DEFAULT_CAMERA_ID;
    $camera = ensureCameraExists($db, $cameraId);

    $db->update(
        'cameras',
        ['status' => 'online', 'recording' => false],
        'camera_id = :camera_id',
        ['camera_id' => $cameraId]
    );

    logCameraAction('stop_stream', $cameraId);

    successResponse([
        'camera_id' => $cameraId,
        'camera_name' => $camera['name'],
        'status' => 'online'
    ], 'Stream stopped');
}

function ensureCameraExists($db, string $cameraId): array
{
    $camera = $db->fetch(
        'SELECT * FROM cameras WHERE camera_id = :camera_id',
        ['camera_id' => $cameraId]
    );

    if (!$camera) {
        errorResponse('Camera not found: ' . $cameraId, 404);
    }

    return $camera;
}

function registerCamera($db, array $input): void
{
    $cameraId = !empty($input['camera_id']) ? sanitize((string) $input['camera_id']) : DEFAULT_CAMERA_ID;
    $existing = $db->fetch('SELECT * FROM cameras WHERE camera_id = :camera_id', ['camera_id' => $cameraId]);

    $payload = [
        'name' => !empty($input['name']) ? sanitize((string) $input['name']) : 'ESP32-CAM',
        'location' => !empty($input['location']) ? sanitize((string) $input['location']) : 'Main Entrance',
        'zone' => !empty($input['zone']) ? sanitize((string) $input['zone']) : 'Zone A',
        'type' => 'esp32-cam',
        'status' => !empty($input['status']) ? sanitize((string) $input['status']) : 'online',
        'resolution' => !empty($input['resolution']) ? sanitize((string) $input['resolution']) : '800x600',
        'ip_address' => !empty($input['ip_address']) ? sanitize((string) $input['ip_address']) : null,
        'port' => isset($input['port']) ? (int) $input['port'] : 80,
        'stream_url' => !empty($input['stream_url']) ? sanitize((string) $input['stream_url']) : null,
        'snapshot_url' => !empty($input['snapshot_url']) ? sanitize((string) $input['snapshot_url']) : null,
    ];
    $payload['recording'] = $payload['status'] === 'recording';

    if ($existing) {
        $db->update('cameras', $payload, 'camera_id = :camera_id', ['camera_id' => $cameraId]);
    } else {
        $payload['camera_id'] = $cameraId;
        $db->insert('cameras', $payload);
    }

    successResponse(['camera_id' => $cameraId], 'Camera registered successfully');
}

function updateCameraStatus($db, array $input): void
{
    $cameraId = !empty($input['camera_id']) ? sanitize((string) $input['camera_id']) : DEFAULT_CAMERA_ID;
    ensureCameraExists($db, $cameraId);

    $updateData = [];
    foreach (['status', 'stream_url', 'snapshot_url', 'ip_address', 'resolution'] as $field) {
        if (array_key_exists($field, $input)) {
            $updateData[$field] = is_string($input[$field]) ? sanitize((string) $input[$field]) : $input[$field];
        }
    }

    if (isset($updateData['status'])) {
        if ($updateData['status'] === 'recording') {
            $updateData['recording'] = true;
        } elseif ($updateData['status'] === 'online' || $updateData['status'] === 'offline') {
            $updateData['recording'] = false;
        }
    }

    if (!empty($input['captured_at'])) {
        $updateData['last_snapshot_at'] = date('Y-m-d H:i:s');
    }

    if (empty($updateData)) {
        errorResponse('No status fields provided');
    }

    $db->update('cameras', $updateData, 'camera_id = :camera_id', ['camera_id' => $cameraId]);
    successResponse(['camera_id' => $cameraId], 'Camera status updated successfully');
}

function logCameraAction(string $action, ?string $cameraId): void
{
    logMessage('INFO', 'Camera action executed', [
        'action' => $action,
        'camera_id' => $cameraId
    ]);
}

function sendCameraCommand(string $url): array
{
    $responseBody = false;
    $statusCode = 0;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        $responseBody = curl_exec($ch);
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($responseBody === false) {
            return [
                'ok' => false,
                'status_code' => $statusCode,
                'error' => $curlError !== '' ? $curlError : 'cURL request failed',
                'body' => null,
                'data' => null,
            ];
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 5,
                'ignore_errors' => true,
            ],
        ]);
        $responseBody = @file_get_contents($url, false, $context);

        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $headerLine) {
                if (preg_match('/^HTTP\/\d+(?:\.\d+)?\s+(\d+)/i', (string) $headerLine, $matches)) {
                    $statusCode = (int) $matches[1];
                    break;
                }
            }
        }

        if ($responseBody === false || $responseBody === null) {
            return [
                'ok' => false,
                'status_code' => $statusCode,
                'error' => 'HTTP request failed',
                'body' => null,
                'data' => null,
            ];
        }
    }

    $decoded = json_decode((string) $responseBody, true);
    $data = is_array($decoded) ? $decoded : null;
    $ok = $statusCode >= 200 && $statusCode < 300;

    return [
        'ok' => $ok,
        'status_code' => $statusCode,
        'error' => $ok ? null : 'HTTP ' . $statusCode,
        'body' => (string) $responseBody,
        'data' => $data,
    ];
}

function decorateCameraRecord(array $camera): array
{
    $port = !empty($camera['port']) ? (int) $camera['port'] : 80;
    $ipAddress = trim((string) ($camera['ip_address'] ?? ''));
    $streamUrl = normalizeCameraUrl((string) ($camera['stream_url'] ?? ''));
    $snapshotUrl = normalizeCameraUrl((string) ($camera['snapshot_url'] ?? ''));

    if ($streamUrl === '' && $ipAddress !== '') {
        $streamUrl = normalizeCameraUrl('http://' . $ipAddress . ':81/stream');
    }

    if ($snapshotUrl === '' && $ipAddress !== '') {
        $snapshotUrl = normalizeCameraUrl('http://' . $ipAddress . ($port !== 80 ? ':' . $port : '') . '/capture?download=1');
    }

    if ($streamUrl === '' && $snapshotUrl !== '') {
        $parts = parse_url($snapshotUrl);
        if (is_array($parts) && !empty($parts['host'])) {
            $scheme = !empty($parts['scheme']) ? $parts['scheme'] : 'http';
            $host = $parts['host'];
            $streamUrl = $scheme . '://' . $host . ':81/stream';
        }
    }

    $camera['stream_url'] = $streamUrl !== '' ? $streamUrl : null;
    $camera['snapshot_url'] = $snapshotUrl !== '' ? $snapshotUrl : null;

    $camera['recording'] = filter_var($camera['recording'] ?? false, FILTER_VALIDATE_BOOLEAN);

    return $camera;
}

function normalizeCameraUrl(string $url): string
{
    $url = trim($url);
    if ($url === '') {
        return '';
    }

    if (!preg_match('/^https?:\/\//i', $url)) {
        return '';
    }

    if (preg_match('/^https?:\/\/\/+/i', $url)) {
        return '';
    }

    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['host'])) {
        return '';
    }

    return $url;
}
