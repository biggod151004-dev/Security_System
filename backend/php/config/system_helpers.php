<?php
/**
 * Shared helpers for alert, threat, log, blockchain and Telegram workflows.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/database.php';

function createLogId(): string
{
    return 'LOG-' . date('Ymd') . '-' . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT);
}

function createThreatId(): string
{
    return 'THR-' . date('Y') . '-' . str_pad((string) random_int(1, 999), 3, '0', STR_PAD_LEFT);
}

function createAlertId(): string
{
    return 'ALT-' . date('YmdHis') . '-' . str_pad((string) random_int(1, 999), 3, '0', STR_PAD_LEFT);
}

function normalizeSeverityLevel(string $severity): int
{
    return match (strtolower($severity)) {
        'critical' => 4,
        'high' => 3,
        'medium', 'warning' => 2,
        default => 1,
    };
}

function sendTelegramText(string $message): bool
{
    if (!TELEGRAM_ENABLED || TELEGRAM_BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN' || TELEGRAM_CHAT_ID === 'YOUR_TELEGRAM_CHAT_ID') {
        return false;
    }

    $url = 'https://api.telegram.org/bot' . TELEGRAM_BOT_TOKEN . '/sendMessage';
    $payload = json_encode([
        'chat_id' => TELEGRAM_CHAT_ID,
        'text' => $message,
    ]);

    if ($payload === false) {
        return false;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/json\r\n",
            'content' => $payload,
            'timeout' => 8,
        ],
    ]);

    $response = @file_get_contents($url, false, $context);
    return $response !== false;
}

function addBlockchainEntry($db, string $eventType, ?string $eventId, array $data): array
{
    $lastBlock = $db->fetch(
        'SELECT block_number, current_hash FROM blockchain ORDER BY block_number DESC LIMIT 1'
    );

    $blockNumber = ((int) ($lastBlock['block_number'] ?? 0)) + 1;
    $previousHash = $lastBlock['current_hash'] ?? str_repeat('0', 64);

    $eventData = [
        'event_type' => $eventType,
        'event_id' => $eventId,
        'timestamp' => date('c'),
        'data' => $data,
    ];

    $dataHash = hash('sha256', json_encode($eventData));
    $target = str_repeat('0', BLOCKCHAIN_DIFFICULTY);
    $nonce = 0;
    $currentHash = '';

    do {
        $currentHash = hash('sha256', $previousHash . $dataHash . $nonce);
        $nonce++;
    } while (substr($currentHash, 0, BLOCKCHAIN_DIFFICULTY) !== $target && $nonce < 250000);

    $db->insert('blockchain', [
        'block_number' => $blockNumber,
        'previous_hash' => $previousHash,
        'current_hash' => $currentHash,
        'data_hash' => $dataHash,
        'event_type' => $eventType,
        'event_id' => is_numeric($eventId) ? (int) $eventId : null,
        'event_data' => json_encode($eventData),
        'nonce' => $nonce - 1,
        'verified' => true,
        'verified_at' => date('Y-m-d H:i:s'),
    ]);

    return [
        'block_number' => $blockNumber,
        'current_hash' => $currentHash,
    ];
}

function createSystemLog($db, string $type, string $source, string $message, int $severity = 1, array $details = []): string
{
    $logId = createLogId();
    $db->insert('logs', [
        'log_id' => $logId,
        'type' => strtoupper($type),
        'category' => 'security',
        'source' => $source,
        'message' => $message,
        'details' => !empty($details) ? json_encode($details) : null,
        'severity' => $severity,
        'ip_address' => getClientIP(),
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'ESP32',
    ]);

    return $logId;
}

function createThreatFromEvent($db, string $type, string $severity, string $source, string $location, string $description): string
{
    $threatId = createThreatId();
    $db->insert('threats', [
        'threat_id' => $threatId,
        'type' => $type,
        'severity' => $severity,
        'status' => 'active',
        'source' => $source,
        'location' => $location,
        'description' => $description,
    ]);

    return $threatId;
}

function createAlertWithSideEffects($db, array $payload): array
{
    $alertId = createAlertId();
    $type = sanitize((string) ($payload['type'] ?? 'custom'));
    $severity = sanitize((string) ($payload['severity'] ?? 'medium'));
    $source = sanitize((string) ($payload['source'] ?? 'SYSTEM'));
    $location = sanitize((string) ($payload['location'] ?? 'Unknown'));
    $message = sanitize((string) ($payload['message'] ?? 'Alert raised'));
    $details = $payload['details'] ?? [];

    $db->insert('alerts', [
        'alert_id' => $alertId,
        'type' => $type,
        'severity' => $severity,
        'status' => 'active',
        'source' => $source,
        'location' => $location,
        'message' => $message,
        'details' => !empty($details) ? json_encode($details) : null,
    ]);

    $logId = createSystemLog(
        $db,
        strtoupper($severity) === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
        $source,
        $message,
        normalizeSeverityLevel($severity),
        [
            'alert_id' => $alertId,
            'type' => $type,
            'location' => $location,
            'details' => $details,
        ]
    );

    $threatId = null;
    if (in_array($severity, ['high', 'critical', 'medium'], true)) {
        $threatId = createThreatFromEvent($db, $type, $severity, $source, $location, $message);
    }

    $block = addBlockchainEntry($db, strtoupper($type) . '_ALERT', $alertId, [
        'alert_id' => $alertId,
        'log_id' => $logId,
        'threat_id' => $threatId,
        'source' => $source,
        'location' => $location,
        'message' => $message,
        'details' => $details,
    ]);

    $telegramSent = sendTelegramText("[{$severity}] {$type}\n{$message}\nLocation: {$location}");
    if ($telegramSent) {
        $db->update('alerts', ['telegram_sent' => 1], 'alert_id = :alert_id', ['alert_id' => $alertId]);
    }

    return [
        'alert_id' => $alertId,
        'log_id' => $logId,
        'threat_id' => $threatId,
        'block' => $block,
        'telegram_sent' => $telegramSent,
    ];
}
