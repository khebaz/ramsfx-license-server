<?php
/**
 * Rams Fx License Verification API
 * Handles license validation, activation, and device tracking
 */

// Database configuration - UPDATE THESE
$db_host = 'localhost';
$db_name = 'your_license_db';
$db_user = 'your_db_user';
$db_pass = 'your_db_password';

$pdo = new PDO("mysql:host=$db_host;dbname=$db_name", $db_user, $db_pass);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Initialize database tables
initDatabase($pdo);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET');
header('Access-Control-Allow-Headers: Content-Type');

// Get request data
$action = $_POST['action'] ?? $_GET['action'] ?? '';
$license_key = $_POST['license'] ?? $_GET['license'] ?? '';
$account_id = $_POST['account'] ?? $_GET['account'] ?? '';
$device_id = $_POST['device'] ?? $_GET['device'] ?? '';
$max_devices = isset($_POST['max_devices']) ? (int)$_POST['max_devices'] : 2;

switch($action) {
    case 'validate':
        handleValidate($pdo, $license_key, $account_id, $device_id);
        break;
    case 'activate':
        handleActivate($pdo, $license_key, $account_id, $device_id, $max_devices);
        break;
    case 'deactivate':
        handleDeactivate($pdo, $license_key, $device_id);
        break;
    case 'status':
        handleStatus($pdo, $license_key, $account_id);
        break;
    default:
        echo json_encode(['error' => 'Invalid action']);
}

function initDatabase($pdo) {
    $sql = "
    CREATE TABLE IF NOT EXISTS licenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        license_key VARCHAR(100) UNIQUE NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        max_devices INT DEFAULT 2,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL,
        INDEX idx_license (license_key),
        INDEX idx_account (account_id)
    );
    
    CREATE TABLE IF NOT EXISTS devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        license_id INT NOT NULL,
        device_id VARCHAR(100) NOT NULL,
        account_id VARCHAR(50) NOT NULL,
        first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active TINYINT(1) DEFAULT 1,
        FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
        INDEX idx_device (device_id),
        INDEX idx_license (license_id)
    );
    ";
    $pdo->exec($sql);
}

function handleValidate($pdo, $license_key, $account_id, $device_id) {
    if(empty($license_key) || empty($account_id) || empty($device_id)) {
        echo json_encode(['success' => false, 'message' => 'Missing parameters']);
        return;
    }
    
    // Find the license
    $stmt = $pdo->prepare("SELECT * FROM licenses WHERE license_key = ? AND account_id = ? AND is_active = 1");
    $stmt->execute([$license_key, $account_id]);
    $license = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if(!$license) {
        echo json_encode(['success' => false, 'message' => 'Invalid license or account']);
        return;
    }
    
    // Count active devices
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM devices WHERE license_id = ? AND is_active = 1");
    $stmt->execute([$license['id']]);
    $device_count = (int)$stmt->fetchColumn();
    
    // Check if this device is already registered
    $stmt = $pdo->prepare("SELECT * FROM devices WHERE license_id = ? AND device_id = ? AND is_active = 1");
    $stmt->execute([$license['id'], $device_id]);
    $existing_device = $stmt->fetch(PDO::FETCH_ASSOCOC);
    
    if($existing_device) {
        // Update last seen
        $stmt = $pdo->prepare("UPDATE devices SET last_seen = NOW() WHERE id = ?");
        $stmt->execute([$existing_device['id']]);
        
        echo json_encode([
            'valid' => true,
            'message' => 'Device validated',
            'devices_used' => $device_count,
            'max_devices' => $license['max_devices']
        ]);
        return;
    }
    
    // Check if device limit reached
    if($device_count >= $license['max_devices']) {
        echo json_encode([
            'valid' => false,
            'message' => "Device limit reached. Max {$license['max_devices']} devices allowed."
        ]);
        return;
    }
    
    // Register new device
    $stmt = $pdo->prepare("INSERT INTO devices (license_id, device_id, account_id) VALUES (?, ?, ?)");
    $stmt->execute([$license['id'], $device_id, $account_id]);
    
    echo json_encode([
        'valid' => true,
        'message' => 'Device registered',
        'devices_used' => $device_count + 1,
        'max_devices' => $license['max_devices']
    ]);
}

function handleActivate($pdo, $license_key, $account_id, $device_id, $max_devices) {
    if(empty($account_id) || empty($device_id)) {
        echo json_encode(['success' => false, 'message' => 'Missing parameters']);
        return;
    }
    
    // If license key provided, check if it exists
    if(!empty($license_key)) {
        $stmt = $pdo->prepare("SELECT * FROM licenses WHERE license_key = ?");
        $stmt->execute([$license_key]);
        $existing = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if($existing) {
            if($existing['account_id'] != $account_id) {
                echo json_encode(['success' => false, 'message' => 'License already used with different account']);
                return;
            }
            
            // Register device for existing license
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM devices WHERE license_id = ? AND is_active = 1");
            $stmt->execute([$existing['id']]);
            $device_count = (int)$stmt->fetchColumn();
            
            if($device_count >= $existing['max_devices']) {
                echo json_encode(['success' => false, 'message' => 'Device limit reached']);
                return;
            }
            
            $stmt = $pdo->prepare("INSERT INTO devices (license_id, device_id, account_id) VALUES (?, ?, ?)");
            $stmt->execute([$existing['id'], $device_id, $account_id]);
            
            echo json_encode([
                'success' => true,
                'activated' => true,
                'license_key' => $license_key,
                'message' => 'Device registered'
            ]);
            return;
        }
    }
    
    // Generate new license key if not provided
    if(empty($license_key)) {
        $license_key = generateLicenseKey();
    }
    
    // Create new license
    $stmt = $pdo->prepare("INSERT INTO licenses (license_key, account_id, max_devices) VALUES (?, ?, ?)");
    $stmt->execute([$license_key, $account_id, $max_devices]);
    
    $license_id = $pdo->lastInsertId();
    
    // Register first device
    $stmt = $pdo->prepare("INSERT INTO devices (license_id, device_id, account_id) VALUES (?, ?, ?)");
    $stmt->execute([$license_id, $device_id, $account_id]);
    
    echo json_encode([
        'success' => true,
        'activated' => true,
        'license_key' => $license_key,
        'account_id' => $account_id,
        'max_devices' => $max_devices,
        'message' => 'License created and device registered'
    ]);
}

function handleDeactivate($pdo, $license_key, $device_id) {
    if(empty($license_key) || empty($device_id)) {
        echo json_encode(['success' => false, 'message' => 'Missing parameters']);
        return;
    }
    
    $stmt = $pdo->prepare("
        UPDATE devices SET is_active = 0 
        WHERE device_id = ? 
        AND license_id = (SELECT id FROM licenses WHERE license_key = ?)
    ");
    $stmt->execute([$device_id, $license_key]);
    
    echo json_encode(['success' => true, 'message' => 'Device deactivated']);
}

function handleStatus($pdo, $license_key, $account_id) {
    $stmt = $pdo->prepare("SELECT * FROM licenses WHERE license_key = ? OR account_id = ?");
    $stmt->execute([$license_key, $account_id]);
    $license = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if(!$license) {
        echo json_encode(['exists' => false]);
        return;
    }
    
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM devices WHERE license_id = ? AND is_active = 1");
    $stmt->execute([$license['id']]);
    $device_count = (int)$stmt->fetchColumn();
    
    echo json_encode([
        'exists' => true,
        'license_key' => $license['license_key'],
        'account_id' => $license['account_id'],
        'max_devices' => $license['max_devices'],
        'devices_used' => $device_count,
        'is_active' => (bool)$license['is_active']
    ]);
}

function generateLicenseKey() {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $key = '';
    for($i = 0; $i < 36; $i++) {
        if($i == 8 || $i == 13 || $i == 18 || $i == 23) $key .= '-';
        $key .= $chars[rand(0, strlen($chars) - 1)];
    }
    return $key;
}
?>