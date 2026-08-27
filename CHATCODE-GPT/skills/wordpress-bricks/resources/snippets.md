# Reusable WordPress + Bricks snippets

These are project-independent implementation patterns. Before using Bricks internal constants/classes/methods, verify they exist and match the installed Bricks version. Derive the real project prefix instead of copying a prefix from an example.

## Generate a native-shape unique element ID

```php
function project_generate_bricks_id(array $elements): string {
    $used = [];

    foreach ($elements as $element) {
        $id = (string) ($element['id'] ?? '');
        if ($id !== '') {
            $used[$id] = true;
        }
    }

    $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

    do {
        $id = '';
        for ($i = 0; $i < 6; $i++) {
            $id .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
    } while (isset($used[$id]));

    return $id;
}
```

Rename `project_` to the current project's established prefix before implementation. Do not regenerate stable IDs that do not need to change.

## Validate parent/children integrity

```php
function project_validate_bricks_tree(array $elements): array {
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
                return ['ok' => false, 'reason' => 'missing_child', 'id' => $id, 'child' => $child_id];
            }

            if ((string) ($by_id[$child_id]['parent'] ?? '') !== $id) {
                return ['ok' => false, 'reason' => 'parent_child_mismatch', 'id' => $id, 'child' => $child_id];
            }
        }
    }

    return ['ok' => true];
}
```

## Compare-and-set one managed setting

```php
function project_patch_managed_setting(
    array $elements,
    string $element_id,
    string $key,
    mixed $expected_old,
    mixed $new_value
): array {
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
            return [
                'status' => 'conflict',
                'reason' => 'builder_value_changed',
                'current' => $current,
                'elements' => $elements,
            ];
        }

        $elements[$index]['settings'][$key] = $new_value;
        return ['status' => 'changed', 'elements' => $elements];
    }

    return ['status' => 'conflict', 'reason' => 'target_missing', 'elements' => $elements];
}
```

Example migration: pass `medium_large` as expected old and `large` as new for `imageSize`. If current Builder value differs, preserve it.

## Delete one element without reseeding

```php
function project_remove_bricks_element(array $elements, string $remove_id): array {
    $target = null;

    foreach ($elements as $element) {
        if (($element['id'] ?? '') === $remove_id) {
            $target = $element;
            break;
        }
    }

    if (!$target) {
        return ['status' => 'already_absent', 'elements' => $elements];
    }

    if (!empty($target['children'])) {
        return ['status' => 'conflict', 'reason' => 'target_has_children', 'elements' => $elements];
    }

    $parent_id = (string) ($target['parent'] ?? '');
    $next = [];

    foreach ($elements as $element) {
        if (($element['id'] ?? '') === $remove_id) {
            continue;
        }

        if (($element['id'] ?? '') === $parent_id) {
            $element['children'] = array_values(array_filter(
                (array) ($element['children'] ?? []),
                static fn ($id) => $id !== $remove_id
            ));
        }

        $next[] = $element;
    }

    return ['status' => 'changed', 'elements' => $next];
}
```

For a parent/subtree deletion, explicitly define descendant behavior instead of silently dropping or reparenting children.

## Real Bricks template condition shapes

```php
$global = [
    'templateConditions' => [
        ['main' => 'any'],
    ],
];

$single_post = [
    'templateConditions' => [[
        'main' => 'postType',
        'postType' => ['post'],
    ]],
];

$single_product = [
    'templateConditions' => [[
        'main' => 'postType',
        'postType' => ['product'],
    ]],
];

$taxonomy_archive = [
    'templateConditions' => [[
        'main' => 'archiveType',
        'archiveType' => ['term'],
        'archiveTerms' => [$taxonomy . '::all'],
        'archiveTermsIncludeChildren' => true,
    ]],
];
```

Resolve `$taxonomy` from the current project; do not hard-code another site's taxonomy.

## Real Bricks template persistence checklist

Before writing a real template, verify the installed version exposes the expected Bricks constants/contracts:

```php
$required = [
    'BRICKS_DB_TEMPLATE_SLUG',
    'BRICKS_DB_TEMPLATE_TYPE',
    'BRICKS_DB_PAGE_CONTENT',
    'BRICKS_DB_HEADER',
    'BRICKS_DB_FOOTER',
    'BRICKS_DB_TEMPLATE_SETTINGS',
];
```

Use the actual Bricks template post/storage mechanism already present in the installed version/project. Store the tree in the matching `content`, `header`, or `footer` Bricks data context and store template settings/conditions using `BRICKS_DB_TEMPLATE_SETTINGS` contract. Do not invent a Page PHP fallback if a real Bricks template is required.

## Bricks CSS regeneration transaction

```php
function project_refresh_bricks_output(int $post_id, string $context): void {
    clean_post_cache($post_id);

    if (
        class_exists('\\Bricks\\Database') &&
        class_exists('\\Bricks\\Assets_Files') &&
        \Bricks\Database::get_setting('cssLoading') === 'file'
    ) {
        // Call \Bricks\Assets_Files::generate_post_css_file(...)
        // with the installed-version signature and the correct
        // context: content, header, or footer.
    }
}
```

Do not mark the migration complete until the actual `generate_post_css_file(...)` call succeeds when file CSS mode is active.

## One real WordPress nav menu source

```php
register_nav_menus([
    'primary' => __('Primary navigation', 'project-textdomain'),
]);

$locations = get_nav_menu_locations();
$primary_menu_id = isset($locations['primary']) ? (int) $locations['primary'] : 0;
```

Use `wp_create_nav_menu()` / `wp_update_nav_menu_item()` only for first seed or an explicit targeted menu migration. Desktop/mobile must point to the same menu source.

## Discover Woo assigned pages

```php
$shop_id     = wc_get_page_id('shop');
$cart_id     = wc_get_page_id('cart');
$checkout_id = wc_get_page_id('checkout');

$cart_url     = wc_get_page_permalink('cart');
$checkout_url = wc_get_page_permalink('checkout');
```

Never assume Woo page IDs or slugs.

## Discover public product taxonomies

```php
$taxonomies = get_object_taxonomies('product', 'objects');
$public = [];

foreach ($taxonomies as $name => $taxonomy) {
    if (in_array($name, ['product_type', 'product_visibility'], true)) {
        continue;
    }

    if (!empty($taxonomy->public) || !empty($taxonomy->publicly_queryable)) {
        $public[$name] = $taxonomy;
    }
}
```

Use Woo attribute APIs as additional discovery when the task targets product attributes.

## Scoped asset enqueue with filemtime

```php
add_action('wp_enqueue_scripts', function (): void {
    if (!function_exists('is_product') || !is_product()) {
        return;
    }

    $relative = '/assets/css/product.css';
    $file = get_stylesheet_directory() . $relative;

    wp_enqueue_style(
        'project-product',
        get_stylesheet_directory_uri() . $relative,
        [],
        is_file($file) ? (string) filemtime($file) : null
    );
});
```

Rename handles/classes to the current project prefix. Add a verified Bricks Builder/editor-context guard when frontend-only assets interfere with Builder.

## Custom Bricks Element shape

```php
class Project_Bricks_Element extends \Bricks\Element {
    public $category = 'general';
    public $name     = 'project-feature';
    public $icon     = 'ti-layout';

    public function set_controls() {
        $this->controls['title'] = [
            'tab'     => 'content',
            'label'   => esc_html__('Title', 'project-textdomain'),
            'type'    => 'text',
            'default' => '',
        ];
    }

    public function render() {
        $title = (string) ($this->settings['title'] ?? '');
        echo '<div class="project-feature">';
        echo '<h3>' . esc_html($title) . '</h3>';
        echo '</div>';
    }
}
```

Use the installed Bricks registration contract. Replace `Project`/`project-` with the actual project's prefix and keep changing content in Builder controls/dynamic data.

## Responsive baseline

```css
.project-component {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.project-component__media {
  aspect-ratio: 16 / 9;
  overflow: hidden;
}

.project-component__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.project-component__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
```

Use `height:auto` instead of crop behavior for content images where cropping is not intentional. Prefer native Bricks responsive controls when available.
