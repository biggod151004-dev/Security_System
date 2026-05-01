<?php
/**
 * JARVIS Security System - Threats API
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

session_name(SESSION_NAME);
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

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
    logMessage('ERROR', 'Threats API failure', ['error' => $e->getMessage()]);
    errorResponse('Internal server error', 500);
}

function handleGet($db, array $params): void {
    if (isset($params['threat_id'])) {
        $threat = $db->fetch(
            "SELECT t.*, u.full_name AS resolved_by_name
             FROM threats t
             LEFT JOIN users u ON t.resolved_by = u.id
             WHERE t.threat_id = :threat_id",
            ['threat_id' => sanitize($params['threat_id'])]
        );

        if (!$threat) {
            errorResponse('Threat not found', 404);
        }

        successResponse($threat);
    }

    if (isset($params['stats'])) {
        $stats = $db->fetch(
            "SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high,
                SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) AS medium,
                SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) AS low,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
             FROM threats"
        );

        $byType = $db->fetchAll(
            "SELECT type, COUNT(*) AS count
             FROM threats
             WHERE status != 'resolved'
             GROUP BY type"
        );

        successResponse(['stats' => $stats, 'by_type' => $byType]);
    }

    $where = '1=1';
    $queryParams = [];

    if (!empty($params['severity'])) {
        $where .= ' AND t.severity = :severity';
        $queryParams['severity'] = sanitize($params['severity']);
    }

    if (!empty($params['status'])) {
        $where .= ' AND t.status = :status';
        $queryParams['status'] = sanitize($params['status']);
    }

    if (!empty($params['type'])) {
        $where .= ' AND t.type LIKE :type';
        $queryParams['type'] = '%' . sanitize($params['type']) . '%';
    }

    $page = max(1, (int) ($params['page'] ?? 1));
    $limit = min(100, max(1, (int) ($params['limit'] ?? 50)));
    $offset = ($page - 1) * $limit;

    $total = (int) ($db->fetch("SELECT COUNT(*) AS count FROM threats t WHERE {$where}", $queryParams)['count'] ?? 0);

    $threats = $db->fetchAll(
        "SELECT t.*, u.full_name AS resolved_by_name
         FROM threats t
         LEFT JOIN users u ON t.resolved_by = u.id
         WHERE {$where}
         ORDER BY
            CASE t.severity
                WHEN 'critical' THEN 1
                WHEN 'high' THEN 2
                WHEN 'medium' THEN 3
                ELSE 4
            END,
            t.detected_at DESC
         LIMIT {$limit} OFFSET {$offset}",
        $queryParams
    );

    successResponse([
        'threats' => $threats,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'limit' => $limit,
            'pages' => $total > 0 ? (int) ceil($total / $limit) : 0
        ]
    ]);
}

function handlePost($db, array $input): void {
    $threatId = 'THR-' . date('Y') . '-' . str_pad((string) random_int(1, 999), 3, '0', STR_PAD_LEFT);

    $payload = [
        'threat_id' => $threatId,
        'type' => !empty($input['type']) ? sanitize((string) $input['type']) : 'Unknown',
        'severity' => !empty($input['severity']) ? sanitize((string) $input['severity']) : 'medium',
        'status' => 'active',
        'source' => !empty($input['source']) ? sanitize((string) $input['source']) : 'System',
        'location' => !empty($input['location']) ? sanitize((string) $input['location']) : 'Unknown',
        'description' => !empty($input['description']) ? sanitize((string) $input['description']) : '',
        'affected_systems' => isset($input['affected_systems']) ? json_encode($input['affected_systems']) : null
    ];

    $id = $db->insert('threats', $payload);

    successResponse([
        'id' => $id,
        'threat_id' => $threatId,
        'message' => 'Threat created successfully'
    ]);
}

function handlePut($db, array $input): void {
    if (empty($input['threat_id'])) {
        errorResponse('threat_id is required');
    }

    $threatId = sanitize((string) $input['threat_id']);

    $threat = $db->fetch('SELECT * FROM threats WHERE threat_id = :threat_id', ['threat_id' => $threatId]);
    if (!$threat) {
        errorResponse('Threat not found', 404);
    }

    $allowed = ['status', 'severity', 'mitigation_steps', 'resolution_notes'];
    $updateData = [];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $input)) {
            $updateData[$field] = is_string($input[$field]) ? sanitize($input[$field]) : $input[$field];
        }
    }

    if (($updateData['status'] ?? '') === 'resolved') {
        $updateData['resolved_at'] = date('Y-m-d H:i:s');
        $updateData['resolved_by'] = $_SESSION['user_id'] ?? null;
    }

    if (empty($updateData)) {
        errorResponse('No valid fields to update');
    }

    $db->update('threats', $updateData, 'threat_id = :threat_id', ['threat_id' => $threatId]);

    successResponse(['message' => 'Threat updated successfully']);
}
