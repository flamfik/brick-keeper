<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$action = $_GET['action'] ?? 'status';
if ($action === 'status') {
    bk_assert_private_network_request();
} else {
    bk_assert_local_request();
}

try {
    if ($action === 'status') {
        bk_json(['ok' => true] + bk_database_status());
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        bk_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }

    if ($action === 'configure') {
        $input = bk_request_json();
        $existing = bk_read_config();
        $config = bk_validate_config($input, $existing);

        if (!empty($input['createDatabase'])) {
            bk_create_database($config);
        }

        $pdo = bk_pdo($config);
        bk_apply_schema($pdo);
        bk_write_config($config);
        bk_json(['ok' => true] + bk_database_status());
    }

    if ($action === 'initialize') {
        $config = bk_read_config();
        if ($config === null) {
            bk_json(['ok' => false, 'error' => 'Database is not configured.'], 400);
        }

        $pdo = bk_pdo($config);
        bk_apply_schema($pdo);
        bk_json(['ok' => true] + bk_database_status());
    }

    bk_json(['ok' => false, 'error' => 'Unknown database action.'], 404);
} catch (Throwable $error) {
    bk_json(['ok' => false, 'error' => $error->getMessage()], 400);
}
