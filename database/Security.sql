-- =============================================================================
-- JARVIS Security System - MySQL Database Schema (Complete Version)
-- =============================================================================
-- 
-- Database: security_system
-- 
-- =============================================================================

-- Create database
DROP DATABASE IF EXISTS security_system;
CREATE DATABASE IF NOT EXISTS security_system;
USE security_system;

-- =============================================================================
-- USERS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    role ENUM('admin', 'operator', 'viewer') DEFAULT 'operator',
    avatar VARCHAR(255),
    last_login DATETIME,
    login_attempts INT DEFAULT 0,
    locked_until DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default admin user (password: admin123)
DELETE FROM users WHERE username = 'admin';
INSERT INTO users (username, email, password, full_name, role) VALUES
('admin', 'admin@jarvis-security.local', '$2y$10$m3Z6E6igmqWPs4EHDRLd5eBmYbIQT9TI2H4amtvcpCjsmBCqRPPGi', 'System Administrator', 'admin');

-- =============================================================================
-- SENSORS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS sensors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sensor_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    type ENUM('motion', 'vibration', 'temperature', 'humidity', 'fire', 'door', 'window', 'gas', 'custom') NOT NULL,
    location VARCHAR(100),
    zone VARCHAR(50),
    status ENUM('active', 'inactive', 'maintenance', 'error') DEFAULT 'active',
    min_value DECIMAL(10, 2),
    max_value DECIMAL(10, 2),
    threshold_alert DECIMAL(10, 2),
    unit VARCHAR(20),
    last_value TEXT,
    last_reading DATETIME,
    gpio_pin INT,
    esp32_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sensor_id (sensor_id),
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_zone (zone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default sensors
DELETE FROM sensors;
INSERT INTO sensors (sensor_id, name, type, location, zone, status, threshold_alert, unit) VALUES
('PIR-001', 'Motion Sensor 01', 'motion', 'Main Hall', 'Zone A', 'active', 1, 'ON/OFF'),
('VIB-001', 'Vibration Sensor 01', 'vibration', 'Perimeter North', 'Perimeter', 'active', 0.5, 'g'),
('DOOR-001', 'Door Sensor 01', 'door', 'Main Entry', 'Zone A', 'active', 1, 'OPEN/CLOSED'),
('TEMP-001', 'Temperature Sensor 01', 'temperature', 'Server Room', 'Zone C', 'active', 35.0, '°C'),
('FIRE-001', 'Fire Sensor 01', 'fire', 'Main Hall', 'Zone A', 'active', 1, 'ON/OFF');

-- =============================================================================
-- SENSOR_DATA TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS sensor_data (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sensor_id VARCHAR(50) NOT NULL,
    value TEXT,
    numeric_value DECIMAL(10, 2),
    status VARCHAR(50),
    raw_data JSON,
    esp32_id VARCHAR(50),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sensor_id (sensor_id),
    INDEX idx_recorded_at (recorded_at),
    FOREIGN KEY (sensor_id) REFERENCES sensors(sensor_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- LOGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    log_id VARCHAR(50) NOT NULL UNIQUE,
    type ENUM('INFO', 'WARNING', 'ERROR', 'CRITICAL', 'DEBUG', 'SENSOR', 'ACCESS', 'SECURITY', 'SYSTEM') DEFAULT 'INFO',
    category VARCHAR(50),
    source VARCHAR(100),
    message TEXT NOT NULL,
    details JSON,
    severity TINYINT DEFAULT 1 COMMENT '1=Low, 2=Medium, 3=High, 4=Critical',
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    user_id INT,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    resolved_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_source (source),
    INDEX idx_created_at (created_at),
    INDEX idx_severity (severity),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- THREATS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS threats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    threat_id VARCHAR(50) NOT NULL UNIQUE,
    type VARCHAR(100) NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    status ENUM('active', 'monitoring', 'investigating', 'resolved', 'false_positive') DEFAULT 'active',
    source VARCHAR(100),
    location VARCHAR(100),
    description TEXT,
    affected_systems JSON,
    mitigation_steps TEXT,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by INT,
    resolution_notes TEXT,
    blockchain_hash VARCHAR(255),
    INDEX idx_threat_id (threat_id),
    INDEX idx_severity (severity),
    INDEX idx_status (status),
    INDEX idx_detected_at (detected_at),
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- BLOCKCHAIN TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS blockchain (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    block_number INT NOT NULL UNIQUE,
    previous_hash VARCHAR(255) NOT NULL,
    current_hash VARCHAR(255) NOT NULL,
    data_hash VARCHAR(255) NOT NULL,
    event_type VARCHAR(50),
    event_id BIGINT,
    event_data TEXT,
    nonce INT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified BOOLEAN DEFAULT TRUE,
    verified_at TIMESTAMP NULL DEFAULT NULL,
    INDEX idx_block_number (block_number),
    INDEX idx_current_hash (current_hash),
    INDEX idx_event_type (event_type),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Genesis block
DELETE FROM blockchain;
INSERT INTO blockchain (block_number, previous_hash, current_hash, data_hash, event_type, event_data, nonce) VALUES
(0, '0000000000000000000000000000000000000000000000000000000000000000', 
 'GENESIS_BLOCK_JARVIS_SECURITY_SYSTEM_v1.0', 
 'GENESIS_DATA_HASH', 
 'GENESIS', 
 '{"message": "JARVIS Security Blockchain Genesis Block", "version": "1.0.0"}', 
 0);

-- =============================================================================
-- CAMERAS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS cameras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    camera_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(100),
    zone VARCHAR(50),
    type ENUM('esp32-cam', 'ip-camera', 'webcam', 'other') DEFAULT 'esp32-cam',
    ip_address VARCHAR(45),
    port INT,
    resolution VARCHAR(20) DEFAULT '800x600',
    fps INT DEFAULT 15,
    status ENUM('online', 'offline', 'recording', 'error') DEFAULT 'offline',
    recording BOOLEAN DEFAULT FALSE,
    stream_url VARCHAR(255),
    snapshot_url VARCHAR(255),
    last_snapshot_at DATETIME,
    motion_detection_enabled BOOLEAN DEFAULT TRUE,
    night_vision BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_camera_id (camera_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert single ESP32-CAM
DELETE FROM cameras;
INSERT INTO cameras (camera_id, name, location, zone, type, status, resolution) VALUES
('CAM-001', 'ESP32-CAM Main', 'Main Entrance', 'Zone A', 'esp32-cam', 'online', '800x600');

-- =============================================================================
-- ALERTS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alert_id VARCHAR(50) NOT NULL UNIQUE,
    type ENUM('motion', 'fire', 'temperature', 'vibration', 'door', 'intrusion', 'system', 'custom') NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    status ENUM('active', 'acknowledged', 'resolved', 'dismissed') DEFAULT 'active',
    source VARCHAR(100),
    location VARCHAR(100),
    message TEXT NOT NULL,
    details JSON,
    telegram_sent BOOLEAN DEFAULT FALSE,
    telegram_message_id VARCHAR(50),
    acknowledged_at DATETIME,
    acknowledged_by INT,
    resolved_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_alert_id (alert_id),
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- SETTINGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    setting_type ENUM('string', 'integer', 'float', 'boolean', 'json') DEFAULT 'string',
    category VARCHAR(50),
    description VARCHAR(255),
    is_public BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_setting_key (setting_key),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM settings;
INSERT INTO settings (setting_key, setting_value, setting_type, category, description, is_public) VALUES
('system_name', 'JARVIS Security System', 'string', 'general', 'System display name', TRUE),
('security_mode', 'armed', 'string', 'security', 'Current security mode', TRUE),
('temperature_threshold', '35.0', 'float', 'thresholds', 'Temperature alert threshold (°C)', FALSE),
('telegram_enabled', 'true', 'boolean', 'notifications', 'Enable Telegram notifications', FALSE);

-- =============================================================================
-- ACTUATORS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS actuators (
    id INT AUTO_INCREMENT PRIMARY KEY,
    actuator_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    type ENUM('lock', 'valve', 'relay', 'buzzer', 'led', 'alarm', 'custom') NOT NULL,
    location VARCHAR(100),
    zone VARCHAR(50),
    status ENUM('on', 'off', 'active', 'inactive', 'error') DEFAULT 'off',
    gpio_pin INT,
    esp32_id VARCHAR(50),
    last_activated_at DATETIME,
    last_deactivated_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_actuator_id (actuator_id),
    INDEX idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM actuators;
INSERT INTO actuators (actuator_id, name, type, location, zone, status, gpio_pin, esp32_id) VALUES
('LOCK-001', 'Main Door Lock', 'lock', 'Main Entry', 'Zone A', 'off', 22, 'ESP32-MAIN-01'),
('VALVE-001', 'Security Valve', 'valve', 'Server Room', 'Zone A', 'off', 23, 'ESP32-MAIN-01'),
('BUZZER-001', 'Main Alarm Buzzer', 'buzzer', 'Main Hall', 'Zone A', 'off', 26, 'ESP32-MAIN-01'),
('LED-001', 'Warning LED', 'led', 'Main Hall', 'Zone A', 'off', 25, 'ESP32-MAIN-01');

-- =============================================================================
-- USER SESSIONS & ACCESS LOG TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL UNIQUE,
    user_id INT NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_session_id (session_id),
    INDEX idx_user_id (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(50) NOT NULL,
    resource VARCHAR(100),
    resource_id VARCHAR(50),
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    details JSON,
    success BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS access_scan_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    scan_id VARCHAR(40) NOT NULL UNIQUE,
    scan_type VARCHAR(20) NOT NULL,
    scan_value VARCHAR(191) NOT NULL,
    rfid_uid VARCHAR(191),
    fingerprint_id VARCHAR(191),
    expected_value VARCHAR(191),
    user_name VARCHAR(120),
    access_role VARCHAR(80),
    status VARCHAR(20) NOT NULL,
    result_message VARCHAR(255),
    source VARCHAR(80),
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_scan_type_time (scan_type, created_at),
    INDEX idx_scan_status_time (status, created_at),
    INDEX idx_scan_rfid_uid (rfid_uid),
    INDEX idx_scan_fingerprint_id (fingerprint_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- STORED PROCEDURES
-- =============================================================================

DELIMITER //

-- Procedure to add blockchain block
CREATE PROCEDURE AddBlockchainBlock(
    IN p_event_type VARCHAR(50),
    IN p_event_id BIGINT,
    IN p_event_data JSON
)
BEGIN
    DECLARE v_block_number INT;
    DECLARE v_previous_hash VARCHAR(255);
    DECLARE v_data_hash VARCHAR(255);
    DECLARE v_current_hash VARCHAR(255);
    DECLARE v_nonce INT;
    
    -- Get last block number and hash
    SELECT IFNULL(MAX(block_number), 0) INTO v_block_number FROM blockchain;
    SELECT IFNULL(
        (SELECT current_hash FROM blockchain WHERE block_number = v_block_number),
        '0000000000000000000000000000000000000000000000000000000000000000'
    ) INTO v_previous_hash;
    
    -- Increment block number
    SET v_block_number = v_block_number + 1;
    
    -- Calculate data hash (simplified - use proper hashing in production)
    SET v_data_hash = SHA2(CONCAT(p_event_type, p_event_id, JSON_EXTRACT(p_event_data, '$')), 256);
    
    -- Calculate current hash with proof of work (simplified)
    SET v_nonce = 0;
    SET v_current_hash = SHA2(CONCAT(v_previous_hash, v_data_hash, v_nonce), 256);
    
    -- Insert new block
    INSERT INTO blockchain (block_number, previous_hash, current_hash, data_hash, event_type, event_id, event_data, nonce)
    VALUES (v_block_number, v_previous_hash, v_current_hash, v_data_hash, p_event_type, p_event_id, p_event_data, v_nonce);
    
    SELECT v_block_number AS block_number, v_current_hash AS hash;
END //

-- Procedure to verify blockchain integrity
CREATE PROCEDURE VerifyBlockchain()
BEGIN
    DECLARE v_is_valid BOOLEAN DEFAULT TRUE;
    DECLARE v_current_block INT;
    DECLARE v_previous_hash VARCHAR(255);
    DECLARE v_stored_hash VARCHAR(255);
    
    -- Check each block's hash chain
    SET v_current_block = 1;
    
    WHILE v_current_block <= (SELECT MAX(block_number) FROM blockchain) DO
        -- Get stored previous hash
        SELECT previous_hash INTO v_stored_hash 
        FROM blockchain 
        WHERE block_number = v_current_block;
        
        -- Get calculated previous hash (from previous block)
        SELECT current_hash INTO v_previous_hash 
        FROM blockchain 
        WHERE block_number = v_current_block - 1;
        
        -- Compare
        IF v_stored_hash != v_previous_hash THEN
            SET v_is_valid = FALSE;
        END IF;
        
        SET v_current_block = v_current_block + 1;
    END WHILE;
    
    SELECT v_is_valid AS is_valid, 
           (SELECT COUNT(*) FROM blockchain) AS total_blocks,
           (SELECT MAX(block_number) FROM blockchain) AS last_block;
END //

-- Procedure to clean old sensor data
CREATE PROCEDURE CleanOldSensorData(IN p_days INT)
BEGIN
    DELETE FROM sensor_data 
    WHERE recorded_at < DATE_SUB(NOW(), INTERVAL p_days DAY);
    
    SELECT ROW_COUNT() AS deleted_rows;
END //

-- Procedure to clean old logs
CREATE PROCEDURE CleanOldLogs(IN p_days INT)
BEGIN
    DELETE FROM logs 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL p_days DAY);
    
    SELECT ROW_COUNT() AS deleted_rows;
END //

DELIMITER ;

-- =============================================================================
-- TRIGGERS
-- =============================================================================

DELIMITER //

-- Trigger to generate log_id
CREATE TRIGGER before_log_insert
BEFORE INSERT ON logs
FOR EACH ROW
BEGIN
    IF NEW.log_id IS NULL THEN
        SET NEW.log_id = CONCAT('LOG-', DATE_FORMAT(NOW(), '%Y%m%d'), '-', LPAD(FLOOR(RAND() * 100000), 5, '0'));
    END IF;
END //

-- Trigger to generate threat_id
CREATE TRIGGER before_threat_insert
BEFORE INSERT ON threats
FOR EACH ROW
BEGIN
    IF NEW.threat_id IS NULL THEN
        SET NEW.threat_id = CONCAT('THR-', DATE_FORMAT(NOW(), '%Y'), '-', LPAD(FLOOR(RAND() * 1000), 3, '0'));
    END IF;
END //

-- Trigger to generate alert_id
CREATE TRIGGER before_alert_insert
BEFORE INSERT ON alerts
FOR EACH ROW
BEGIN
    IF NEW.alert_id IS NULL THEN
        SET NEW.alert_id = CONCAT('ALT-', DATE_FORMAT(NOW(), '%Y%m%d%H%i%s'), '-', LPAD(FLOOR(RAND() * 1000), 3, '0'));
    END IF;
END //

DELIMITER ;

-- =============================================================================
-- VIEWS
-- =============================================================================

-- View for active threats
CREATE OR REPLACE VIEW v_active_threats AS
SELECT 
    t.id, t.threat_id, t.type, t.severity, t.status, 
    t.source, t.location, t.description, t.detected_at,
    u.full_name AS resolved_by_name
FROM threats t
LEFT JOIN users u ON t.resolved_by = u.id
WHERE t.status IN ('active', 'monitoring', 'investigating')
ORDER BY 
    CASE t.severity 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
    END,
    t.detected_at DESC;

-- View for sensor summary
CREATE OR REPLACE VIEW v_sensor_summary AS
SELECT 
    s.sensor_id, s.name, s.type, s.location, s.zone, s.status,
    s.last_value, s.last_reading, s.unit,
    CASE 
        WHEN s.last_reading > DATE_SUB(NOW(), INTERVAL 5 MINUTE) THEN 'recent'
        WHEN s.last_reading > DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 'recent_hour'
        ELSE 'stale'
    END AS reading_status
FROM sensors s
WHERE s.status = 'active';

-- View for blockchain summary
CREATE OR REPLACE VIEW v_blockchain_summary AS
SELECT 
    COUNT(*) AS total_blocks,
    MAX(block_number) AS last_block_number,
    MAX(timestamp) AS last_block_time,
    SUM(CASE WHEN verified = TRUE THEN 1 ELSE 0 END) AS verified_blocks
FROM blockchain;

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Additional indexes for common queries
CREATE INDEX idx_sensor_data_sensor_time ON sensor_data(sensor_id, recorded_at);
CREATE INDEX idx_logs_type_time ON logs(type, created_at);
CREATE INDEX idx_alerts_status_time ON alerts(status, created_at);

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
