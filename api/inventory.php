<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

bk_assert_private_network_request();

$config = bk_read_config();
if ($config === null) {
    bk_json(['ok' => false, 'error' => 'Database is not configured.'], 503);
}

try {
    $pdo = bk_pdo($config);
    if (!bk_table_exists($pdo, 'inventory_items')) {
        bk_apply_schema($pdo);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $statement = $pdo->query(
            'SELECT id, name, part_number, category, color, quantity, location, year, notes,
                    image, catalog_image, catalog_source_category, catalog_material,
                    created_at, updated_at
             FROM inventory_items
             ORDER BY updated_at DESC, name ASC'
        );
        $items = array_map('bk_item_from_row', $statement->fetchAll());
        bk_json([
            'ok' => true,
            'schemaVersion' => 2,
            'items' => $items,
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
        $input = bk_request_json();
        $items = $input['items'] ?? $input;
        if (!is_array($items)) {
            bk_json(['ok' => false, 'error' => 'Inventory items must be an array.'], 400);
        }

        $pdo->beginTransaction();
        $pdo->exec('DELETE FROM inventory_items');
        $insert = $pdo->prepare(
            'INSERT INTO inventory_items (
                id, name, part_number, category, color, quantity, location, year, notes,
                image, catalog_image, catalog_source_category, catalog_material,
                created_at, updated_at
             ) VALUES (
                :id, :name, :part_number, :category, :color, :quantity, :location, :year, :notes,
                :image, :catalog_image, :catalog_source_category, :catalog_material,
                :created_at, :updated_at
             )'
        );

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $catalog = bk_item_value($item, 'catalog');
            $insert->execute([
                ':id' => (string)bk_item_value($item, 'id', ''),
                ':name' => (string)bk_item_value($item, 'name', ''),
                ':part_number' => (string)bk_item_value($item, 'partNumber', ''),
                ':category' => (string)bk_item_value($item, 'category', ''),
                ':color' => (string)bk_item_value($item, 'color', ''),
                ':quantity' => max(0, (int)bk_item_value($item, 'quantity', 0)),
                ':location' => bk_item_value($item, 'location'),
                ':year' => bk_item_value($item, 'year'),
                ':notes' => bk_item_value($item, 'notes'),
                ':image' => bk_item_value($item, 'image'),
                ':catalog_image' => bk_item_value($item, 'catalogImage'),
                ':catalog_source_category' => is_array($catalog) ? bk_item_value($catalog, 'sourceCategory') : null,
                ':catalog_material' => is_array($catalog) ? bk_item_value($catalog, 'material') : null,
                ':created_at' => bk_item_value($item, 'createdAt'),
                ':updated_at' => bk_item_value($item, 'updatedAt'),
            ]);
        }

        $pdo->commit();
        bk_json(['ok' => true, 'count' => count($items)]);
    }

    bk_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    bk_json(['ok' => false, 'error' => $error->getMessage()], 400);
}
