# Rams Fx - License System Setup Guide

## Quick Start

### 1. Upload Files to Your Server

Upload the entire `license-server` folder to your web hosting:
```
license-server/
├── api/
│   └── verify.php      ← License API (upload to /api/)
├── server.js            ← Node.js backend (optional)
├── admin-dashboard.html ← Admin panel
└── README.md
```

### 2. Setup Database

Create a MySQL database and update `api/verify.php` with your credentials:
```php
$db_host = 'localhost';
$db_name = 'your_license_db';
$db_user = 'your_db_user';
$db_pass = 'your_db_password';
```

### 3. Update EA License URL

In `GoldHunter_Secure.mq5`, change line 18:
```mql5
#define LICENSE_SERVER_URL "https://yourdomain.com/api/verify.php"
```
Replace `yourdomain.com` with your actual domain.

### 4. Compile & Export EA

1. Open `GoldHunter_Secure.mq5` in MetaTrader 5
2. Press F7 to compile
3. Right-click EA name → "Save as EX5"
4. Upload `.ex5` to your website's download section

---

## Purchase Flow

```
Customer pays → Enters broker account → Your site calls verify.php → 
Returns license key → Customer downloads .ex5 → EA validates on startup
```

### Example WooCommerce Integration

```php
// Add to your theme's functions.php
add_action('woocommerce_thankyou', 'ramsfx_create_license');

function ramsfx_create_license($order_id) {
    $order = wc_get_order($order_id);
    $account_id = get_post_meta($order_id, 'broker_account', true);
    
    // Call license API
    $response = wp_remote_post('https://yourdomain.com/api/verify.php', [
        'body' => [
            'action' => 'activate',
            'account' => $account_id,
            'device' => '',
            'max_devices' => 2
        ]
    ]);
    
    $data = json_decode(wp_remote_retrieve_body($response), true);
    
    if($data['success']) {
        // Show download link + license key
        echo '<a href="/downloads/goldhunter.ex5">Download EA</a>';
        echo '<p>Your License Key: ' . $data['license_key'] . '</p>';
    }
}
```

---

## Admin Dashboard

Access: `https://yourdomain.com/admin-dashboard.html`

Features:
- View all licenses
- Create licenses manually
- Revoke licenses
- Track device registrations

---

## Files Reference

| File | Purpose |
|------|---------|
| `api/verify.php` | License validation API |
| `GoldHunter_Secure.mq5` | Protected EA source code |
| `admin-dashboard.html` | Admin management panel |

---

## Support

For questions, contact Rams Fx support.