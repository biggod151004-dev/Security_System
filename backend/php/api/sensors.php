<?php
/**
 * JARVIS Security System - Sensors API
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

// Keep a wider freshness window so temporary Wi-Fi jitter does not mark sensors offline.
const SENSOR_OFFLINE_TIMEOUT_SECONDS = 120;
const SENSOR_TIMESTAMP_MAX_PAST_SECONDS = 900;
const SENSOR_TIMESTAMP_MAX_FUTURE_SECONDS = 120;
const SENSOR_ALERT_DEDUPE_WINDOW_SECONDS = 12;

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
        case 'DELETE':
            handleDelete($db, $input);
            break;
        default:
            errorResponse('Method not allowed', 405);
    }
} catch (Throwable $e) {
    logMessage('ERROR', 'Sensors API failure', ['error' => $e->getMessage()]);
    errorResponse('Internal server error', 500);
}

function handleGet($db, array $params): void
{
    if (isset($params['sensor_id'])) {
        $sensor = $db->fetch(
            'SELECT * FROM sensors WHERE sensor_id = :sensor_id',
            ['sensor_id' => sanitize((string) $params['sensor_id'])]
        );

        if (!$sensor) {
            errorResponse('Sensor not found', 404);
        }

        $sensor['readings'] = $db->fetchAll(
            'SELECT * FROM sensor_data WHERE sensor_id = :sensor_id ORDER BY recorded_at DESC LIMIT 100',
            ['sensor_id' => $sensor['sensor_id']]
        );

        $sensor['latest_reading'] = $db->fetch(
            'SELECT value, numeric_value, status, recorded_at FROM sensor_data WHERE sensor_id = :sensor_id ORDER BY recorded_at DESC LIMIT 1',
            ['sensor_id' => $sensor['sensor_id']]
        );
        $sensor = enrichSensorRuntimeState($db, $sensor);

        successResponse($sensor);
    }

    if (isset($params['stats'])) {
        $stats = $db->fetch(
            "SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
             FROM sensors"
        );

        $byType = $db->fetchAll(
            "SELECT type, COUNT(*) AS count
             FROM sensors
             WHERE status = 'active'
             GROUP BY type"
        );

        successResponse([
            'stats' => $stats,
            'by_type' => $byType,
        ]);
    }

    $where = 'WHERE 1=1';
    $queryParams = [];

    if (isset($params['status'])) {
        $where .= ' AND status = :status';
        $queryParams['status'] = sanitize((string) $params['status']);
    }

    if (isset($params['type'])) {
        $where .= ' AND type = :type';
        $queryParams['type'] = sanitize((string) $params['type']);
    }

    if (isset($params['zone'])) {
        $where .= ' AND zone = :zone';
        $queryParams['zone'] = sanitize((string) $params['zone']);
    }

    $sensors = $db->fetchAll("SELECT * FROM sensors {$where} ORDER BY zone, name", $queryParams);

    foreach ($sensors as &$sensor) {
        $sensor['latest_reading'] = $db->fetch(
            'SELECT value, numeric_value, status, recorded_at FROM sensor_data WHERE sensor_id = :sensor_id ORDER BY recorded_at DESC LIMIT 1',
            ['sensor_id' => $sensor['sensor_id']]
        );
        $sensor = enrichSensorRuntimeState($db, $sensor);
    }

    successResponse(['sensors' => $sensors]);
}

function handlePost($db, array $input): void
{
    $esp32Id = !empty($input['esp32_id']) ? sanitize((string) $input['esp32_id']) : 'ESP32-MAIN';
    $timestampMeta = validatePayloadTimestamp($input);

    if (!empty($timestampMeta['has_timestamp']) && empty($timestampMeta['valid'])) {
        successResponse([
            'reading' => null,
            'events' => [],
            'ignored' => true,
            'timestamp_valid' => false,
            'reason' => $timestampMeta['reason'] ?? 'Invalid payload timestamp',
        ], 'Sensor payload ignored due to invalid timestamp');
    }

    $recordedAt = !empty($timestampMeta['recorded_at']) ? (string) $timestampMeta['recorded_at'] : null;

    if (isset($input['readings']) && is_array($input['readings'])) {
        $result = ingestBatchPayload($db, $input, $esp32Id, $recordedAt);
        $result['timestamp_valid'] = !empty($timestampMeta['valid']) || empty($timestampMeta['has_timestamp']);
        $result['recorded_at'] = $recordedAt;
        successResponse($result, 'Sensor payload stored successfully');
    }

    if (empty($input['sensor_id'])) {
        errorResponse('sensor_id is required');
    }

    $sensor = ensureSensorExists($db, [
        'sensor_id' => sanitize((string) $input['sensor_id']),
        'name' => !empty($input['name']) ? sanitize((string) $input['name']) : 'Sensor ' . sanitize((string) $input['sensor_id']),
        'type' => !empty($input['type']) ? sanitize((string) $input['type']) : 'custom',
        'location' => !empty($input['location']) ? sanitize((string) $input['location']) : 'Unknown',
        'zone' => !empty($input['zone']) ? sanitize((string) $input['zone']) : 'Default',
        'unit' => !empty($input['unit']) ? sanitize((string) $input['unit']) : null,
        'threshold_alert' => $input['threshold_alert'] ?? null,
    ], $esp32Id);

    if (!shouldAcceptSensorData($sensor)) {
        successResponse([
            'reading' => null,
            'events' => [],
            'ignored' => true,
            'reason' => 'Sensor is inactive and not accepting new data',
        ], 'Sensor is off. Incoming data ignored.');
    }

    $stored = storeSensorReading($db, $sensor, $input['value'] ?? null, $input, $esp32Id, $recordedAt);
    $events = processSensorEventRules($db, $sensor, $input['value'] ?? null, $input, $esp32Id);

    successResponse([
        'reading' => $stored,
        'events' => $events,
        'timestamp_valid' => !empty($timestampMeta['valid']) || empty($timestampMeta['has_timestamp']),
        'recorded_at' => $recordedAt,
    ], 'Sensor data stored successfully');
}

function handlePut($db, array $input): void
{
    if (!empty($input['all']) && array_key_exists('status', $input)) {
        $status = sanitizeSensorStatus($input['status']);
        $db->query('UPDATE sensors SET status = :status', ['status' => $status]);
        successResponse([
            'message' => 'All sensors updated successfully',
            'status' => $status,
        ]);
    }

    if (empty($input['sensor_id'])) {
        errorResponse('sensor_id is required');
    }

    $sensorId = sanitize((string) $input['sensor_id']);
    $sensor = $db->fetch('SELECT * FROM sensors WHERE sensor_id = :sensor_id', ['sensor_id' => $sensorId]);

    if (!$sensor) {
        errorResponse('Sensor not found', 404);
    }

    $allowed = ['name', 'type', 'location', 'zone', 'status', 'threshold_alert', 'min_value', 'max_value', 'unit', 'gpio_pin'];
    $updateData = [];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $input)) {
            $updateData[$field] = is_string($input[$field]) ? sanitize((string) $input[$field]) : $input[$field];
        }
    }

    if (array_key_exists('status', $updateData)) {
        $updateData['status'] = sanitizeSensorStatus($updateData['status']);
    }

    if (empty($updateData)) {
        errorResponse('No valid fields to update');
    }

    $db->update('sensors', $updateData, 'sensor_id = :sensor_id', ['sensor_id' => $sensorId]);
    successResponse(['message' => 'Sensor updated successfully']);
}

function handleDelete($db, array $input): void
{
    $cleanupRequested = !empty($input['clear_temporary'])
        || !empty($input['clear_temp'])
        || !empty($_GET['clear_temporary'])
        || !empty($_GET['clear_temp']);

    if ($cleanupRequested) {
        $cleanupInput = $input;

        if (!array_key_exists('types', $cleanupInput) && isset($_GET['types'])) {
            $cleanupInput['types'] = is_array($_GET['types'])
                ? $_GET['types']
                : explode(',', (string) $_GET['types']);
        }

        $result = clearTemporarySensorData($db, $cleanupInput);
        successResponse($result, 'Temporary sensor data cleared successfully');
    }

    if (empty($input['sensor_id'])) {
        errorResponse('sensor_id is required');
    }

    $sensorId = sanitize((string) $input['sensor_id']);

    $db->update(
        'sensors',
        ['status' => 'inactive'],
        'sensor_id = :sensor_id',
        ['sensor_id' => $sensorId]
    );

    successResponse(['message' => 'Sensor deactivated successfully']);
}

function clearTemporarySensorData($db, array $input): array
{
    $allowedTypes = ['motion', 'vibration', 'temperature', 'humidity', 'fire', 'door', 'window', 'gas', 'custom'];
    $requestedTypes = isset($input['types']) && is_array($input['types'])
        ? $input['types']
        : ['vibration', 'temperature'];

    $types = [];
    foreach ($requestedTypes as $type) {
        $normalized = sanitize((string) $type);
        if (in_array($normalized, $allowedTypes, true)) {
            $types[] = $normalized;
        }
    }
    $types = array_values(array_unique($types));

    if (empty($types)) {
        errorResponse('No valid sensor types provided for cleanup');
    }

    $typePlaceholders = [];
    $typeParams = [];
    foreach ($types as $index => $type) {
        $key = 'type_' . $index;
        $typePlaceholders[] = ':' . $key;
        $typeParams[$key] = $type;
    }
    $typeClause = implode(', ', $typePlaceholders);

    $sensorRows = $db->fetchAll(
        "SELECT sensor_id FROM sensors WHERE type IN ({$typeClause})",
        $typeParams
    );

    $sensorIds = array_values(array_unique(array_map(
        static fn (array $row): string => (string) $row['sensor_id'],
        $sensorRows
    )));

    if (empty($sensorIds)) {
        return [
            'types' => $types,
            'sensor_ids' => [],
            'deleted_readings' => 0,
            'reset_sensors' => 0,
        ];
    }

    $sensorPlaceholders = [];
    $sensorParams = [];
    foreach ($sensorIds as $index => $sensorId) {
        $key = 'sensor_' . $index;
        $sensorPlaceholders[] = ':' . $key;
        $sensorParams[$key] = $sensorId;
    }
    $sensorClause = implode(', ', $sensorPlaceholders);

    $db->beginTransaction();
    try {
        $deletedReadings = $db->query(
            "DELETE FROM sensor_data WHERE sensor_id IN ({$sensorClause})",
            $sensorParams
        )->rowCount();

        $resetSensors = $db->query(
            "UPDATE sensors SET `last_value` = NULL, last_reading = NULL WHERE sensor_id IN ({$sensorClause})",
            $sensorParams
        )->rowCount();

        $db->commit();
    } catch (Throwable $e) {
        $db->rollback();
        throw $e;
    }

    return [
        'types' => $types,
        'sensor_ids' => $sensorIds,
        'deleted_readings' => $deletedReadings,
        'reset_sensors' => $resetSensors,
    ];
}

function ingestBatchPayload($db, array $input, string $esp32Id, ?string $recordedAt = null): array
{
    $meta = getSensorBlueprints($input);
    $readings = $input['readings'];
    $storedReadings = [];
    $events = [];
    $ignoredReadings = [];
    $sensorsByType = [];

    foreach ($readings as $key => $value) {
        if (!isset($meta[$key])) {
            continue;
        }

        $sensorInfo = $meta[$key];
        $sensor = ensureSensorExists($db, $sensorInfo, $esp32Id);
        $sensorsByType[$key] = $sensor;
        if (!shouldAcceptSensorData($sensor)) {
            $ignoredReadings[] = [
                'sensor_id' => $sensor['sensor_id'],
                'type' => $sensor['type'],
                'value' => normalizeDisplayValue((string) $sensor['type'], $value),
            ];
            continue;
        }

        $storedReadings[] = storeSensorReading($db, $sensor, $value, [
            'status' => inferSensorStatus($sensor['type'], $value, $sensorInfo['threshold_alert'] ?? null),
            'raw_data' => $readings,
        ], $esp32Id, $recordedAt);

        $newEvents = isSensorMonitoringEnabled($sensor)
            ? processSensorEventRules($db, $sensor, $value, $input, $esp32Id)
            : [];
        foreach ($newEvents as $event) {
            $events[] = $event;
        }
    }

    if (!empty($input['event']) && is_array($input['event'])) {
        $eventType = !empty($input['event']['type']) ? sanitize((string) $input['event']['type']) : null;
        $matchedSensor = ($eventType !== null && isset($sensorsByType[$eventType])) ? $sensorsByType[$eventType] : null;
        $event = ($matchedSensor !== null && !isSensorMonitoringEnabled($matchedSensor))
            ? null
            : createAlertFromExplicitEvent($db, $input['event'], $esp32Id, $readings);
        if ($event !== null) {
            $events[] = $event;
        }
    }

    return [
        'stored_readings' => $storedReadings,
        'ignored_readings' => $ignoredReadings,
        'events' => $events,
    ];
}

function getSensorBlueprints(array $input): array
{
    $location = !empty($input['location']) ? sanitize((string) $input['location']) : 'Security Zone';
    $zone = !empty($input['zone']) ? sanitize((string) $input['zone']) : 'Main Zone';

    return [
        'motion' => [
            'sensor_id' => 'PIR-001',
            'name' => 'PIR Motion Sensor',
            'type' => 'motion',
            'location' => $location,
            'zone' => $zone,
            'unit' => 'ON/OFF',
            'threshold_alert' => 1,
        ],
        'vibration' => [
            'sensor_id' => 'VIB-001',
            'name' => 'Vibration Sensor',
            'type' => 'vibration',
            'location' => $location,
            'zone' => $zone,
            'unit' => 'g',
            'threshold_alert' => $input['thresholds']['vibration'] ?? 1.0,
        ],
        'temperature' => [
            'sensor_id' => 'TEMP-001',
            'name' => 'Temperature Sensor',
            'type' => 'temperature',
            'location' => 'Server Room',
            'zone' => $zone,
            'unit' => 'C',
            'threshold_alert' => $input['thresholds']['temperature'] ?? TEMPERATURE_THRESHOLD,
        ],
        'humidity' => [
            'sensor_id' => 'HUM-001',
            'name' => 'Humidity Sensor',
            'type' => 'humidity',
            'location' => 'Server Room',
            'zone' => $zone,
            'unit' => '%',
            'threshold_alert' => $input['thresholds']['humidity'] ?? HUMIDITY_THRESHOLD,
        ],
        'fire' => [
            'sensor_id' => 'FIRE-001',
            'name' => 'Fire Sensor',
            'type' => 'fire',
            'location' => $location,
            'zone' => $zone,
            'unit' => 'ON/OFF',
            'threshold_alert' => 1,
        ],
        'door' => [
            'sensor_id' => 'DOOR-001',
            'name' => 'Door Sensor',
            'type' => 'door',
            'location' => 'Main Entry',
            'zone' => $zone,
            'unit' => 'OPEN/CLOSED',
            'threshold_alert' => 1,
        ],
    ];
}

function ensureSensorExists($db, array $sensorInfo, string $esp32Id): array
{
    $sensorId = $sensorInfo['sensor_id'];
    $sensor = $db->fetch('SELECT * FROM sensors WHERE sensor_id = :sensor_id', ['sensor_id' => $sensorId]);

    if (!$sensor) {
        $db->insert('sensors', [
            'sensor_id' => $sensorId,
            'name' => $sensorInfo['name'],
            'type' => $sensorInfo['type'],
            'location' => $sensorInfo['location'],
            'zone' => $sensorInfo['zone'],
            'status' => 'active',
            'threshold_alert' => $sensorInfo['threshold_alert'] ?? null,
            'unit' => $sensorInfo['unit'] ?? null,
            'esp32_id' => $esp32Id,
        ]);

        $sensor = $db->fetch('SELECT * FROM sensors WHERE sensor_id = :sensor_id', ['sensor_id' => $sensorId]);
    }

    return $sensor;
}

function storeSensorReading($db, array $sensor, $value, array $input, string $esp32Id, ?string $recordedAt = null): array
{
    $recordedAt = $recordedAt ?: date('Y-m-d H:i:s');
    $numericValue = is_bool($value)
        ? ($value ? 1.0 : 0.0)
        : (is_numeric($value) ? (float) $value : null);
    $textValue = normalizeDisplayValue($sensor['type'], $value);
    $status = !empty($input['status']) ? sanitize((string) $input['status']) : inferSensorStatus((string) $sensor['type'], $value, $sensor['threshold_alert'] ?? null);
    $persistedStatus = resolvePersistedSensorStatus($sensor);

    $insertId = $db->insert('sensor_data', [
        'sensor_id' => $sensor['sensor_id'],
        'value' => $textValue,
        'numeric_value' => $numericValue,
        'status' => $status,
        'raw_data' => isset($input['raw_data']) ? json_encode($input['raw_data']) : null,
        'esp32_id' => $esp32Id,
        'recorded_at' => $recordedAt,
    ]);

    $db->update(
        'sensors',
        [
            'last_value' => $textValue,
            'last_reading' => $recordedAt,
            'esp32_id' => $esp32Id,
            'status' => $persistedStatus,
        ],
        'sensor_id = :sensor_id',
        ['sensor_id' => $sensor['sensor_id']]
    );

    return [
        'id' => $insertId,
        'sensor_id' => $sensor['sensor_id'],
        'value' => $textValue,
        'status' => $status,
        'recorded_at' => $recordedAt,
    ];
}

function processSensorEventRules($db, array $sensor, $value, array $input, string $esp32Id): array
{
    if (!isSensorMonitoringEnabled($sensor)) {
        return [];
    }

    $events = [];
    $type = (string) $sensor['type'];
    $location = (string) ($sensor['location'] ?? 'Unknown');
    $threshold = isset($sensor['threshold_alert']) ? (float) $sensor['threshold_alert'] : null;
    if (
        $type === 'vibration'
        && isset($input['thresholds'])
        && is_array($input['thresholds'])
        && array_key_exists('vibration', $input['thresholds'])
        && is_numeric($input['thresholds']['vibration'])
    ) {
        $threshold = (float) $input['thresholds']['vibration'];
    }
    $numericValue = is_numeric($value) ? (float) $value : null;
    $textValue = normalizeDisplayValue($type, $value);

    if ($type === 'motion' && isTruthyValue($value)) {
        $event = createSensorAlertWithDedupe($db, $sensor, [
            'type' => 'motion',
            'severity' => 'high',
            'source' => $sensor['sensor_id'],
            'location' => $location,
            'message' => 'Motion detected. Camera capture, buzzer, LED, lock and valve should activate.',
            'details' => ['esp32_id' => $esp32Id, 'value' => $textValue],
        ]);
        if ($event !== null) {
            $events[] = $event;
        }
    }

    if ($type === 'vibration' && isVibrationAlert($numericValue, $value, $threshold)) {
        $event = createSensorAlertWithDedupe($db, $sensor, [
            'type' => 'vibration',
            'severity' => 'high',
            'source' => $sensor['sensor_id'],
            'location' => $location,
            'message' => $numericValue !== null
                ? 'Suspicious vibration detected: possible tampering (' . $numericValue . ' g)'
                : 'Suspicious vibration detected: possible tampering.',
            'details' => ['esp32_id' => $esp32Id, 'value' => $numericValue ?? $textValue, 'threshold' => $threshold],
        ]);
        if ($event !== null) {
            $events[] = $event;
        }
    }

    if ($type === 'temperature' && $numericValue !== null && $threshold !== null && $numericValue >= $threshold) {
        $isCriticalTemperature = $numericValue > 45.0;
        $event = createSensorAlertWithDedupe($db, $sensor, [
            'type' => 'temperature',
            'severity' => $isCriticalTemperature ? 'critical' : 'high',
            'source' => $sensor['sensor_id'],
            'location' => $location,
            'message' => $isCriticalTemperature
                ? 'Critical: High temperature detected (' . $numericValue . ' C). Risk of overheating.'
                : 'Warning: High temperature detected. Temperature rising (' . $numericValue . ' C). Risk of overheating.',
            'details' => [
                'esp32_id' => $esp32Id,
                'threshold' => $threshold,
                'critical_threshold' => 45.0,
                'value' => $numericValue,
            ],
        ]);
        if ($event !== null) {
            $events[] = $event;
        }
    }

    if ($type === 'fire' && isTruthyValue($value)) {
        $event = createSensorAlertWithDedupe($db, $sensor, [
            'type' => 'fire',
            'severity' => 'critical',
            'source' => $sensor['sensor_id'],
            'location' => $location,
            'message' => 'Fire detected. Emergency response required.',
            'details' => ['esp32_id' => $esp32Id, 'value' => $textValue],
        ]);
        if ($event !== null) {
            $events[] = $event;
        }
    }

    if ($type === 'door' && strtoupper($textValue) === 'OPEN') {
        $event = createSensorAlertWithDedupe($db, $sensor, [
            'type' => 'door',
            'severity' => 'high',
            'source' => $sensor['sensor_id'],
            'location' => $location,
            'message' => 'Warning: Door opened. Unauthorized access detected.',
            'details' => ['esp32_id' => $esp32Id, 'value' => $textValue],
        ]);
        if ($event !== null) {
            $events[] = $event;
        }
    }

    return $events;
}

function isSensorMonitoringEnabled(array $sensor): bool
{
    $status = sanitizeSensorStatus($sensor['status'] ?? 'active');
    return $status === 'active';
}

function shouldAcceptSensorData(array $sensor): bool
{
    return isSensorMonitoringEnabled($sensor);
}

function resolvePersistedSensorStatus(array $sensor): string
{
    $status = sanitizeSensorStatus($sensor['status'] ?? 'active');

    if (in_array($status, ['inactive', 'maintenance', 'error'], true)) {
        return $status;
    }

    return 'active';
}

function createAlertFromExplicitEvent($db, array $event, string $esp32Id, array $readings): ?array
{
    if (empty($event['type'])) {
        return null;
    }

    $type = sanitize((string) $event['type']);
    $severity = !empty($event['severity']) ? sanitize((string) $event['severity']) : 'medium';
    $location = !empty($event['location']) ? sanitize((string) $event['location']) : 'Security Zone';
    $source = !empty($event['source']) ? sanitize((string) $event['source']) : $esp32Id;
    $message = !empty($event['message']) ? sanitize((string) $event['message']) : strtoupper($type) . ' event detected';

    return createSensorAlertWithDedupe($db, ['sensor_id' => $source], [
        'type' => $type,
        'severity' => $severity,
        'source' => $source,
        'location' => $location,
        'message' => $message,
        'details' => [
            'esp32_id' => $esp32Id,
            'readings' => $readings,
            'raw_event' => $event,
        ],
    ]);
}

function createSensorAlertWithDedupe($db, array $sensor, array $payload): ?array
{
    $type = sanitize((string) ($payload['type'] ?? 'custom'));
    $source = sanitize((string) ($payload['source'] ?? ($sensor['sensor_id'] ?? 'SENSOR')));
    $message = sanitize((string) ($payload['message'] ?? 'Alert raised'));
    $details = is_array($payload['details'] ?? null) ? $payload['details'] : [];
    $currentValue = strtoupper(trim((string) ($details['value'] ?? '')));

    $latest = $db->fetch(
        "SELECT created_at, details
         FROM alerts
         WHERE source = :source
           AND type = :type
           AND message = :message
           AND status IN ('active', 'acknowledged')
         ORDER BY created_at DESC
         LIMIT 1",
        [
            'source' => $source,
            'type' => $type,
            'message' => $message,
        ]
    );

    if ($latest) {
        $createdAtTs = strtotime((string) ($latest['created_at'] ?? ''));
        $withinWindow = $createdAtTs !== false && (time() - $createdAtTs) <= SENSOR_ALERT_DEDUPE_WINDOW_SECONDS;

        if ($withinWindow) {
            $lastDetails = json_decode((string) ($latest['details'] ?? 'null'), true);
            $lastValue = strtoupper(trim((string) ($lastDetails['value'] ?? '')));
            if ($currentValue === '' || $lastValue === '' || $currentValue === $lastValue) {
                return null;
            }
        }
    }

    return createAlertWithSideEffects($db, $payload);
}

function validatePayloadTimestamp(array $input): array
{
    $candidates = ['recorded_at', 'timestamp', 'ts', 'device_time', 'captured_at'];

    foreach ($candidates as $field) {
        if (!array_key_exists($field, $input) || $input[$field] === null || $input[$field] === '') {
            continue;
        }

        $raw = trim((string) $input[$field]);
        $timestamp = strtotime($raw);
        if ($timestamp === false) {
            return [
                'has_timestamp' => true,
                'valid' => false,
                'recorded_at' => null,
                'reason' => 'Invalid timestamp format',
            ];
        }

        $now = time();
        if ($timestamp < ($now - SENSOR_TIMESTAMP_MAX_PAST_SECONDS)) {
            return [
                'has_timestamp' => true,
                'valid' => false,
                'recorded_at' => null,
                'reason' => 'Timestamp is too old for live telemetry',
            ];
        }

        if ($timestamp > ($now + SENSOR_TIMESTAMP_MAX_FUTURE_SECONDS)) {
            return [
                'has_timestamp' => true,
                'valid' => false,
                'recorded_at' => null,
                'reason' => 'Timestamp is too far in the future',
            ];
        }

        return [
            'has_timestamp' => true,
            'valid' => true,
            'recorded_at' => date('Y-m-d H:i:s', $timestamp),
            'reason' => null,
        ];
    }

    return [
        'has_timestamp' => false,
        'valid' => true,
        'recorded_at' => null,
        'reason' => null,
    ];
}

function enrichSensorRuntimeState($db, array $sensor): array
{
    $latest = is_array($sensor['latest_reading'] ?? null) ? $sensor['latest_reading'] : null;
    $lastSeenAt = $latest['recorded_at'] ?? ($sensor['last_reading'] ?? null);
    $lastSeenTs = $lastSeenAt ? strtotime((string) $lastSeenAt) : false;
    $ageSeconds = $lastSeenTs !== false ? max(0, time() - $lastSeenTs) : null;
    $monitoringEnabled = isSensorMonitoringEnabled($sensor);
    $isOnline = $monitoringEnabled && $ageSeconds !== null && $ageSeconds <= SENSOR_OFFLINE_TIMEOUT_SECONDS;
    $runtimeStatus = 'offline';

    if (!$monitoringEnabled) {
        $runtimeStatus = 'inactive';
    } elseif ($isOnline) {
        $latestStatus = strtolower(trim((string) ($latest['status'] ?? 'normal')));
        $runtimeStatus = $latestStatus === 'alert' ? 'alert' : 'normal';
    }

    if ($latest !== null) {
        $latest['status'] = $runtimeStatus;
        $sensor['latest_reading'] = $latest;
    }

    if ($monitoringEnabled && !$isOnline && !empty($sensor['sensor_id'])) {
        resolveActiveSensorAlertsOnDisconnect($db, (string) $sensor['sensor_id']);
    }

    $sensor['freshness_timeout_seconds'] = SENSOR_OFFLINE_TIMEOUT_SECONDS;
    $sensor['last_seen_at'] = $lastSeenAt;
    $sensor['timestamp_valid'] = $lastSeenAt !== null && $lastSeenTs !== false;
    $sensor['age_seconds'] = $ageSeconds;
    $sensor['is_online'] = $isOnline;
    $sensor['is_stale'] = !$isOnline;
    $sensor['connection_state'] = $isOnline ? 'online' : 'offline';
    $sensor['runtime_status'] = $runtimeStatus;
    $sensor['is_alert'] = $runtimeStatus === 'alert';

    return $sensor;
}

function resolveActiveSensorAlertsOnDisconnect($db, string $sensorId): void
{
    $db->query(
        "UPDATE alerts
         SET status = 'resolved', resolved_at = NOW()
         WHERE source = :source
           AND status IN ('active', 'acknowledged')",
        ['source' => $sensorId]
    );

    $db->query(
        "UPDATE threats
         SET status = 'resolved', resolved_at = NOW()
         WHERE source = :source
           AND status IN ('active', 'monitoring', 'investigating')",
        ['source' => $sensorId]
    );
}

function inferSensorStatus(string $type, $value, $threshold): string
{
    if (in_array($type, ['motion', 'fire'], true) && isTruthyValue($value)) {
        return 'alert';
    }

    if ($type === 'vibration' && isVibrationAlert(is_numeric($value) ? (float) $value : null, $value, $threshold !== null ? (float) $threshold : null)) {
        return 'alert';
    }

    if ($type === 'door' && strtoupper(normalizeDisplayValue($type, $value)) === 'OPEN') {
        return 'alert';
    }

    if ($type === 'temperature' && is_numeric($value) && $threshold !== null && (float) $value >= (float) $threshold) {
        return 'alert';
    }

    return 'normal';
}

function normalizeDisplayValue(string $type, $value): string
{
    if (is_bool($value)) {
        if ($type === 'door') {
            return $value ? 'OPEN' : 'CLOSED';
        }

        return $value ? 'ON' : 'OFF';
    }

    if (is_numeric($value)) {
        if ($type === 'vibration') {
            return rtrim(rtrim(number_format((float) $value, 2, '.', ''), '0'), '.');
        }

        if (in_array($type, ['motion', 'fire'], true)) {
            return ((float) $value) >= 1 ? 'ON' : 'OFF';
        }

        if ($type === 'door') {
            return ((float) $value) >= 1 ? 'OPEN' : 'CLOSED';
        }
    }

    $normalized = strtoupper(trim(sanitize((string) $value)));

    if ($type === 'door') {
        if (in_array($normalized, ['OPEN', 'ON', 'TRUE', '1', 'DETECTED', 'HIGH'], true)) {
            return 'OPEN';
        }

        if (in_array($normalized, ['CLOSED', 'OFF', 'FALSE', '0', 'CLEAR', 'LOW', 'UNDETECTED'], true)) {
            return 'CLOSED';
        }
    }

    return sanitize((string) $value);
}

function isTruthyValue($value): bool
{
    if (is_bool($value)) {
        return $value;
    }

    if (is_numeric($value)) {
        return (float) $value >= 1;
    }

    $normalized = strtoupper(trim((string) $value));
    return in_array($normalized, ['1', 'ON', 'OPEN', 'TRUE', 'DETECTED'], true);
}

function isVibrationAlert(?float $numericValue, $value, ?float $threshold): bool
{
    if ($numericValue !== null && $threshold !== null) {
        return $numericValue >= $threshold;
    }

    return isTruthyValue($value);
}

function sanitizeSensorStatus($status): string
{
    $normalized = sanitize((string) $status);
    $allowed = ['active', 'inactive', 'maintenance', 'error'];

    if (!in_array($normalized, $allowed, true)) {
        errorResponse('Invalid sensor status');
    }

    return $normalized;
}

