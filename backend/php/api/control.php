<?php
/**
 * JARVIS Security System - Control API
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/system_helpers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput ?: '{}', true);
if (!is_array($input)) {
    $input = [];
}

$db = getDB();

try {
    ensureDefaultActuators($db);
    ensureAccessControlSettings($db);
    ensureAccessScanEventsTable($db);
    processDoorUnlockExpiry($db);

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
    logMessage('ERROR', 'Control API failure', ['error' => $e->getMessage()]);
    errorResponse('Internal server error', 500);
}

function ensureDefaultActuators($db): void {
    $count = (int) (($db->fetch('SELECT COUNT(*) AS total FROM actuators')['total'] ?? 0));
    if ($count > 0) {
        return;
    }

    $defaults = [
        ['actuator_id' => 'LOCK-001', 'name' => 'Main Door Lock', 'type' => 'lock', 'location' => 'Main Entry', 'zone' => 'Zone A', 'status' => 'off', 'gpio_pin' => 22, 'esp32_id' => 'ESP32-MAIN-01'],
        ['actuator_id' => 'VALVE-001', 'name' => 'Security Valve', 'type' => 'valve', 'location' => 'Server Room', 'zone' => 'Zone A', 'status' => 'off', 'gpio_pin' => 23, 'esp32_id' => 'ESP32-MAIN-01'],
        ['actuator_id' => 'BUZZER-001', 'name' => 'Main Alarm Buzzer', 'type' => 'buzzer', 'location' => 'Main Hall', 'zone' => 'Zone A', 'status' => 'off', 'gpio_pin' => 26, 'esp32_id' => 'ESP32-MAIN-01'],
        ['actuator_id' => 'LED-001', 'name' => 'Warning LED', 'type' => 'led', 'location' => 'Main Hall', 'zone' => 'Zone A', 'status' => 'off', 'gpio_pin' => 25, 'esp32_id' => 'ESP32-MAIN-01'],
    ];

    foreach ($defaults as $actuator) {
        $db->insert('actuators', $actuator);
    }
}

function ensureAccessControlSettings($db): void
{
    $recommendedProfiles = getRecommendedAccessProfiles();

    ensureSetting(
        $db,
        'access_profiles',
        json_encode($recommendedProfiles, JSON_UNESCAPED_SLASHES),
        'json',
        'security',
        'RFID and fingerprint pairs allowed to unlock the main door.',
        false
    );
    migrateLegacyAccessProfiles($db, $recommendedProfiles);

    ensureSetting(
        $db,
        'access_pending',
        json_encode([]),
        'json',
        'security',
        'Pending RFID verification waiting for fingerprint completion.',
        false
    );

    ensureSetting(
        $db,
        'door_unlock_duration_seconds',
        '8',
        'integer',
        'security',
        'How long the main door should stay unlocked after a successful dual scan.',
        false
    );

    ensureSetting(
        $db,
        'door_unlock_until',
        '',
        'string',
        'security',
        'Timestamp until when the main door lock should remain unlocked.',
        false
    );
}

function getRecommendedAccessProfiles(): array
{
    return [
        ['name' => 'Admin Access', 'rfid_uid' => '61E75517', 'fingerprint_id' => 'FP-001', 'role' => 'Administrator'],
        ['name' => 'Security Officer', 'rfid_uid' => '75E14F06', 'fingerprint_id' => 'FP-002', 'role' => 'Security'],
        ['name' => 'Operations Lead', 'rfid_uid' => 'RFID-1003', 'fingerprint_id' => 'FP-003', 'role' => 'Operations'],
    ];
}

function isLegacyPlaceholderProfiles(array $profiles): bool
{
    if (count($profiles) === 0) {
        return false;
    }

    $allPlaceholderRfid = true;
    $allLegacyFingerprint = true;

    foreach ($profiles as $profile) {
        $rfid = strtoupper(trim((string) ($profile['rfid_uid'] ?? '')));
        $fingerprint = strtoupper(trim((string) ($profile['fingerprint_id'] ?? '')));

        if (!preg_match('/^RFID-\d+$/', $rfid)) {
            $allPlaceholderRfid = false;
        }

        if (!preg_match('/^FP[-_\s]*5\d{2}$/', $fingerprint)) {
            $allLegacyFingerprint = false;
        }
    }

    return $allPlaceholderRfid || $allLegacyFingerprint;
}

function migrateLegacyAccessProfiles($db, array $recommendedProfiles): void
{
    $existing = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'access_profiles'");
    if (!$existing) {
        return;
    }

    $profiles = json_decode((string) ($existing['setting_value'] ?? '[]'), true);
    if (!is_array($profiles) || !isLegacyPlaceholderProfiles($profiles)) {
        return;
    }

    $db->update(
        'settings',
        ['setting_value' => json_encode($recommendedProfiles, JSON_UNESCAPED_SLASHES)],
        'setting_key = :setting_key',
        ['setting_key' => 'access_profiles']
    );
}

function ensureAccessScanEventsTable($db): void
{
    $db->query(
        "CREATE TABLE IF NOT EXISTS access_scan_events (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            scan_id VARCHAR(40) NOT NULL UNIQUE,
            scan_type VARCHAR(20) NOT NULL,
            scan_value VARCHAR(191) NOT NULL,
            rfid_uid VARCHAR(191) DEFAULT NULL,
            fingerprint_id VARCHAR(191) DEFAULT NULL,
            expected_value VARCHAR(191) DEFAULT NULL,
            user_name VARCHAR(120) DEFAULT NULL,
            access_role VARCHAR(80) DEFAULT NULL,
            status VARCHAR(20) NOT NULL,
            result_message VARCHAR(255) DEFAULT NULL,
            source VARCHAR(80) DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent VARCHAR(255) DEFAULT NULL,
            details JSON DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_scan_type_time (scan_type, created_at),
            INDEX idx_scan_status_time (status, created_at),
            INDEX idx_scan_rfid_uid (rfid_uid),
            INDEX idx_scan_fingerprint_id (fingerprint_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function ensureSetting($db, string $key, string $value, string $type, string $category, string $description, bool $isPublic): void
{
    $existing = $db->fetch('SELECT id FROM settings WHERE setting_key = :setting_key', ['setting_key' => $key]);
    if ($existing) {
        return;
    }

    $db->insert('settings', [
        'setting_key' => $key,
        'setting_value' => $value,
        'setting_type' => $type,
        'category' => $category,
        'description' => $description,
        'is_public' => $isPublic ? 1 : 0,
    ]);
}

function getSettingValue($db, string $key, string $default = ''): string
{
    $row = $db->fetch('SELECT setting_value FROM settings WHERE setting_key = :setting_key', ['setting_key' => $key]);
    if (!$row || !array_key_exists('setting_value', $row)) {
        return $default;
    }

    return (string) $row['setting_value'];
}

function setSettingValue($db, string $key, string $value): void
{
    $db->update(
        'settings',
        ['setting_value' => $value],
        'setting_key = :setting_key',
        ['setting_key' => $key]
    );
}

function clearDoorUnlockUntil($db): void
{
    setSettingValue($db, 'door_unlock_until', '');
}

function setDoorUnlockUntil($db, int $unlockWindowSeconds): string
{
    $until = date('Y-m-d H:i:s', time() + max(1, $unlockWindowSeconds));
    setSettingValue($db, 'door_unlock_until', $until);
    return $until;
}

function processDoorUnlockExpiry($db): void
{
    $unlockUntil = trim(getSettingValue($db, 'door_unlock_until', ''));
    if ($unlockUntil === '') {
        return;
    }

    $unlockUntilTs = strtotime($unlockUntil);
    if ($unlockUntilTs === false) {
        clearDoorUnlockUntil($db);
        return;
    }

    if ($unlockUntilTs > time()) {
        return;
    }

    $db->update(
        'actuators',
        [
            'status' => 'on',
            'last_activated_at' => date('Y-m-d H:i:s'),
        ],
        'actuator_id = :actuator_id',
        ['actuator_id' => 'LOCK-001']
    );
    clearDoorUnlockUntil($db);
    createAccessEventLog($db, 'Door auto-locked after access unlock window expired.', 1, [
        'status' => 'auto_relocked',
        'source' => 'ACCESS_CONTROL',
        'door_unlocked' => false,
    ]);
}

function handleGet($db, array $params): void {
    if (isset($params['status'])) {
        $securityMode = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'security_mode'");
        $actuators = $db->fetchAll('SELECT * FROM actuators ORDER BY zone, name');

        successResponse([
            'security_mode' => $securityMode['setting_value'] ?? 'armed',
            'actuators' => $actuators,
            'access_control' => getAccessControlStatus($db),
            'system_health' => getSystemHealth()
        ]);
    }

    if (isset($params['actuators'])) {
        $actuators = $db->fetchAll('SELECT * FROM actuators ORDER BY zone, name');
        successResponse(['actuators' => $actuators]);
    }

    if (isset($params['actuator_id'])) {
        $actuator = $db->fetch(
            'SELECT * FROM actuators WHERE actuator_id = :actuator_id',
            ['actuator_id' => sanitize($params['actuator_id'])]
        );

        if (!$actuator) {
            errorResponse('Actuator not found', 404);
        }

        successResponse($actuator);
    }

    if (isset($params['access_profiles'])) {
        successResponse([
            'profiles' => getAccessProfiles($db),
        ]);
    }

    $settings = $db->fetchAll('SELECT * FROM settings ORDER BY category, setting_key');
    $grouped = [];

    foreach ($settings as $setting) {
        $category = $setting['category'] ?? 'general';
        if (!isset($grouped[$category])) {
            $grouped[$category] = [];
        }
        $grouped[$category][] = $setting;
    }

    successResponse(['settings' => $grouped]);
}

function handlePost($db, array $input): void {
    $action = $input['action'] ?? '';

    switch ($action) {
        case 'arm':
            setSecurityMode($db, 'armed');
            break;
        case 'disarm':
            setSecurityMode($db, 'disarmed');
            break;
        case 'trigger_alarm':
            triggerAlarm($db, $input);
            break;
        case 'control_actuator':
            controlActuator($db, $input);
            break;
        case 'verify_access':
            verifyAccess($db, $input);
            break;
        case 'reset_access_flow':
            resetAccessFlow($db, $input);
            break;
        case 'upsert_access_profile':
            upsertAccessProfile($db, $input);
            break;
        case 'remove_access_profile':
            removeAccessProfile($db, $input);
            break;
        default:
            errorResponse('Invalid action');
    }
}

function handlePut($db, array $input): void {
    if (!isset($input['settings']) || !is_array($input['settings'])) {
        errorResponse('settings array is required');
    }

    foreach ($input['settings'] as $key => $value) {
        $db->query(
            'UPDATE settings SET setting_value = :value WHERE setting_key = :key',
            ['value' => is_scalar($value) ? (string) $value : json_encode($value), 'key' => sanitize((string) $key)]
        );
    }

    successResponse(['message' => 'Settings updated successfully']);
}

function setSecurityMode($db, string $mode): void {
    $db->query(
        "UPDATE settings SET setting_value = :mode WHERE setting_key = 'security_mode'",
        ['mode' => $mode]
    );

    $db->insert('logs', [
        'log_id' => 'LOG-' . date('Ymd') . '-' . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
        'type' => 'SECURITY',
        'source' => 'CONTROL_PANEL',
        'message' => "Security mode changed to {$mode}",
        'severity' => 2
    ]);

    logMessage('INFO', 'Security mode changed', ['mode' => $mode]);

    successResponse(['message' => "Security mode set to {$mode}", 'mode' => $mode]);
}

function triggerAlarm($db, array $input): void {
    $duration = isset($input['duration']) ? max(500, (int) $input['duration']) : 5000;

    $db->insert('logs', [
        'log_id' => 'LOG-' . date('Ymd') . '-' . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
        'type' => 'WARNING',
        'source' => 'CONTROL_PANEL',
        'message' => "Alarm triggered manually for {$duration} ms",
        'severity' => 2
    ]);

    logMessage('WARNING', 'Alarm triggered manually', ['duration_ms' => $duration]);

    successResponse(['message' => 'Alarm triggered', 'duration' => $duration]);
}

function controlActuator($db, array $input): void {
    if (empty($input['actuator_id']) || !array_key_exists('state', $input)) {
        errorResponse('actuator_id and state are required');
    }

    $actuatorId = sanitize((string) $input['actuator_id']);
    $actuator = $db->fetch('SELECT * FROM actuators WHERE actuator_id = :actuator_id', ['actuator_id' => $actuatorId]);

    if (!$actuator) {
        errorResponse('Actuator not found', 404);
    }

    $state = filter_var($input['state'], FILTER_VALIDATE_BOOLEAN) ? 'on' : 'off';

    $updateData = ['status' => $state];
    if ($state === 'on') {
        $updateData['last_activated_at'] = date('Y-m-d H:i:s');
    } else {
        $updateData['last_deactivated_at'] = date('Y-m-d H:i:s');
    }

    $db->update('actuators', $updateData, 'actuator_id = :actuator_id', ['actuator_id' => $actuatorId]);
    if ($actuatorId === 'LOCK-001' && $state === 'on') {
        clearDoorUnlockUntil($db);
    }

    $db->insert('logs', [
        'log_id' => 'LOG-' . date('Ymd') . '-' . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT),
        'type' => 'SYSTEM',
        'source' => 'CONTROL_PANEL',
        'message' => "Actuator {$actuator['name']} turned {$state}",
        'severity' => 1
    ]);

    successResponse([
        'message' => "Actuator {$state}",
        'actuator_id' => $actuatorId,
        'state' => $state
    ]);
}

function getAccessProfiles($db): array
{
    $setting = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'access_profiles'");
    $profiles = json_decode((string) ($setting['setting_value'] ?? '[]'), true);
    return is_array($profiles) ? $profiles : [];
}

function saveAccessProfiles($db, array $profiles): void
{
    $normalized = array_values(array_map(static function ($profile) {
        return [
            'name' => trim((string) ($profile['name'] ?? 'Authorized User')),
            'rfid_uid' => normalizeRfidUid((string) ($profile['rfid_uid'] ?? '')),
            'fingerprint_id' => normalizeFingerprintId((string) ($profile['fingerprint_id'] ?? '')),
            'role' => trim((string) ($profile['role'] ?? 'User')),
        ];
    }, $profiles));

    $db->update(
        'settings',
        ['setting_value' => json_encode($normalized, JSON_UNESCAPED_SLASHES)],
        'setting_key = :setting_key',
        ['setting_key' => 'access_profiles']
    );
}

function upsertAccessProfile($db, array $input): void
{
    $rfidUid = normalizeRfidUid((string) ($input['rfid_uid'] ?? ''));
    $fingerprintId = normalizeFingerprintId((string) ($input['fingerprint_id'] ?? ''));
    $name = trim((string) ($input['name'] ?? 'Authorized User'));
    $role = trim((string) ($input['role'] ?? 'User'));

    if ($rfidUid === '' || $fingerprintId === '') {
        errorResponse('rfid_uid and fingerprint_id are required');
    }

    $profiles = getAccessProfiles($db);
    $updated = false;

    foreach ($profiles as &$profile) {
        if (strcasecmp((string) ($profile['rfid_uid'] ?? ''), $rfidUid) === 0) {
            $profile['name'] = $name;
            $profile['fingerprint_id'] = $fingerprintId;
            $profile['role'] = $role;
            $updated = true;
            break;
        }
    }
    unset($profile);

    if (!$updated) {
        $profiles[] = [
            'name' => $name,
            'rfid_uid' => $rfidUid,
            'fingerprint_id' => $fingerprintId,
            'role' => $role,
        ];
    }

    saveAccessProfiles($db, $profiles);
    createAccessEventLog($db, $updated ? "Access profile updated for RFID {$rfidUid}." : "Access profile added for RFID {$rfidUid}.", 1, [
        'status' => 'profile_updated',
        'rfid_uid' => $rfidUid,
        'fingerprint_id' => $fingerprintId,
        'user_name' => $name,
        'role' => $role,
    ]);

    successResponse([
        'updated' => $updated,
        'profiles' => getAccessProfiles($db),
    ], $updated ? 'Access profile updated successfully' : 'Access profile added successfully');
}

function removeAccessProfile($db, array $input): void
{
    $rfidUid = normalizeRfidUid((string) ($input['rfid_uid'] ?? ''));
    if ($rfidUid === '') {
        errorResponse('rfid_uid is required');
    }

    $profiles = getAccessProfiles($db);
    $remaining = array_values(array_filter($profiles, static function ($profile) use ($rfidUid) {
        return strcasecmp((string) ($profile['rfid_uid'] ?? ''), $rfidUid) !== 0;
    }));

    if (count($remaining) === count($profiles)) {
        errorResponse('RFID profile not found', 404);
    }

    saveAccessProfiles($db, $remaining);
    createAccessEventLog($db, "Access profile removed for RFID {$rfidUid}.", 2, [
        'status' => 'profile_removed',
        'rfid_uid' => $rfidUid,
    ]);

    successResponse([
        'profiles' => getAccessProfiles($db),
    ], 'Access profile removed successfully');
}

function getPendingAccess($db): ?array
{
    $setting = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'access_pending'");
    $pending = json_decode((string) ($setting['setting_value'] ?? '[]'), true);
    if (!is_array($pending) || empty($pending['expires_at'])) {
        return null;
    }

    if (strtotime((string) $pending['expires_at']) <= time()) {
        clearPendingAccess($db);
        return null;
    }

    return $pending;
}

function clearPendingAccess($db): void
{
    $db->update('settings', ['setting_value' => json_encode([])], 'setting_key = :setting_key', ['setting_key' => 'access_pending']);
}

function setPendingAccess($db, array $pending): void
{
    $db->update(
        'settings',
        ['setting_value' => json_encode($pending, JSON_UNESCAPED_SLASHES)],
        'setting_key = :setting_key',
        ['setting_key' => 'access_pending']
    );
}

function findAccessProfileByRfid(array $profiles, string $rfidUid): ?array
{
    $normalizedTarget = normalizeRfidUid($rfidUid);
    foreach ($profiles as $profile) {
        if (strcasecmp(normalizeRfidUid((string) ($profile['rfid_uid'] ?? '')), $normalizedTarget) === 0) {
            return $profile;
        }
    }
    return null;
}

function getUnlockWindowSeconds($db): int
{
    $setting = $db->fetch("SELECT setting_value FROM settings WHERE setting_key = 'door_unlock_duration_seconds'");
    return max(3, (int) ($setting['setting_value'] ?? 8));
}

function createAccessAudit($db, string $action, bool $success, array $details = []): void
{
    $db->insert('access_log', [
        'user_id' => null,
        'action' => $action,
        'resource' => 'door',
        'resource_id' => 'LOCK-001',
        'ip_address' => getClientIP(),
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'ACCESS_CONTROL',
        'details' => !empty($details) ? json_encode($details, JSON_UNESCAPED_SLASHES) : null,
        'success' => $success ? 1 : 0,
    ]);
}

function createAccessEventLog($db, string $message, int $severity, array $details = []): string
{
    return createSystemLog($db, 'ACCESS', 'ACCESS_CONTROL', $message, $severity, $details);
}

function triggerUnauthorizedAccessAlert($db, string $message, array $details = []): void
{
    try {
        createAlertWithSideEffects($db, [
            'type' => 'unauthorized_access',
            'severity' => 'high',
            'source' => 'ACCESS_CONTROL',
            'location' => 'Main Entry',
            'message' => $message,
            'details' => $details,
        ]);
    } catch (Throwable $e) {
        logMessage('ERROR', 'Failed to create unauthorized access alert', [
            'error' => $e->getMessage(),
            'message' => $message,
        ]);
    }
}

function createScanId(): string
{
    return 'SCAN-' . date('YmdHis') . '-' . str_pad((string) random_int(1, 9999), 4, '0', STR_PAD_LEFT);
}

function writeAccessScanFileLog(array $payload): void
{
    $baseLogPath = rtrim(LOG_PATH, '/\\');
    $fallbackPath = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'jarvis-logs';
    $logDir = $baseLogPath !== '' ? $baseLogPath : $fallbackPath;
    $scanLogPath = $logDir . DIRECTORY_SEPARATOR . 'access_scans.log';

    if (!is_dir($logDir)) {
        @mkdir($logDir, 0775, true);
    }

    $line = json_encode($payload, JSON_UNESCAPED_SLASHES);
    if ($line === false) {
        $line = json_encode(['error' => 'Failed to encode payload', 'ts' => date('c')]);
    }

    if (is_dir($logDir) && is_writable($logDir)) {
        $written = @file_put_contents($scanLogPath, $line . PHP_EOL, FILE_APPEND | LOCK_EX);
        if ($written !== false) {
            return;
        }
    }

    error_log('[ACCESS_SCAN] ' . $line);
}

function recordAccessScanEvent(
    $db,
    string $scanType,
    string $scanValue,
    string $status,
    string $resultMessage,
    array $context = []
): void {
    $scanType = strtoupper($scanType);
    $status = strtolower($status);
    $scanValue = trim($scanValue);

    $record = [
        'scan_id' => createScanId(),
        'scan_type' => $scanType,
        'scan_value' => $scanValue,
        'rfid_uid' => $context['rfid_uid'] ?? ($scanType === 'RFID' ? $scanValue : null),
        'fingerprint_id' => $context['fingerprint_id'] ?? ($scanType === 'FINGERPRINT' ? $scanValue : null),
        'expected_value' => $context['expected_value'] ?? null,
        'user_name' => $context['user_name'] ?? null,
        'access_role' => $context['access_role'] ?? null,
        'status' => $status,
        'result_message' => $resultMessage,
        'source' => $context['source'] ?? 'CONTROL_PANEL',
        'ip_address' => getClientIP(),
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'ACCESS_CONTROL',
        'details' => !empty($context['details']) && is_array($context['details'])
            ? json_encode($context['details'], JSON_UNESCAPED_SLASHES)
            : null,
    ];

    try {
        $db->insert('access_scan_events', $record);
    } catch (Throwable $e) {
        logMessage('ERROR', 'Failed to insert access scan event', [
            'scan_type' => $scanType,
            'status' => $status,
            'error' => $e->getMessage(),
        ]);
    }

    $filePayload = [
        'timestamp' => date('c'),
        'scan_id' => $record['scan_id'],
        'scan_type' => $record['scan_type'],
        'scan_value' => $record['scan_value'],
        'rfid_uid' => $record['rfid_uid'],
        'fingerprint_id' => $record['fingerprint_id'],
        'expected_value' => $record['expected_value'],
        'user_name' => $record['user_name'],
        'access_role' => $record['access_role'],
        'status' => $record['status'],
        'result_message' => $record['result_message'],
        'source' => $record['source'],
        'ip_address' => $record['ip_address'],
        'details' => !empty($context['details']) && is_array($context['details']) ? $context['details'] : null,
    ];

    try {
        writeAccessScanFileLog($filePayload);
    } catch (Throwable $e) {
        logMessage('ERROR', 'Failed to write access scan file log', [
            'scan_type' => $scanType,
            'status' => $status,
            'error' => $e->getMessage(),
        ]);
    }
}

function getRecentAccessEvent($db): ?array
{
    $log = $db->fetch(
        "SELECT log_id, message, created_at, details
         FROM logs
         WHERE type = 'ACCESS'
         ORDER BY created_at DESC, id DESC
         LIMIT 1"
    );

    if (!$log) {
        return null;
    }

    $details = json_decode((string) ($log['details'] ?? 'null'), true);
    return [
        'log_id' => $log['log_id'],
        'message' => $log['message'],
        'created_at' => $log['created_at'],
        'status' => $details['status'] ?? null,
        'user_name' => $details['user_name'] ?? null,
        'rfid_uid' => $details['rfid_uid'] ?? null,
        'fingerprint_id' => $details['fingerprint_id'] ?? null,
        'source' => $details['source'] ?? null,
        'door_unlocked' => !empty($details['door_unlocked']),
    ];
}

function getAccessControlStatus($db): array
{
    $pending = getPendingAccess($db);
    $profiles = getAccessProfiles($db);
    return [
        'awaiting_fingerprint' => $pending !== null,
        'pending_user' => $pending['user_name'] ?? null,
        'pending_rfid_uid' => $pending['rfid_uid'] ?? null,
        'expires_at' => $pending['expires_at'] ?? null,
        'profiles_count' => count($profiles),
        'unlock_window_seconds' => getUnlockWindowSeconds($db),
        'recent_event' => getRecentAccessEvent($db),
    ];
}

function resetAccessFlow($db, array $input): void
{
    clearPendingAccess($db);
    $source = !empty($input['source']) ? sanitize((string) $input['source']) : 'CONTROL_PANEL';
    createAccessAudit($db, 'ACCESS_FLOW_RESET', true, ['source' => $source]);
    createAccessEventLog($db, 'Access verification flow was reset.', 1, [
        'status' => 'idle',
        'source' => $source,
    ]);

    successResponse([
        'access_control' => getAccessControlStatus($db),
    ], 'Access verification flow reset successfully');
}

function readFirstNonEmptyInput(array $input, array $keys): string
{
    foreach ($keys as $key) {
        if (!array_key_exists($key, $input)) {
            continue;
        }
        $value = trim((string) $input[$key]);
        if ($value !== '') {
            return $value;
        }
    }

    return '';
}

function verifyAccess($db, array $input): void
{
    $rfidUid = normalizeRfidUid(readFirstNonEmptyInput($input, ['rfid_uid', 'rfid', 'uid', 'card_uid']));
    $fingerprintRaw = readFirstNonEmptyInput($input, ['fingerprint_id', 'fingerprint', 'finger_id', 'template_id', 'fingerprint_uid']);
    $fingerprintId = normalizeFingerprintId($fingerprintRaw);
    $source = !empty($input['source']) ? sanitize((string) $input['source']) : 'CONTROL_PANEL';
    $profiles = getAccessProfiles($db);

    if ($rfidUid !== '') {
        $profile = findAccessProfileByRfid($profiles, $rfidUid);
        if ($profile === null) {
            clearPendingAccess($db);
            recordAccessScanEvent($db, 'RFID', $rfidUid, 'rejected', 'RFID card not recognized', [
                'source' => $source,
                'details' => [
                    'reason' => 'unknown_rfid',
                ],
            ]);
            createAccessAudit($db, 'RFID_SCAN_REJECTED', false, ['rfid_uid' => $rfidUid, 'source' => $source]);
            createAccessEventLog($db, "RFID {$rfidUid} was rejected.", 2, [
                'status' => 'denied',
                'rfid_uid' => $rfidUid,
                'source' => $source,
                'door_unlocked' => false,
            ]);
            triggerUnauthorizedAccessAlert($db, "Unauthorized RFID access attempt detected ({$rfidUid}).", [
                'rfid_uid' => $rfidUid,
                'source' => $source,
                'reason' => 'unknown_rfid',
            ]);
            errorResponse('RFID card not recognized', 403);
        }

        $pending = [
            'rfid_uid' => $rfidUid,
            'fingerprint_id' => normalizeFingerprintId((string) ($profile['fingerprint_id'] ?? '')),
            'user_name' => (string) ($profile['name'] ?? 'Authorized User'),
            'role' => (string) ($profile['role'] ?? 'User'),
            'source' => $source,
            'expires_at' => date('Y-m-d H:i:s', time() + 60),
        ];
        setPendingAccess($db, $pending);
        recordAccessScanEvent($db, 'RFID', $rfidUid, 'accepted', 'RFID accepted, awaiting fingerprint', [
            'rfid_uid' => $rfidUid,
            'expected_value' => $pending['fingerprint_id'],
            'user_name' => $pending['user_name'],
            'access_role' => $pending['role'],
            'source' => $source,
            'details' => [
                'awaiting_fingerprint' => true,
                'expires_at' => $pending['expires_at'],
            ],
        ]);

        createAccessAudit($db, 'RFID_SCAN_ACCEPTED', true, [
            'rfid_uid' => $rfidUid,
            'user_name' => $pending['user_name'],
            'source' => $source,
        ]);
        createAccessEventLog($db, "RFID accepted for {$pending['user_name']}. Waiting for fingerprint verification.", 1, [
            'status' => 'pending',
            'rfid_uid' => $rfidUid,
            'user_name' => $pending['user_name'],
            'source' => $source,
            'door_unlocked' => false,
        ]);

        successResponse([
            'verified' => false,
            'awaiting_fingerprint' => true,
            'access_control' => getAccessControlStatus($db),
        ], 'RFID verified. Scan fingerprint to unlock the door.');
    }

    if ($fingerprintId !== '') {
        $pending = getPendingAccess($db);
        if ($pending === null) {
            recordAccessScanEvent($db, 'FINGERPRINT', $fingerprintId, 'rejected', 'Fingerprint scanned without RFID verification', [
                'fingerprint_id' => $fingerprintId,
                'source' => $source,
                'details' => [
                    'reason' => 'missing_pending_rfid',
                ],
            ]);
            createAccessAudit($db, 'FINGERPRINT_WITHOUT_RFID', false, ['fingerprint_id' => $fingerprintId, 'source' => $source]);
            createAccessEventLog($db, "Fingerprint {$fingerprintId} rejected because no RFID verification is pending.", 2, [
                'status' => 'denied',
                'fingerprint_id' => $fingerprintId,
                'source' => $source,
                'door_unlocked' => false,
            ]);
            triggerUnauthorizedAccessAlert($db, "Unauthorized fingerprint attempt detected ({$fingerprintId}) without RFID verification.", [
                'fingerprint_id' => $fingerprintId,
                'source' => $source,
                'reason' => 'missing_pending_rfid',
            ]);
            errorResponse('Scan RFID card first', 409);
        }

        $expectedFingerprintId = normalizeFingerprintId((string) ($pending['fingerprint_id'] ?? ''));
        if ($expectedFingerprintId === '' || strcasecmp($expectedFingerprintId, $fingerprintId) !== 0) {
            clearPendingAccess($db);
            recordAccessScanEvent($db, 'FINGERPRINT', $fingerprintId, 'rejected', 'Fingerprint does not match pending RFID', [
                'rfid_uid' => (string) $pending['rfid_uid'],
                'fingerprint_id' => $fingerprintId,
                'expected_value' => $expectedFingerprintId,
                'user_name' => (string) $pending['user_name'],
                'access_role' => (string) ($pending['role'] ?? 'User'),
                'source' => $source,
                'details' => [
                    'reason' => 'fingerprint_mismatch',
                ],
            ]);
            createAccessAudit($db, 'FINGERPRINT_REJECTED', false, [
                'rfid_uid' => $pending['rfid_uid'],
                'fingerprint_id' => $fingerprintId,
                'expected_fingerprint_id' => $expectedFingerprintId,
                'user_name' => $pending['user_name'],
                'source' => $source,
            ]);
            createAccessEventLog($db, "Fingerprint verification failed for {$pending['user_name']}. Door remained locked.", 3, [
                'status' => 'denied',
                'rfid_uid' => $pending['rfid_uid'],
                'fingerprint_id' => $fingerprintId,
                'user_name' => $pending['user_name'],
                'source' => $source,
                'door_unlocked' => false,
            ]);
            triggerUnauthorizedAccessAlert($db, "Fingerprint mismatch detected for RFID {$pending['rfid_uid']}. Unauthorized access attempt blocked.", [
                'rfid_uid' => $pending['rfid_uid'],
                'fingerprint_id' => $fingerprintId,
                'expected_fingerprint_id' => $expectedFingerprintId,
                'user_name' => $pending['user_name'],
                'source' => $source,
                'reason' => 'fingerprint_mismatch',
            ]);
            errorResponse('Fingerprint does not match the scanned RFID card', 403);
        }

        $unlockWindowSeconds = getUnlockWindowSeconds($db);
        $db->update('actuators', [
            'status' => 'off',
            'last_deactivated_at' => date('Y-m-d H:i:s'),
        ], 'actuator_id = :actuator_id', ['actuator_id' => 'LOCK-001']);
        $unlockUntil = setDoorUnlockUntil($db, $unlockWindowSeconds);
        clearPendingAccess($db);
        recordAccessScanEvent($db, 'FINGERPRINT', $fingerprintId, 'granted', 'Fingerprint matched, access granted', [
            'rfid_uid' => (string) $pending['rfid_uid'],
            'fingerprint_id' => $fingerprintId,
            'expected_value' => (string) $pending['fingerprint_id'],
            'user_name' => (string) $pending['user_name'],
            'access_role' => (string) ($pending['role'] ?? 'User'),
            'source' => $source,
            'details' => [
                'door_unlocked' => true,
                'unlock_window_seconds' => $unlockWindowSeconds,
                'unlock_until' => $unlockUntil,
            ],
        ]);

        createAccessAudit($db, 'ACCESS_GRANTED', true, [
            'rfid_uid' => $pending['rfid_uid'],
            'fingerprint_id' => $fingerprintId,
            'user_name' => $pending['user_name'],
            'source' => $source,
            'unlock_window_seconds' => $unlockWindowSeconds,
            'unlock_until' => $unlockUntil,
        ]);
        createAccessEventLog($db, "Access granted for {$pending['user_name']}. Door unlocked after RFID and fingerprint verification.", 1, [
            'status' => 'granted',
            'rfid_uid' => $pending['rfid_uid'],
            'fingerprint_id' => $fingerprintId,
            'user_name' => $pending['user_name'],
            'source' => $source,
            'door_unlocked' => true,
            'unlock_window_seconds' => $unlockWindowSeconds,
            'unlock_until' => $unlockUntil,
        ]);

        successResponse([
            'verified' => true,
            'door_unlocked' => true,
            'unlock_window_seconds' => $unlockWindowSeconds,
            'unlock_until' => $unlockUntil,
            'access_control' => getAccessControlStatus($db),
        ], 'RFID and fingerprint verified. Door unlocked.');
    }

    errorResponse('Provide an RFID UID or fingerprint ID');
}

function normalizeFingerprintNumeric(int $numeric): string
{
    $numeric = max(0, $numeric);
    if ($numeric >= 500 && $numeric <= 627) {
        $numeric -= 500;
    }
    if ($numeric <= 127) {
        return sprintf('FP-%03d', $numeric);
    }
    return 'FP-' . $numeric;
}

function normalizeRfidUid(string $value): string
{
    $normalized = strtoupper(trim($value));
    if ($normalized === '') {
        return '';
    }

    // Accept card UIDs entered with spaces, dashes, colons, etc.
    return preg_replace('/[^A-Z0-9]/', '', $normalized) ?? '';
}

function normalizeFingerprintId(string $value): string
{
    $normalized = strtoupper(trim($value));
    if ($normalized === '') {
        return '';
    }

    if (preg_match('/^\d+$/', $normalized) === 1) {
        return normalizeFingerprintNumeric((int) $normalized);
    }

    if (preg_match('/^FP[-_\s]*(\d{1,3})$/', $normalized, $matches) === 1) {
        return normalizeFingerprintNumeric((int) $matches[1]);
    }

    // Compatibility: scanners often emit strings like "ID: 1", "#501", or "Finger ID 3".
    if (preg_match('/(?:^|[^A-Z0-9])(?:FP|FINGER|FINGERPRINT|ID)?\s*[:#-]?\s*(\d{1,3})(?:[^0-9]|$)/', $normalized, $matches) === 1) {
        return normalizeFingerprintNumeric((int) $matches[1]);
    }

    return $normalized;
}

function getSystemHealth(): array {
    $memoryMb = round(memory_get_usage(true) / 1024 / 1024, 2);

    $diskRoot = DIRECTORY_SEPARATOR === '\\' ? getenv('SystemDrive') . DIRECTORY_SEPARATOR : '/';
    if (!$diskRoot) {
        $diskRoot = '/';
    }

    $diskFree = @disk_free_space($diskRoot);
    $diskFreeGb = is_numeric($diskFree) ? round(((float) $diskFree) / 1024 / 1024 / 1024, 2) . ' GB free' : 'Unknown';

    $cpuLoad = function_exists('sys_getloadavg') ? sys_getloadavg()[0] : null;

    return [
        'cpu' => $cpuLoad ?? 'N/A',
        'memory' => $memoryMb . ' MB',
        'uptime' => 'N/A',
        'disk' => $diskFreeGb
    ];
}
