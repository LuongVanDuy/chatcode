# Reusable snippets

These are patterns, not copy-paste contracts. Replace the prefix and verify Bricks-specific APIs against the installed version before use.

## Project prefix helper

```php
function acme_prefix(): string {
    return 'acme';
}
```

In a real project, derive/reuse the established project prefix instead of literally using `acme`.

## Versioned migration runner

```php
function acme_run_bricks_migrations(): void {
    $current = (int) get_option( 'acme_bricks_schema_version', 0 );

    if ( $current < 1 ) {
        // Initial seed belongs in a guarded seed function.
        // Never reseed an existing Builder document here.
        update_option( 'acme_bricks_schema_version', 1, false );
        $current = 1;
    }

    if ( $current < 2 ) {
        $result = acme_migrate_primary_nav_setting();
        if ( $result['status'] === 'changed' || $result['status'] === 'already_applied' ) {
            update_option( 'acme_bricks_schema_version', 2, false );
        }
    }
}
```

Do not advance a marker after conflict or partial CSS/cache failure.

## Compare-and-set element setting

```php
function acme_patch_managed_setting(array $elements, string $element_id, string $key, $expected_old, $new_value): array {
    foreach ($elements as $index => $element) {
        if (($element['id'] ?? '') !== $element_id) {
            continue;
        }

        $settings = is_array($element['settings'] ?? null) ? $element['settings'] : [];
        $current  = $settings[$key] ?? null;

        if ($current === $new_value) {
            return ['status' => 'already_applied', 'elements' => $elements];
        }

        if ($current !== $expected_old) {
            return ['status' => 'conflict', 'reason' => 'builder_value_changed', 'elements' => $elements];
        }

        $elements[$index]['settings'][$key] = $new_value;
        return ['status' => 'changed', 'elements' => $elements];
    }

    return ['status' => 'conflict', 'reason' => 'target_missing', 'elements' => $elements];
}
```

The surrounding code must read/write the current Bricks data using a verified project/Bricks API and validate the whole tree before persistence.

## Tree integrity check

```php
function acme_validate_bricks_tree(array $elements): array {
    $by_id = [];
    foreach ($elements as $element) {
        $id = (string) ($element['id'] ?? '');
        if ($id === '' || isset($by_id[$id])) {
            return ['ok' => false, 'reason' => 'missing_or_duplicate_id'];
        }
        $by_id[$id] = $element;
    }

    foreach ($by_id as $id => $element) {
        $parent = (string) ($element['parent'] ?? '');
        if ($parent !== '' && !isset($by_id[$parent])) {
            return ['ok' => false, 'reason' => 'missing_parent', 'id' => $id];
        }

        foreach ((array) ($element['children'] ?? []) as $child_id) {
            if (!isset($by_id[$child_id])) {
                return ['ok' => false, 'reason' => 'missing_child', 'id' => $id];
            }
            if ((string) ($by_id[$child_id]['parent'] ?? '') !== $id) {
                return ['ok' => false, 'reason' => 'parent_child_mismatch', 'id' => $id, 'child' => $child_id];
            }
        }
    }

    return ['ok' => true];
}
```

Adapt only after inspecting whether the current Bricks export/data shape uses the same root/children representation.

## One menu source

```php
register_nav_menus([
    'primary' => __('Primary navigation', 'project-textdomain'),
]);
```

Both desktop and mobile Bricks layouts should resolve the same `primary` location/menu. Do not seed a second mobile-only menu with duplicated items.

## Scoped enqueue

```php
add_action('wp_enqueue_scripts', function () {
    if (!function_exists('is_product') || !is_product()) {
        return;
    }

    wp_enqueue_style(
        'acme-product',
        get_stylesheet_directory_uri() . '/assets/css/product.css',
        [],
        '1.0.0'
    );
});
```

Use the narrowest reliable page/template condition. Do not enqueue project feature assets globally by default.

## Scoped Woo query filter

```php
function acme_filter_product_query($query_vars, $settings, $element_id) {
    if ($element_id !== 'managed-element-id') {
        return $query_vars;
    }

    // Modify only the intended query vars here.
    return $query_vars;
}
```

The exact Bricks hook signature/filter name must be verified against the installed Bricks version before registration. The important contract is scoping by intended query/element rather than affecting every product query.

## AJAX handler skeleton

```php
add_action('wp_ajax_acme_feature', 'acme_feature_ajax');
add_action('wp_ajax_nopriv_acme_feature', 'acme_feature_ajax');

function acme_feature_ajax(): void {
    check_ajax_referer('acme_feature', 'nonce');

    $value = sanitize_text_field(wp_unslash($_POST['value'] ?? ''));

    wp_send_json_success([
        'value' => $value,
    ]);
}
```

Only expose the nopriv action if unauthenticated use is actually intended. Capability-check privileged mutations.

## Custom Bricks element shape

```php
class Acme_Bricks_Element extends \Bricks\Element {
    public $category = 'general';
    public $name     = 'acme-feature';
    public $icon     = 'ti-layout';

    public function set_controls() {
        $this->controls['title'] = [
            'tab'   => 'content',
            'label' => esc_html__('Title', 'project-textdomain'),
            'type'  => 'text',
        ];
    }

    public function render() {
        $title = (string) ($this->settings['title'] ?? '');
        echo '<div class="acme-feature">';
        echo '<h3>' . esc_html($title) . '</h3>';
        echo '</div>';
    }
}
```

Verify the installed Bricks custom-element registration contract before use. Keep data/query logic in helpers if it grows beyond a trivial render method.

## Responsive CSS baseline

```css
.acme-component {
  min-width: 0;
}

.acme-component__media img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
}

.acme-component__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--acme-gap, 1.5rem);
}

@media (max-width: 991px) {
  .acme-component__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 767px) {
  .acme-component__grid { grid-template-columns: minmax(0, 1fr); }
}
```

Prefer native Bricks responsive controls for values already represented in Builder; use custom CSS when the behavior genuinely belongs in code.
