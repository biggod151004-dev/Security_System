# JARVIS Security System - XAMPP and MySQL Deployment Guide

This guide installs the PHP backend with XAMPP and connects it to MySQL on Windows.

## 1. Install XAMPP

1. Download and install XAMPP for Windows.
2. Open the XAMPP Control Panel.
3. Start `Apache` and `MySQL`.
4. Confirm:
   - Apache is running on `http://localhost`
   - phpMyAdmin opens at `http://localhost/phpmyadmin`

## 2. Copy the Project into XAMPP

1. Open your XAMPP `htdocs` folder.
   - Default path: `C:\xampp\htdocs`
2. Copy this project folder into `htdocs`.
3. The final path should look like:

```text
C:\xampp\htdocs\jarvis-security-system
```

## 3. Create the Database

1. Open `http://localhost/phpmyadmin`.
2. Click `Import`.
3. Select:

```text
database\Security.sql
```

4. Run the import.
5. Confirm the `jarvis_security` database appears in the left sidebar.

## 4. Check Database Settings

Open:

```text
backend\php\config\database.php
```

Use the default XAMPP MySQL values unless you changed them:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'jarvis_security');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_PORT', 3306);
```

## 5. Launch the Application

Use Apache for the PHP backend and load the frontend from the project folder inside `htdocs`.

Open:

```text
http://localhost/jarvis-security-system/frontend/index.html
```

Login page:

```text
http://localhost/jarvis-security-system/frontend/pages/login.html
```

Default credentials from the SQL seed:

```text
username: admin
password: admin123
```

## 6. Run Frontend Checks

Open PowerShell in:

```text
frontend
```

Run:

```powershell
npm.cmd install
npm.cmd run test
```

More checks:

```powershell
npm.cmd run test:frontend
npm.cmd run test:all
```

## 7. Run PHP Lint Checks

If XAMPP is installed in the default path, run from the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-php.ps1
```

If PHP is not found automatically, set it once:

```powershell
$env:PHP_EXE = 'C:\xampp\php\php.exe'
powershell -ExecutionPolicy Bypass -File .\scripts\test-php.ps1
```

## 8. Manual API Testing

Use these URLs in the browser or Postman:

```text
http://localhost/jarvis-security-system/backend/php/api/auth.php
http://localhost/jarvis-security-system/backend/php/api/sensors.php
http://localhost/jarvis-security-system/backend/php/api/threats.php
http://localhost/jarvis-security-system/backend/php/api/logs.php
http://localhost/jarvis-security-system/backend/php/api/cameras.php
http://localhost/jarvis-security-system/backend/php/api/control.php?status=1
http://localhost/jarvis-security-system/backend/php/api/blockchain.php?stats=1
```

## 9. Recommended Testing Flow

1. Start `Apache` and `MySQL` in XAMPP.
2. Import `database/Security.sql`.
3. Run:

```powershell
npm.cmd run test:frontend
```

4. Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-php.ps1
```

5. Open the login page and sign in.
6. Check each page:
   - Dashboard
   - Sensors
   - Threats
   - Logs
   - Blockchain
   - Control
   - Camera
7. Confirm data loads from MySQL instead of showing only placeholder content.

## 10. Common Problems

### Apache starts but pages do not load

- Confirm the project is inside `C:\xampp\htdocs`
- Confirm the URL includes `/jarvis-security-system/frontend/`

### MySQL starts but login fails

- Re-import `database/Security.sql`
- Check `backend\php\config\database.php`
- Confirm the `users` table contains the `admin` user

### PHP lint script says PHP not found

- Install XAMPP
- Set:

```powershell
$env:PHP_EXE = 'C:\xampp\php\php.exe'
```

### Frontend loads but API requests fail

- Open browser developer tools
- Confirm requests point to:

```text
/jarvis-security-system/backend/php/api/
```

- Confirm Apache is serving the project from `htdocs`

## 11. Production Notes

- Change the default admin password immediately.
- Set `APP_DEBUG` to `false` in:

```text
backend\php\config\config.php
```

- Replace placeholder Telegram settings before enabling alerts.
- Put the project behind HTTPS before exposing it outside localhost.
