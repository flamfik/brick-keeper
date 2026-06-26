<?php

declare(strict_types=1);

const BK_CONFIG_PATH = __DIR__ . '/config/database.local.php';
const BK_SCHEMA_PATH = __DIR__ . '/schema/mysql.sql';

function bk_assert_local_request(): void
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    if (bk_is_localhost($remote)) {
        return;
    }

    bk_json([
        'ok' => false,
        'error' => 'Database configuration is only available from localhost.',
    ], 403);
}

function bk_assert_private_network_request(): void
{
    $remote = $_SERVER['REMOTE_ADDR'] ?? '';
    if (bk_is_localhost($remote) || bk_is_private_network_address($remote)) {
        return;
    }

    bk_json([
        'ok' => false,
        'error' => 'Brick Keeper database API is only available from this private network.',
    ], 403);
}

function bk_is_localhost(string $address): bool
{
    return $address === '' || $address === '127.0.0.1' || $address === '::1';
}

function bk_is_private_network_address(string $address): bool
{
    if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $parts = array_map('intval', explode('.', $address));
        return $parts[0] === 10
            || ($parts[0] === 172 && $parts[1] >= 16 && $parts[1] <= 31)
            || ($parts[0] === 192 && $parts[1] === 168)
            || ($parts[0] === 169 && $parts[1] === 254);
    }

    if (filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        $normalized = strtolower($address);
        return strpos($normalized, 'fc') === 0
            || strpos($normalized, 'fd') === 0
            || strpos($normalized, 'fe80:') === 0;
    }

    return false;
}

function bk_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function bk_request_json(): array
{
    $body = file_get_contents('php://input');
    if ($body === false || trim($body) === '') {
        return [];
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        bk_json(['ok' => false, 'error' => 'Invalid JSON body.'], 400);
    }

    return $decoded;
}

function bk_read_config(): ?array
{
    if (!is_file(BK_CONFIG_PATH)) {
        return null;
    }

    $config = require BK_CONFIG_PATH;
    return is_array($config) ? $config : null;
}

function bk_public_config(?array $config): ?array
{
    if ($config === null) {
        return null;
    }

    return [
        'host' => (string)($config['host'] ?? '127.0.0.1'),
        'port' => (int)($config['port'] ?? 3306),
        'database' => (string)($config['database'] ?? ''),
        'username' => (string)($config['username'] ?? ''),
        'charset' => (string)($config['charset'] ?? 'utf8mb4'),
    ];
}

function bk_validate_config(array $input, ?array $existing = null): array
{
    $database = trim((string)($input['database'] ?? $existing['database'] ?? 'brick_keeper'));
    if (!preg_match('/^[A-Za-z0-9_]+$/', $database)) {
        bk_json([
            'ok' => false,
            'error' => 'Database name may contain only letters, digits and underscores.',
        ], 400);
    }

    $port = (int)($input['port'] ?? $existing['port'] ?? 3306);
    if ($port < 1 || $port > 65535) {
        bk_json(['ok' => false, 'error' => 'Invalid database port.'], 400);
    }

    $password = array_key_exists('password', $input)
        ? (string)$input['password']
        : (string)($existing['password'] ?? '');
    if ($password === '' && $existing !== null && isset($existing['password']) && !array_key_exists('password', $input)) {
        $password = (string)$existing['password'];
    }

    return [
        'host' => trim((string)($input['host'] ?? $existing['host'] ?? '127.0.0.1')),
        'port' => $port,
        'database' => $database,
        'username' => trim((string)($input['username'] ?? $existing['username'] ?? 'root')),
        'password' => $password,
        'charset' => trim((string)($input['charset'] ?? $existing['charset'] ?? 'utf8mb4')) ?: 'utf8mb4',
    ];
}

function bk_write_config(array $config): void
{
    $directory = dirname(BK_CONFIG_PATH);
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) {
        bk_json(['ok' => false, 'error' => 'Could not create API config directory.'], 500);
    }

    $contents = "<?php\n\nreturn " . var_export($config, true) . ";\n";
    if (file_put_contents(BK_CONFIG_PATH, $contents, LOCK_EX) === false) {
        bk_json(['ok' => false, 'error' => 'Could not write database configuration.'], 500);
    }
}

function bk_pdo(array $config, bool $withDatabase = true): PDO
{
    $dsn = 'mysql:host=' . $config['host'] . ';port=' . $config['port'] . ';charset=' . $config['charset'];
    if ($withDatabase) {
        $dsn .= ';dbname=' . $config['database'];
    }

    return new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function bk_create_database(array $config): void
{
    $pdo = bk_pdo($config, false);
    $database = '`' . str_replace('`', '``', $config['database']) . '`';
    $charset = preg_replace('/[^A-Za-z0-9_]/', '', $config['charset']) ?: 'utf8mb4';
    $pdo->exec("CREATE DATABASE IF NOT EXISTS {$database} CHARACTER SET {$charset} COLLATE {$charset}_unicode_ci");
}

function bk_apply_schema(PDO $pdo): void
{
    $schema = file_get_contents(BK_SCHEMA_PATH);
    if ($schema === false) {
        bk_json(['ok' => false, 'error' => 'MySQL schema file is missing.'], 500);
    }

    foreach (explode(';', $schema) as $statement) {
        $sql = trim($statement);
        if ($sql !== '') {
            $pdo->exec($sql);
        }
    }
}

function bk_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
    );
    $statement->execute([$table]);
    return (int)$statement->fetchColumn() > 0;
}

function bk_database_status(): array
{
    $config = bk_read_config();
    if ($config === null) {
        return [
            'configured' => false,
            'connected' => false,
            'schemaReady' => false,
            'config' => null,
        ];
    }

    try {
        $pdo = bk_pdo($config);
        $schemaReady = bk_table_exists($pdo, 'inventory_items');
        return [
            'configured' => true,
            'connected' => true,
            'schemaReady' => $schemaReady,
            'config' => bk_public_config($config),
        ];
    } catch (Throwable $error) {
        return [
            'configured' => true,
            'connected' => false,
            'schemaReady' => false,
            'config' => bk_public_config($config),
            'error' => $error->getMessage(),
        ];
    }
}

function bk_item_from_row(array $row): array
{
    $catalog = null;
    if (($row['catalog_source_category'] ?? '') !== '' || ($row['catalog_material'] ?? '') !== '') {
        $catalog = [
            'sourceCategory' => $row['catalog_source_category'] ?? '',
            'material' => $row['catalog_material'] ?? '',
        ];
    }

    return [
        'id' => $row['id'],
        'name' => $row['name'],
        'partNumber' => $row['part_number'],
        'category' => $row['category'],
        'color' => $row['color'],
        'quantity' => (int)$row['quantity'],
        'location' => $row['location'],
        'year' => $row['year'] === null ? null : (int)$row['year'],
        'notes' => $row['notes'],
        'image' => $row['image'],
        'catalogImage' => $row['catalog_image'],
        'catalog' => $catalog,
        'createdAt' => $row['created_at'],
        'updatedAt' => $row['updated_at'],
    ];
}

function bk_item_value(array $item, string $key, $default = null)
{
    return array_key_exists($key, $item) ? $item[$key] : $default;
}
