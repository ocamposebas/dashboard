<?php
declare(strict_types=1);

define('ABSPATH', __DIR__);

function add_action() {}
function absint($value) { return abs((int) $value); }
function sanitize_text_field($value) { return trim((string) $value); }
function wc_format_decimal($value, $precision = 2) { return number_format((float) $value, $precision, '.', ''); }
function wp_kses_post($value) { return (string) $value; }
function esc_url($value) { return (string) $value; }
function rest_ensure_response($value) { return $value; }
function is_wp_error($value) { return $value instanceof WP_Error; }

class WooCommerce {}
class WP_Error {
    public $code;
    public $message;
    public $data;
    public function __construct($code, $message, $data = []) {
        $this->code = $code;
        $this->message = $message;
        $this->data = $data;
    }
}

class WP_REST_Request implements ArrayAccess {
    private $route;
    private $json;
    public function __construct(array $route, array $json) {
        $this->route = $route;
        $this->json = $json;
    }
    public function get_json_params() { return $this->json; }
    public function offsetExists($offset) { return array_key_exists($offset, $this->route); }
    public function offsetGet($offset) { return $this->route[$offset] ?? null; }
    public function offsetSet($offset, $value) { $this->route[$offset] = $value; }
    public function offsetUnset($offset) { unset($this->route[$offset]); }
}

class FakeOrder {
    public $meta = [];
    public $notes = [];
    public $status = 'processing';
    public function get_meta($key) { return $this->meta[$key] ?? ''; }
    public function update_meta_data($key, $value) { $this->meta[$key] = $value; }
    public function delete_meta_data($key) { unset($this->meta[$key]); }
    public function add_order_note($note, $customer = false) {
        $this->notes[] = ['note' => $note, 'customer' => (bool) $customer];
    }
    public function save() {}
    public function has_status($status) { return $this->status === $status; }
    public function get_status() { return $this->status; }
    public function update_status($status, $note = '', $manual = false) {
        $this->status = $status;
        $this->notes[] = ['note' => $note, 'customer' => false, 'manual' => (bool) $manual];
    }
}

$test_order = new FakeOrder();
function wc_get_order($id) {
    global $test_order;
    return $id === 3180 ? $test_order : null;
}

require dirname(__DIR__) . '/wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php';

function expect_true($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$event_id = '11111111-1111-4111-8111-111111111111';
$label_id = 'se-label-3180';
$request = new WP_REST_Request(['id' => 3180], [
    'event_id' => $event_id,
    'label_id' => $label_id,
    'shipment_id' => 'se-shipment-3180',
    'tracking_number' => '879092766514',
    'carrier' => 'FedEx',
    'service' => 'FedEx 2Day One Rate',
    'amount' => 14.20,
    'currency' => 'USD',
    'purchased_at' => '2026-10-22T23:57:41.660Z',
]);

$first = Phase_One_Operations_Bridge::save_shipping_label($request);
expect_true(!is_wp_error($first), 'the first label sync should succeed');
expect_true($first['replayed'] === false, 'the first label sync should not be a replay');
expect_true($first['customer_notified'] === true, 'the customer should be notified');
expect_true($first['order_status'] === 'completed', 'the order should be completed');
expect_true($test_order->meta['_tracking_number'] === '879092766514', 'portable tracking metadata should be written');
expect_true(strpos($test_order->meta['_tracking_link'], 'fedex.com') !== false, 'the FedEx tracking link should be written');
expect_true(count(array_filter($test_order->notes, function ($note) { return $note['customer']; })) === 1, 'one customer tracking note should be sent');

$replay = Phase_One_Operations_Bridge::save_shipping_label($request);
expect_true(!is_wp_error($replay), 'the replay should succeed');
expect_true($replay['replayed'] === true, 'the second label sync should be identified as a replay');
expect_true(count(array_filter($test_order->notes, function ($note) { return $note['customer']; })) === 1, 'a replay must not send a second customer email');

$void = Phase_One_Operations_Bridge::void_shipping_label(new WP_REST_Request(['id' => 3180], [
    'event_id' => $event_id,
    'label_id' => $label_id,
]));
expect_true(!is_wp_error($void), 'voiding the label should succeed');
expect_true($test_order->status === 'processing', 'voiding should return the order to Processing');
expect_true(!isset($test_order->meta['_tracking_number']), 'voiding should remove portable tracking metadata');

fwrite(STDOUT, "WordPress shipping bridge lifecycle passed.\n");
