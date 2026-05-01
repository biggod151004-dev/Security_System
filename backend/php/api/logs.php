<?php
/**
 * JARVIS Security System - Logs API
 */

declare(strict_types=1);

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/database.php';

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
        case 'DELETE':
            handleDelete($db, $input);
            break;
        default:
            errorResponse('Method not allowed', 405);
    }
} catch (Throwable $e) {
    logMessage('ERROR', 'Logs API failure', ['error' => $e->getMessage()]);
    errorResponse('Internal server error', 500);
}

function handleGet($db, array $params): void {
    if (isset($params['log_id'])) {
        $log = $db->fetch(
            "SELECT l.*, u.username AS resolved_by_username
             FROM logs l
             LEFT JOIN users u ON l.resolved_by = u.id
             WHERE l.log_id = :log_id",
            ['log_id' => sanitize($params['log_id'])]
        );

        if (!$log) {
            errorResponse('Log not found', 404);
        }

        successResponse($log);
    }

    $where = '1=1';
    $queryParams = [];

    if (!empty($params['type'])) {
        $where .= ' AND l.type = :type';
        $queryParams['type'] = sanitize($params['type']);
    }

    if (!empty($params['source'])) {
        $where .= ' AND l.source LIKE :source';
        $queryParams['source'] = '%' . sanitize($params['source']) . '%';
    }

    if (isset($params['severity'])) {
        $where .= ' AND l.severity = :severity';
        $queryParams['severity'] = (int) $params['severity'];
    }

    if (!empty($params['start_date'])) {
        $where .= ' AND l.created_at >= :start_date';
        $queryParams['start_date'] = sanitize($params['start_date']);
    }

    if (!empty($params['end_date'])) {
        $where .= ' AND l.created_at <= :end_date';
        $queryParams['end_date'] = sanitize($params['end_date']);
    }

    if (isset($params['resolved'])) {
        $where .= ' AND l.resolved = :resolved';
        $queryParams['resolved'] = $params['resolved'] === 'true' ? 1 : 0;
    }

    if (!empty($params['search'])) {
        $where .= ' AND (l.message LIKE :search_message OR l.source LIKE :search_source)';
        $searchValue = '%' . sanitize($params['search']) . '%';
        $queryParams['search_message'] = $searchValue;
        $queryParams['search_source'] = $searchValue;
    }

    $total = (int) ($db->fetch("SELECT COUNT(*) AS total FROM logs l WHERE {$where}", $queryParams)['total'] ?? 0);

    $page = max(1, (int) ($params['page'] ?? 1));
    $limit = min(100, max(1, (int) ($params['limit'] ?? 50)));
    $offset = ($page - 1) * $limit;

    $sortBy = $params['sort_by'] ?? 'created_at';
    $sortOrder = strtoupper($params['sort_order'] ?? 'DESC');

    $allowedSortFields = ['created_at', 'type', 'severity', 'source'];
    if (!in_array($sortBy, $allowedSortFields, true)) {
        $sortBy = 'created_at';
    }
    if (!in_array($sortOrder, ['ASC', 'DESC'], true)) {
        $sortOrder = 'DESC';
    }

    $logs = $db->fetchAll(
        "SELECT l.*, u.username AS resolved_by_username
         FROM logs l
         LEFT JOIN users u ON l.resolved_by = u.id
         WHERE {$where}
         ORDER BY {$sortBy} {$sortOrder}
         LIMIT {$limit} OFFSET {$offset}",
        $queryParams
    );

    $stats = $db->fetch(
        "SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN type = 'INFO' THEN 1 ELSE 0 END) AS info,
            SUM(CASE WHEN type = 'WARNING' THEN 1 ELSE 0 END) AS warnings,
            SUM(CASE WHEN type = 'ERROR' THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN type = 'CRITICAL' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) AS unresolved
         FROM logs
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
    );

    successResponse([
        'logs' => $logs,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'limit' => $limit,
            'pages' => $total > 0 ? (int) ceil($total / $limit) : 0
        ],
        'stats' => $stats
    ]);
}

function handlePost($db, array $input): void {
    if (empty($input['message'])) {
        errorResponse('message is required');
    }

    $logId = 'LOG-' . date('Ymd') . '-' . str_pad((string) random_int(1, 99999), 5, '0', STR_PAD_LEFT);

    $payload = [
        'log_id' => $logId,
        'type' => !empty($input['type']) ? sanitize((string) $input['type']) : 'INFO',
        'category' => !empty($input['category']) ? sanitize((string) $input['category']) : null,
        'source' => !empty($input['source']) ? sanitize((string) $input['source']) : 'SYSTEM',
        'message' => sanitize((string) $input['message']),
        'details' => isset($input['details']) ? json_encode($input['details']) : null,
        'severity' => isset($input['severity']) ? (int) $input['severity'] : 1,
        'ip_address' => getClientIP(),
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null
    ];

    $id = $db->insert('logs', $payload);

    successResponse([
        'id' => $id,
        'log_id' => $logId,
        'message' => 'Log entry created successfully'
    ]);
}

function handleDelete($db, array $input): void {
    $days = isset($input['days']) ? max(1, (int) $input['days']) : LOG_RETENTION_DAYS;

    // MySQL does not accept parameter placeholders in INTERVAL clauses reliably.
    $deleted = $db->query("DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL {$days} DAY)")->rowCount();

    logMessage('INFO', "Deleted {$deleted} log entries", ['older_than_days' => $days]);

    successResponse([
        'deleted' => $deleted,
        'message' => "Deleted {$deleted} log entries older than {$days} days"
    ]);
}
