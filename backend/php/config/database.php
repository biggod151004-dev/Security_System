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
    'port' => (int) getEnvOrDefault('DB_PORT', '4000')
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
        }
    }
}

define('DB_HOST', $dbConfig['host']);
define('DB_NAME', $dbConfig['name']);
define('DB_USER', $dbConfig['user']);
define('DB_PASS', $dbConfig['pass']);
define('DB_CHARSET', $dbConfig['charset']);
define('DB_PORT', $dbConfig['port']);



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
