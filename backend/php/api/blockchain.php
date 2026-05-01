<?php
/**
 * JARVIS Security System - Blockchain API
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
        default:
            errorResponse('Method not allowed', 405);
    }
} catch (Throwable $e) {
    logMessage('ERROR', 'Blockchain API failure', ['error' => $e->getMessage()]);
    errorResponse('Internal server error', 500);
}

function handleGet($db, array $params): void
{
    if (isset($params['block_number'])) {
        $block = $db->fetch(
            'SELECT * FROM blockchain WHERE block_number = :block_number',
            ['block_number' => (int) $params['block_number']]
        );

        if (!$block) {
            errorResponse('Block not found', 404);
        }

        successResponse($block);
    }

    if (!empty($params['hash'])) {
        $block = $db->fetch(
            'SELECT * FROM blockchain WHERE current_hash = :hash',
            ['hash' => sanitize((string) $params['hash'])]
        );

        if (!$block) {
            errorResponse('Block not found', 404);
        }

        successResponse($block);
    }

    if (isset($params['verify'])) {
        successResponse(verifyBlockchain($db));
    }

    if (isset($params['stats'])) {
        $stats = getBlockchainSummary($db);
        $eventTypes = $db->fetchAll(
            "SELECT event_type, COUNT(*) AS count
             FROM blockchain
             WHERE event_type IS NOT NULL
             GROUP BY event_type
             ORDER BY count DESC"
        );
        $recentBlocks = $db->fetchAll(
            "SELECT block_number, event_type, timestamp, current_hash
             FROM blockchain
             ORDER BY block_number DESC
             LIMIT 10"
        );

        successResponse([
            'stats' => $stats,
            'event_types' => $eventTypes,
            'recent_blocks' => $recentBlocks
        ]);
    }

    $page = max(1, (int) ($params['page'] ?? 1));
    $limit = min(100, max(1, (int) ($params['limit'] ?? 50)));
    $offset = ($page - 1) * $limit;
    $queryParams = [];
    $where = '1=1';

    if (!empty($params['event_type'])) {
        $where .= ' AND event_type = :event_type';
        $queryParams['event_type'] = sanitize((string) $params['event_type']);
    }

    $total = (int) ($db->fetch("SELECT COUNT(*) AS count FROM blockchain WHERE {$where}", $queryParams)['count'] ?? 0);
    $blocks = $db->fetchAll(
        "SELECT
            block_number,
            previous_hash,
            current_hash,
            data_hash,
            event_type,
            event_id,
            timestamp,
            verified,
            nonce
         FROM blockchain
         WHERE {$where}
         ORDER BY block_number DESC
         LIMIT {$limit} OFFSET {$offset}",
        $queryParams
    );

    if (!empty($blocks)) {
        $summary = getBlockchainSummary($db);
        $blocks[0]['total_blocks'] = $summary['total_blocks'] ?? $total;
    }

    successResponse([
        'blocks' => $blocks,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'limit' => $limit,
            'pages' => $total > 0 ? (int) ceil($total / $limit) : 0
        ]
    ]);
}

function handlePost($db, array $input): void
{
    if (empty($input['event_type'])) {
        errorResponse('event_type is required');
    }

    $block = addBlock($db, $input);
    successResponse($block, 'Block added successfully');
}

function addBlock($db, array $data): array
{
    $lastBlock = $db->fetch(
        'SELECT block_number, current_hash FROM blockchain ORDER BY block_number DESC LIMIT 1'
    );

    $blockNumber = ((int) ($lastBlock['block_number'] ?? 0)) + 1;
    $previousHash = $lastBlock['current_hash'] ?? str_repeat('0', 64);

    $eventData = [
        'event_type' => sanitize((string) $data['event_type']),
        'timestamp' => date('c'),
        'data' => $data['data'] ?? [],
        'event_id' => $data['event_id'] ?? null
    ];

    $dataHash = hash('sha256', json_encode($eventData));
    $target = str_repeat('0', BLOCKCHAIN_DIFFICULTY);
    $nonce = 0;
    $currentHash = '';
    $maxIterations = 250000;

    do {
        $currentHash = hash('sha256', $previousHash . $dataHash . $nonce);
        $nonce++;
    } while (substr($currentHash, 0, BLOCKCHAIN_DIFFICULTY) !== $target && $nonce < $maxIterations);

    $db->insert('blockchain', [
        'block_number' => $blockNumber,
        'previous_hash' => $previousHash,
        'current_hash' => $currentHash,
        'data_hash' => $dataHash,
        'event_type' => $eventData['event_type'],
        'event_id' => $eventData['event_id'],
        'event_data' => json_encode($eventData),
        'nonce' => $nonce - 1,
        'verified' => true,
        'verified_at' => date('Y-m-d H:i:s')
    ]);

    logMessage('INFO', 'Blockchain block created', [
        'block_number' => $blockNumber,
        'event_type' => $eventData['event_type']
    ]);

    return [
        'block_number' => $blockNumber,
        'current_hash' => $currentHash,
        'previous_hash' => $previousHash,
        'nonce' => $nonce - 1
    ];
}

function verifyBlockchain($db): array
{
    $blocks = $db->fetchAll(
        'SELECT block_number, previous_hash, current_hash, data_hash, nonce FROM blockchain ORDER BY block_number ASC'
    );

    $invalidBlocks = [];
    $validBlocks = 0;

    foreach ($blocks as $index => $block) {
        if ((int) $block['block_number'] === 0) {
            $validBlocks++;
            continue;
        }

        $previousBlock = $blocks[$index - 1] ?? null;
        if ($previousBlock && $block['previous_hash'] !== $previousBlock['current_hash']) {
            $invalidBlocks[] = [
                'block_number' => (int) $block['block_number'],
                'error' => 'Previous hash mismatch'
            ];
            continue;
        }

        $calculatedHash = hash('sha256', $block['previous_hash'] . $block['data_hash'] . $block['nonce']);
        if ($calculatedHash !== $block['current_hash']) {
            $invalidBlocks[] = [
                'block_number' => (int) $block['block_number'],
                'error' => 'Hash verification failed'
            ];
            continue;
        }

        if (substr((string) $block['current_hash'], 0, BLOCKCHAIN_DIFFICULTY) !== str_repeat('0', BLOCKCHAIN_DIFFICULTY)) {
            $invalidBlocks[] = [
                'block_number' => (int) $block['block_number'],
                'error' => 'Proof of work verification failed'
            ];
            continue;
        }

        $validBlocks++;
    }

    $isValid = empty($invalidBlocks);
    if ($isValid) {
        $db->query('UPDATE blockchain SET verified = 1, verified_at = NOW()');
    }

    $totalBlocks = count($blocks);

    return [
        'is_valid' => $isValid,
        'total_blocks' => $totalBlocks,
        'valid_blocks' => $validBlocks,
        'invalid_blocks' => $invalidBlocks,
        'integrity_percentage' => $totalBlocks > 0 ? round(($validBlocks / $totalBlocks) * 100, 2) : 100
    ];
}

function getBlockchainSummary($db): array
{
    return $db->fetch(
        "SELECT
            COUNT(*) AS total_blocks,
            MAX(block_number) AS last_block_number,
            MAX(timestamp) AS last_block_time,
            SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verified_blocks
         FROM blockchain"
    ) ?: [];
}
