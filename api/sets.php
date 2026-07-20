<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

bk_assert_private_network_request();

$config = bk_read_config();
if ($config === null) {
    bk_json(['ok' => false, 'error' => 'Database is not configured.'], 503);
}

$action = $_GET['action'] ?? 'buildable';
if ($action !== 'buildable' || $_SERVER['REQUEST_METHOD'] !== 'GET') {
    bk_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

try {
    $pdo = bk_pdo($config);
    if (!bk_table_exists($pdo, 'inventory_items')) {
        bk_apply_schema($pdo);
    }

    if (!bk_reference_tables_ready($pdo)) {
        bk_json([
            'ok' => true,
            'referenceReady' => false,
            'sets' => [],
        ]);
    }

    $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));
    $statement = $pdo->query(
        "WITH owned AS (
            SELECT LOWER(TRIM(part_number)) AS part_number, color, SUM(quantity) AS quantity
            FROM inventory_items
            WHERE quantity > 0
            GROUP BY LOWER(TRIM(part_number)), color
        ),
        owned_total AS (
            SELECT COALESCE(SUM(quantity), 0) AS quantity
            FROM inventory_items
            WHERE quantity > 0
        )
        SELECT s.set_number, s.name, s.year, s.num_parts, s.image_url, s.inventory_id
        FROM sets s
        JOIN set_parts sp ON sp.inventory_id = s.inventory_id
        LEFT JOIN owned o ON o.part_number = LOWER(TRIM(sp.part_number)) AND o.color = sp.color
        CROSS JOIN owned_total total
        WHERE COALESCE(s.num_parts, 0) > 0
          AND COALESCE(s.num_parts, 0) <= total.quantity
        GROUP BY s.set_number, s.name, s.year, s.num_parts, s.image_url, s.inventory_id
        HAVING SUM(CASE WHEN COALESCE(o.quantity, 0) >= sp.quantity THEN 0 ELSE 1 END) = 0
        ORDER BY COALESCE(s.num_parts, 0) DESC, s.set_number ASC
        LIMIT {$limit}"
    );

    bk_json([
        'ok' => true,
        'referenceReady' => true,
        'sets' => array_map('bk_set_from_row', $statement->fetchAll()),
    ]);
} catch (Throwable $error) {
    bk_json(['ok' => false, 'error' => $error->getMessage()], 400);
}

function bk_reference_tables_ready(PDO $pdo): bool
{
    foreach (['sets', 'set_parts'] as $table) {
        if (!bk_table_exists($pdo, $table)) {
            return false;
        }
    }

    $sets = (int)$pdo->query('SELECT COUNT(*) FROM sets')->fetchColumn();
    $setParts = (int)$pdo->query('SELECT COUNT(*) FROM set_parts')->fetchColumn();
    return $sets > 0 && $setParts > 0;
}

function bk_set_from_row(array $row): array
{
    return [
        'setNumber' => $row['set_number'],
        'name' => $row['name'],
        'year' => $row['year'] === null ? null : (int)$row['year'],
        'numParts' => $row['num_parts'] === null ? null : (int)$row['num_parts'],
        'imageUrl' => $row['image_url'],
        'inventoryId' => (int)$row['inventory_id'],
    ];
}
