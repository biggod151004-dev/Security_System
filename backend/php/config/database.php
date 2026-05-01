<?php
/**
 * =============================================================================
 * JARVIS Security System - Database Configuration
 * =============================================================================
 * 
 * MySQL Database Connection Class
 * 
 * Author: JARVIS Security System
 * Version: 1.0.0
 */

// Prevent direct access
if (!defined('JARVIS_SECURE')) {
    die('Direct access not permitted');
}

// Database Configuration
function isPlaceholderValue(string $value): bool {
    return preg_match('/^<[^>]+>$/', $value) === 1
        || preg_match('/^YOUR[_-]/i', $value) === 1;
}

function parseBoolValue($value, bool $default = false): bool {
    if ($value === null || $value === false) {
        return $default;
    }

    $normalized = strtolower(trim((string) $value));
    if ($normalized === '') {
        return $default;
    }

    if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
        return true;
    }
    if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
        return false;
    }

    return $default;
}

function isTiDBCloudHost(string $host): bool {
    return stripos($host, 'tidbcloud.com') !== false;
}

function resolveDefaultSslCaPath(): string {
    $candidates = [
         __DIR__ . DIRECTORY_SEPARATOR . 'certs' . DIRECTORY_SEPARATOR . 'isrgrootx1.pem',
        trim((string) ini_get('openssl.cafile')),
        trim((string) ini_get('curl.cainfo')),
        'C:\\xampp\\apache\\bin\\curl-ca-bundle.crt',
        '/etc/ssl/certs/ca-certificates.crt',
        '/etc/ssl/cert.pem',
        '/etc/pki/tls/certs/ca-bundle.crt'
    ];

    foreach ($candidates as $candidate) {
        if ($candidate !== '' && is_file($candidate) && is_readable($candidate)) {
            return $candidate;
        }
    }

    return '';
}

function getEnvOrDefault(string $key, string $default): string {
    $value = getenv($key);
    if ($value === false) {
        return $default;
    }

    $value = trim((string) $value);
    if ($value === '') {
        return $default;
    }

    // Ignore placeholder values often copied from templates.
    if (isPlaceholderValue($value)) {
        return $default;
    }

    return $value;
}

$dbConfig = [
    'host' => getEnvOrDefault('DB_HOST', 'gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com'),
    'name' => getEnvOrDefault('DB_NAME', 'security_system'),
    'user' => getEnvOrDefault('DB_USER', '3aXyNB5EvYK7Qz8.root'),
    'pass' => getEnvOrDefault('DB_PASS', 'obBLoUmeE8rpu8GK'),
    'charset' => getEnvOrDefault('DB_CHARSET', 'utf8mb4'),
    'port' => (int) getEnvOrDefault('DB_PORT', '4000'),
    'ssl_mode' => strtolower(getEnvOrDefault('DB_SSL_MODE', '')),
    'ssl_ca' => trim((string) (getenv('DB_SSL_CA') ?: '')),
    'ssl_verify' => parseBoolValue(getenv('DB_SSL_VERIFY'), true)
];

$databaseUrl = trim((string) (getenv('DATABASE_URL') ?: getenv('DB_URL') ?: ''));
if ($databaseUrl !== '' && !isPlaceholderValue($databaseUrl)) {
    $parts = parse_url($databaseUrl);
    if ($parts !== false && (($parts['scheme'] ?? '') === 'mysql')) {
        if (!empty($parts['host']) && !isPlaceholderValue((string) $parts['host'])) {
            $dbConfig['host'] = (string) $parts['host'];
        }
        if (!empty($parts['port'])) {
            $dbConfig['port'] = (int) $parts['port'];
        }
        if (!empty($parts['user']) && !isPlaceholderValue((string) $parts['user'])) {
            $dbConfig['user'] = urldecode((string) $parts['user']);
        }
        if (array_key_exists('pass', $parts) && !isPlaceholderValue((string) $parts['pass'])) {
            $dbConfig['pass'] = urldecode((string) $parts['pass']);
        }
        if (!empty($parts['path'])) {
            $dbName = ltrim((string) $parts['path'], '/');
            if ($dbName !== '' && !isPlaceholderValue($dbName)) {
                $dbConfig['name'] = $dbName;
            }
        }
        if (!empty($parts['query'])) {
            parse_str((string) $parts['query'], $query);
            if (!empty($query['charset']) && !isPlaceholderValue((string) $query['charset'])) {
                $dbConfig['charset'] = (string) $query['charset'];
            }
            if (!empty($query['sslmode']) && !isPlaceholderValue((string) $query['sslmode'])) {
                $dbConfig['ssl_mode'] = strtolower((string) $query['sslmode']);
            } elseif (!empty($query['ssl_mode']) && !isPlaceholderValue((string) $query['ssl_mode'])) {
                $dbConfig['ssl_mode'] = strtolower((string) $query['ssl_mode']);
            }
            if (!empty($query['ssl_ca']) && !isPlaceholderValue((string) $query['ssl_ca'])) {
                $dbConfig['ssl_ca'] = (string) $query['ssl_ca'];
            } elseif (!empty($query['sslca']) && !isPlaceholderValue((string) $query['sslca'])) {
                $dbConfig['ssl_ca'] = (string) $query['sslca'];
            }
            if (array_key_exists('ssl_verify', $query)) {
                $dbConfig['ssl_verify'] = parseBoolValue($query['ssl_verify'], $dbConfig['ssl_verify']);
            }
        }
    }
}

if (isPlaceholderValue($dbConfig['ssl_ca'])) {
    $dbConfig['ssl_ca'] = '';
}

$sslEnabled = parseBoolValue(getenv('DB_SSL_ENABLED'), false);
if (in_array($dbConfig['ssl_mode'], ['required', 'require', 'verify_ca', 'verify_identity'], true)) {
    $sslEnabled = true;
}
if (!$sslEnabled && isTiDBCloudHost($dbConfig['host'])) {
    $sslEnabled = true;
}

if ($sslEnabled && $dbConfig['ssl_ca'] === '') {
    $dbConfig['ssl_ca'] = resolveDefaultSslCaPath();
}

define('DB_HOST', $dbConfig['host']);
define('DB_NAME', $dbConfig['name']);
define('DB_USER', $dbConfig['user']);
define('DB_PASS', $dbConfig['pass']);
define('DB_CHARSET', $dbConfig['charset']);
define('DB_PORT', $dbConfig['port']);
define('DB_SSL_ENABLED', $sslEnabled);
define('DB_SSL_MODE', $dbConfig['ssl_mode']);
define('DB_SSL_CA', $dbConfig['ssl_ca']);
define('DB_SSL_VERIFY', $dbConfig['ssl_verify']);


/**
 * Database Connection Class
 */
class Database {
    private static $instance = null;
    private $connection;
    
    private function __construct() {
        try {
            $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET . ";port=" . DB_PORT;
            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES " . DB_CHARSET
            ];

            if (DB_SSL_ENABLED) {
                if (defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
                    $verifyServerCert = DB_SSL_VERIFY;
                    if (DB_SSL_MODE === 'required' || DB_SSL_MODE === 'require') {
                        $verifyServerCert = false;
                    }
                    $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = $verifyServerCert;
                }

                if (DB_SSL_CA !== '' && defined('PDO::MYSQL_ATTR_SSL_CA')) {
                    $options[PDO::MYSQL_ATTR_SSL_CA] = DB_SSL_CA;
                }
            }
            
            $this->connection = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            error_log("Database Connection Error: " . $e->getMessage());
            if (defined('APP_DEBUG') && APP_DEBUG) {
                throw new Exception("Database connection failed: " . $e->getMessage(), 0, $e);
            }
            throw new Exception("Database connection failed", 0, $e);
        }
    }
    
    public static function getInstance() {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    public function getConnection() {
        return $this->connection;
    }
    
    public function query($sql, $params = []) {
        try {
            $stmt = $this->connection->prepare($sql);
            $stmt->execute($params);
            return $stmt;
        } catch (PDOException $e) {
            error_log("Query Error: " . $e->getMessage());
            throw $e;
        }
    }
    
    public function fetch($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->fetch();
    }
    
    public function fetchAll($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->fetchAll();
    }
    
    public function insert($table, $data) {
        $keys = array_keys($data);
        $fields = implode(', ', $keys);
        $placeholders = ':' . implode(', :', $keys);
        
        $sql = "INSERT INTO {$table} ({$fields}) VALUES ({$placeholders})";
        $this->query($sql, $data);
        
        return $this->connection->lastInsertId();
    }
    
    public function update($table, $data, $where, $whereParams = []) {
        $sets = [];
        foreach ($data as $key => $value) {
            $sets[] = "{$key} = :{$key}";
        }
        $setClause = implode(', ', $sets);
        
        $sql = "UPDATE {$table} SET {$setClause} WHERE {$where}";
        $params = array_merge($data, $whereParams);
        
        return $this->query($sql, $params)->rowCount();
    }
    
    public function delete($table, $where, $params = []) {
        $sql = "DELETE FROM {$table} WHERE {$where}";
        return $this->query($sql, $params)->rowCount();
    }
    
    public function beginTransaction() {
        return $this->connection->beginTransaction();
    }
    
    public function commit() {
        return $this->connection->commit();
    }
    
    public function rollback() {
        return $this->connection->rollback();
    }
    
    public function lastInsertId() {
        return $this->connection->lastInsertId();
    }
}

/**
 * Helper function to get database instance
 */
function getDB() {
    return Database::getInstance();
}

/**
 * Helper function to get PDO connection
 */
function getPDO() {
    return Database::getInstance()->getConnection();
}
