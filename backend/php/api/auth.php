<?php
/**
 * JARVIS Security System - Authentication API
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
            handleGet($db);
            break;
        case 'POST':
            handlePost($db, $input);
            break;
        case 'PUT':
            handlePut($db, $input);
            break;
        case 'DELETE':
            handleLogout($db);
            break;
        default:
            errorResponse('Method not allowed', 405);
    }
} catch (Throwable $e) {
    logMessage('ERROR', 'Auth API failure', ['error' => $e->getMessage()]);
    errorResponse(APP_DEBUG ? $e->getMessage() : 'Internal server error', 500);
}

function handleGet($db): void
{
    if (!isset($_SESSION['user_id'])) {
        successResponse([
            'logged_in' => false,
            'user' => null
        ]);
    }

    $user = $db->fetch(
        "SELECT id, username, email, full_name, role, avatar, last_login, created_at
         FROM users
         WHERE id = :id AND is_active = 1",
        ['id' => $_SESSION['user_id']]
    );

    if (!$user) {
        handleLogout($db, false);
    }

    successResponse([
        'logged_in' => true,
        'user' => $user
    ]);
}

function handlePost($db, array $input): void
{
    $action = $input['action'] ?? 'login';

    switch ($action) {
        case 'login':
            handleLogin($db, $input);
            break;
        case 'register':
            handleRegister($db, $input);
            break;
        case 'logout':
            handleLogout($db);
            break;
        case 'forgot_password':
            handleForgotPassword($db, $input);
            break;
        case 'reset_password':
            handleResetPassword($db, $input);
            break;
        default:
            errorResponse('Invalid action', 400);
    }
}

function handlePut($db, array $input): void
{
    if (!isset($_SESSION['user_id'])) {
        errorResponse('Not authenticated', 401);
    }

    $allowedFields = ['full_name', 'email', 'avatar'];
    $updateData = [];

    foreach ($allowedFields as $field) {
        if (array_key_exists($field, $input)) {
            $updateData[$field] = sanitize((string) $input[$field]);
        }
    }

    if (empty($updateData)) {
        errorResponse('No valid fields to update');
    }

    if (isset($updateData['email']) && !filter_var($updateData['email'], FILTER_VALIDATE_EMAIL)) {
        errorResponse('Invalid email address');
    }

    if (isset($updateData['email'])) {
        $existing = $db->fetch(
            'SELECT id FROM users WHERE email = :email AND id != :id',
            ['email' => $updateData['email'], 'id' => $_SESSION['user_id']]
        );

        if ($existing) {
            errorResponse('Email is already in use');
        }
    }

    $db->update('users', $updateData, 'id = :id', ['id' => $_SESSION['user_id']]);
    createAccessLog($db, (int) $_SESSION['user_id'], 'UPDATE_PROFILE', 'user', (string) $_SESSION['user_id']);

    $user = $db->fetch(
        "SELECT id, username, email, full_name, role, avatar, last_login, created_at
         FROM users
         WHERE id = :id",
        ['id' => $_SESSION['user_id']]
    );

    successResponse([
        'user' => $user
    ], 'Profile updated successfully');
}

function handleLogin($db, array $input): void
{
    if (empty($input['username']) || empty($input['password'])) {
        errorResponse('Username and password are required');
    }

    $username = sanitize((string) $input['username']);
    $password = (string) $input['password'];

    $user = $db->fetch(
        "SELECT *
         FROM users
         WHERE (username = :username OR email = :email) AND is_active = 1",
        [
            'username' => $username,
            'email' => $username
        ]
    );

    if (!$user) {
        errorResponse('Invalid username or password', 401);
    }

    if (!empty($user['locked_until']) && strtotime((string) $user['locked_until']) > time()) {
        $remaining = strtotime((string) $user['locked_until']) - time();
        errorResponse("Account locked. Try again in {$remaining} seconds", 403);
    }

    if (!password_verify($password, (string) $user['password'])) {
        $attempts = (int) $user['login_attempts'] + 1;

        if ($attempts >= MAX_LOGIN_ATTEMPTS) {
            $lockUntil = date('Y-m-d H:i:s', time() + LOCKOUT_DURATION);
            $db->update(
                'users',
                ['login_attempts' => $attempts, 'locked_until' => $lockUntil],
                'id = :id',
                ['id' => $user['id']]
            );

            createAccessLog($db, (int) $user['id'], 'LOGIN_LOCKED', 'user', (string) $user['id'], false);
            errorResponse('Too many failed attempts. Account locked temporarily.', 403);
        }

        $db->update(
            'users',
            ['login_attempts' => $attempts],
            'id = :id',
            ['id' => $user['id']]
        );

        createAccessLog($db, (int) $user['id'], 'LOGIN_FAILED', 'user', (string) $user['id'], false);
        errorResponse('Invalid username or password', 401);
    }

    $db->update(
        'users',
        [
            'login_attempts' => 0,
            'locked_until' => null,
            'last_login' => date('Y-m-d H:i:s')
        ],
        'id = :id',
        ['id' => $user['id']]
    );

    session_regenerate_id(true);

    $_SESSION['user_id'] = (int) $user['id'];
    $_SESSION['username'] = $user['username'];
    $_SESSION['role'] = $user['role'];
    $_SESSION['login_time'] = time();

    $sessionId = session_id();
    $existingSession = $db->fetch(
        'SELECT id FROM user_sessions WHERE session_id = :session_id',
        ['session_id' => $sessionId]
    );

    $sessionData = [
        'user_id' => $user['id'],
        'ip_address' => getClientIP(),
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'expires_at' => date('Y-m-d H:i:s', time() + SESSION_LIFETIME),
        'is_active' => true
    ];

    if ($existingSession) {
        $db->update('user_sessions', $sessionData, 'session_id = :session_id', ['session_id' => $sessionId]);
    } else {
        $sessionData['session_id'] = $sessionId;
        $db->insert('user_sessions', $sessionData);
    }

    createAccessLog($db, (int) $user['id'], 'LOGIN', 'user', (string) $user['id']);

    successResponse([
        'user' => [
            'id' => $user['id'],
            'username' => $user['username'],
            'email' => $user['email'],
            'full_name' => $user['full_name'],
            'role' => $user['role'],
            'avatar' => $user['avatar'],
            'last_login' => $user['last_login']
        ],
        'session_id' => $sessionId
    ], 'Login successful');
}

function handleLogout($db, bool $sendResponse = true): void
{
    if (isset($_SESSION['user_id'])) {
        $db->update(
            'user_sessions',
            ['is_active' => 0],
            'session_id = :session_id',
            ['session_id' => session_id()]
        );

        createAccessLog($db, (int) $_SESSION['user_id'], 'LOGOUT', 'user', (string) $_SESSION['user_id']);
    }

    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        $expire = time() - 42000;
        $cookieName = session_name();
        $cookiePath = $params['path'] ?: '/';
        $cookieDomain = $params['domain'] ?? '';
        $cookieSecure = (bool) ($params['secure'] ?? false);
        $cookieHttpOnly = (bool) ($params['httponly'] ?? true);

        // Expire using configured path/domain.
        setcookie($cookieName, '', $expire, $cookiePath, $cookieDomain, $cookieSecure, $cookieHttpOnly);
        // Also expire using root path as a safety net for mismatched cookie paths.
        if ($cookiePath !== '/') {
            setcookie($cookieName, '', $expire, '/', $cookieDomain, $cookieSecure, $cookieHttpOnly);
        }
    }

    session_destroy();

    if ($sendResponse) {
        successResponse([], 'Logged out successfully');
    }

    successResponse([
        'logged_in' => false,
        'user' => null
    ]);
}

function handleRegister($db, array $input): void
{
    if (empty($input['username']) || empty($input['email']) || empty($input['password'])) {
        errorResponse('Username, email, and password are required');
    }

    $username = sanitize((string) $input['username']);
    $email = sanitize((string) $input['email']);
    $password = (string) $input['password'];
    $fullName = !empty($input['full_name']) ? sanitize((string) $input['full_name']) : $username;

    if (!preg_match('/^[a-zA-Z0-9_]{3,20}$/', $username)) {
        errorResponse('Username must be 3-20 characters and contain only letters, numbers, and underscores');
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        errorResponse('Invalid email address');
    }

    if (strlen($password) < PASSWORD_MIN_LENGTH) {
        errorResponse('Password must be at least ' . PASSWORD_MIN_LENGTH . ' characters');
    }

    if ($db->fetch('SELECT id FROM users WHERE username = :username', ['username' => $username])) {
        errorResponse('Username already exists');
    }

    if ($db->fetch('SELECT id FROM users WHERE email = :email', ['email' => $email])) {
        errorResponse('Email already exists');
    }

    $userId = $db->insert('users', [
        'username' => $username,
        'email' => $email,
        'password' => password_hash($password, PASSWORD_DEFAULT),
        'full_name' => $fullName,
        'role' => 'viewer'
    ]);

    createAccessLog($db, (int) $userId, 'REGISTER', 'user', (string) $userId);

    successResponse([
        'user_id' => $userId
    ], 'Registration successful');
}

function handleForgotPassword($db, array $input): void
{
    if (empty($input['email'])) {
        errorResponse('Email is required');
    }

    $email = sanitize((string) $input['email']);
    $user = $db->fetch('SELECT id, username FROM users WHERE email = :email', ['email' => $email]);

    if ($user) {
        $token = generateToken(16);
        logMessage('INFO', 'Password reset requested', [
            'user_id' => $user['id'],
            'username' => $user['username'],
            'token' => $token
        ]);
    }

    successResponse([], 'If the email exists, a reset link has been sent');
}

function handleResetPassword($db, array $input): void
{
    if (empty($input['token']) || empty($input['password'])) {
        errorResponse('Token and new password are required');
    }

    if (strlen((string) $input['password']) < PASSWORD_MIN_LENGTH) {
        errorResponse('Password must be at least ' . PASSWORD_MIN_LENGTH . ' characters');
    }

    successResponse([], 'Password reset flow placeholder completed');
}

function createAccessLog($db, int $userId, string $action, string $resource, string $resourceId, bool $success = true): void
{
    $db->insert('access_log', [
        'user_id' => $userId,
        'action' => $action,
        'resource' => $resource,
        'resource_id' => $resourceId,
        'ip_address' => getClientIP(),
        'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'success' => $success
    ]);
}
