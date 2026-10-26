<?php
/**
 * Plugin Name: Phase One Operations Bridge
 * Description: Secure bridge between Phase One Operations Suite, storefront controls, customer rewards and existing COA Manager records.
 * Version: 2.0.0
 * Author: Phase One Labz
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Phase_One_Operations_Bridge {
    const REST_NAMESPACE = 'phaseone-ops/v1';
    const COA_POST_TYPE = 'phaseone_coa';
    const META_PREFIX = '_p1coa_';
    const REWARDS_SETTINGS_OPTION = 'phaseone_ops_rewards_settings';
    const REWARDS_AUDIT_OPTION = 'phaseone_ops_rewards_settings_audit';

    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
        add_action('rest_api_init', [__CLASS__, 'register_rewards_redemption_override'], 99);
        add_action('plugins_loaded', [__CLASS__, 'configure_rewards_engine'], 20);
    }

    public static function register_routes() {
        register_rest_route(self::REST_NAMESPACE, '/status', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'status'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/coas/(?P<id>[a-zA-Z0-9\-_]+)', [
            'methods' => WP_REST_Server::EDITABLE,
            'callback' => [__CLASS__, 'update_coa'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/customers/rewards', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'customer_rewards'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/site-controls', [
            'methods' => WP_REST_Server::EDITABLE,
            'callback' => [__CLASS__, 'update_site_controls'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/rewards/settings', [
            [
                'methods' => WP_REST_Server::READABLE,
                'callback' => [__CLASS__, 'rewards_settings'],
                'permission_callback' => [__CLASS__, 'authenticate_write_key'],
            ],
            [
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => [__CLASS__, 'update_rewards_settings'],
                'permission_callback' => [__CLASS__, 'authenticate_write_key'],
            ],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/customers/(?P<id>\d+)/points', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'adjust_customer_points'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/customers/(?P<id>\d+)/password-reset-link', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'customer_password_reset_link'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/repeat', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'repeat_order'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/evidence', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'order_evidence'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/evidence/upload', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'upload_order_evidence'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/evidence/email', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'email_order_evidence'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/evidence/(?P<evidence>[a-f0-9-]{36})', [
            'methods' => WP_REST_Server::DELETABLE,
            'callback' => [__CLASS__, 'delete_order_evidence'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/shipping-label', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'save_shipping_label'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/shipping-label/void', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'void_shipping_label'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/coas', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'order_coas'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/items/(?P<item>\d+)/coas', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'assign_order_coa'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/orders/(?P<id>\d+)/items/(?P<item>\d+)/coas/(?P<assignment>[a-f0-9-]+)', [
            'methods' => WP_REST_Server::DELETABLE,
            'callback' => [__CLASS__, 'remove_order_coa'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/restocks', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'restocks'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/waitlist', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'waitlist'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);

        register_rest_route(self::REST_NAMESPACE, '/waitlist/notify', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'notify_waitlist'],
            'permission_callback' => [__CLASS__, 'authenticate_write_key'],
        ]);
    }

    public static function status() {
        return rest_ensure_response([
            'connected' => true,
            'version' => '2.0.0',
            'capabilities' => array_values(array_filter([
                'edit_coa',
                'read_customer_rewards',
                function_exists('phaseone_site_controls_apply_promo_fields') ? 'edit_site_controls' : null,
                function_exists('lab_points_get_points_balance_safe') ? 'manage_reward_settings' : null,
                function_exists('lab_points_record_transaction') ? 'adjust_customer_points' : null,
                class_exists('WooCommerce') ? 'order_operations' : null,
                class_exists('WooCommerce') ? 'idempotent_order_coa_assignment' : null,
                class_exists('WooCommerce') ? 'email_order_evidence' : null,
                class_exists('WooCommerce') ? 'save_native_shipping_label' : null,
                class_exists('WooCommerce') ? 'repeat_order' : null,
                class_exists('WooCommerce') ? 'generate_customer_password_reset' : null,
                'inventory_restock',
                'waitlist_subscribers',
                'waitlist_notifications',
            ])),
        ]);
    }

    public static function customer_password_reset_link(WP_REST_Request $request) {
        $user = get_userdata(absint($request['id']));
        if (!$user) {
            return new WP_Error('phaseone_customer_not_found', 'Customer account was not found.', ['status' => 404]);
        }
        if (user_can($user, 'manage_options') || !array_intersect((array) $user->roles, ['customer', 'subscriber'])) {
            return new WP_Error('phaseone_customer_reset_forbidden', 'Only customer accounts can receive a storefront recovery link.', ['status' => 403]);
        }
        $key = get_password_reset_key($user);
        if (is_wp_error($key)) {
            return $key;
        }
        $expiration = (int) apply_filters('password_reset_expiration', DAY_IN_SECONDS, $user);
        $url = network_site_url(
            'wp-login.php?action=rp&key=' . rawurlencode($key) . '&login=' . rawurlencode($user->user_login),
            'login'
        );
        return rest_ensure_response([
            'url' => $url,
            'expires_at' => gmdate('c', time() + max(300, $expiration)),
        ]);
    }

    private static function copy_order_item_meta($source, $target) {
        foreach ($source->get_meta_data() as $meta) {
            $data = $meta->get_data();
            if (!isset($data['key']) || strpos((string) $data['key'], '_reduced_stock') === 0) {
                continue;
            }
            $target->add_meta_data($data['key'], $data['value'], false);
        }
    }

    public static function repeat_order(WP_REST_Request $request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error('phaseone_woocommerce_missing', 'WooCommerce is not available.', ['status' => 503]);
        }
        $source = wc_get_order(absint($request['id']));
        if (!$source) {
            return new WP_Error('phaseone_order_not_found', 'Source order was not found.', ['status' => 404]);
        }
        $request_id = sanitize_text_field((string) $request->get_param('request_id'));
        if (!preg_match('/^[a-f0-9-]{36}$/i', $request_id)) {
            return new WP_Error('phaseone_repeat_request_invalid', 'A valid repeat request identifier is required.', ['status' => 400]);
        }
        $existing = wc_get_orders([
            'limit' => 1,
            'return' => 'objects',
            'meta_key' => '_phaseone_repeat_request_id',
            'meta_value' => $request_id,
        ]);
        if (!empty($existing)) {
            return rest_ensure_response(['created' => false, 'replayed' => true, 'order_id' => $existing[0]->get_id()]);
        }

        try {
            $order = wc_create_order(['customer_id' => $source->get_customer_id(), 'status' => 'pending']);
            if (is_wp_error($order)) {
                return $order;
            }
            $order->set_address($source->get_address('billing'), 'billing');
            $order->set_address($source->get_address('shipping'), 'shipping');
            $order->set_currency($source->get_currency());
            $order->set_customer_note($source->get_customer_note());
            $order->set_created_via('phaseone_operations_repeat');
            $order->set_payment_method('phaseone_operational_repeat');
            $order->set_payment_method_title('Operational repeat · no new charge');

            foreach ($source->get_items('line_item') as $source_item) {
                $product = $source_item->get_product();
                if (!$product) {
                    throw new Exception('A source product is no longer available: ' . $source_item->get_name());
                }
                $item = new WC_Order_Item_Product();
                $item->set_product($product);
                $item->set_name($source_item->get_name());
                $item->set_quantity($source_item->get_quantity());
                $item->set_subtotal(0);
                $item->set_total(0);
                $item->set_subtotal_tax(0);
                $item->set_total_tax(0);
                $item->set_taxes(['subtotal' => [], 'total' => []]);
                $item->add_meta_data('_phaseone_original_line_total', $source_item->get_total(), true);
                self::copy_order_item_meta($source_item, $item);
                $order->add_item($item);
            }
            foreach ($source->get_items('shipping') as $source_item) {
                $item = new WC_Order_Item_Shipping();
                $item->set_method_title($source_item->get_method_title());
                $item->set_method_id($source_item->get_method_id());
                $item->set_instance_id($source_item->get_instance_id());
                $item->set_total(0);
                $item->set_taxes(['total' => []]);
                self::copy_order_item_meta($source_item, $item);
                $order->add_item($item);
            }
            $order->update_meta_data('_phaseone_operational_repeat', 'yes');
            $order->update_meta_data('_phaseone_repeated_from_order_id', $source->get_id());
            $order->update_meta_data('_phaseone_repeat_request_id', $request_id);
            $order->update_meta_data('_phaseone_repeated_by', sanitize_text_field((string) $request->get_param('actor_name')));
            $order->update_meta_data('_phaseone_original_order_total', $source->get_total());
            $order->calculate_totals(false);
            $order->set_date_paid(time());
            $order->save();
            $order->update_status('processing', sprintf('Operational repeat of order #%s. No new customer charge was created.', $source->get_order_number()), false);
            wc_reduce_stock_levels($order->get_id());
            $order->add_order_note(sprintf('Created as an operational repeat of order #%s from Phase One Operations Suite.', $source->get_order_number()), false);
            $source->add_order_note(sprintf('Repeated operationally as order #%s. The customer was not charged again.', $order->get_order_number()), false);
            return rest_ensure_response(['created' => true, 'replayed' => false, 'order_id' => $order->get_id()]);
        } catch (Throwable $error) {
            if (isset($order) && is_a($order, 'WC_Order')) {
                $order->delete(true);
            }
            return new WP_Error('phaseone_repeat_failed', $error->getMessage(), ['status' => 500]);
        }
    }

    private static function proxy_request($method, $route, WP_REST_Request $source = null, $json = null) {
        $proxy = new WP_REST_Request($method, $route);
        if ($source) {
            $proxy->set_query_params($source->get_query_params());
            $proxy->set_body_params($source->get_body_params());
            $proxy->set_file_params($source->get_file_params());
        }
        if (is_array($json)) {
            $proxy->set_header('content-type', 'application/json');
            $proxy->set_body(wp_json_encode($json));
        }
        $result = rest_do_request($proxy);
        if ($result->is_error()) {
            return $result->as_error();
        }
        return rest_ensure_response($result->get_data());
    }

    public static function order_evidence(WP_REST_Request $request) {
        return self::proxy_request('GET', '/phaseone/v1/order-evidence/orders/' . absint($request['id']), $request);
    }

    private static function shipping_tracking_url($carrier, $tracking) {
        $carrier_key = strtolower((string) $carrier);
        $tracking_encoded = rawurlencode((string) $tracking);
        if (strpos($carrier_key, 'fedex') !== false) {
            return 'https://www.fedex.com/fedextrack/?trknbr=' . $tracking_encoded;
        }
        if (strpos($carrier_key, 'ups') !== false) {
            return 'https://www.ups.com/track?loc=en_US&tracknum=' . $tracking_encoded;
        }
        if (strpos($carrier_key, 'usps') !== false || strpos($carrier_key, 'postal') !== false) {
            return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' . $tracking_encoded;
        }
        if (strpos($carrier_key, 'dhl') !== false) {
            return 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' . $tracking_encoded;
        }
        return '';
    }

    private static function finalize_shipping_label($order, $label_id, $tracking, $carrier, $service) {
        $tracking_url = self::shipping_tracking_url($carrier, $tracking);
        $order->update_meta_data('_tracking_number', $tracking);
        $order->update_meta_data('_tracking_provider', $carrier);
        $order->update_meta_data('_tracking_link', $tracking_url);
        $order->update_meta_data('_date_shipped', time());
        $order->save();

        $notified_label = (string) $order->get_meta('_phaseone_shipping_customer_notified_label_id', true);
        $customer_notified = $notified_label !== '' && hash_equals($notified_label, $label_id);
        if (!$customer_notified) {
            $note = sprintf(
                'Your order has shipped via %s%s. Tracking number: %s.',
                $carrier !== '' ? $carrier : 'the selected carrier',
                $service !== '' ? ' · ' . $service : '',
                $tracking
            );
            if ($tracking_url !== '') {
                $note .= sprintf(' <a href="%s">Track your package</a>.', esc_url($tracking_url));
            }
            $order->add_order_note(wp_kses_post($note), true);
            $order->update_meta_data('_phaseone_shipping_customer_notified_label_id', $label_id);
            $order->update_meta_data('_phaseone_shipping_customer_notified_at', gmdate('c'));
            $order->save();
            $customer_notified = true;
        }

        if ($order->has_status('processing')) {
            $order->update_status(
                'completed',
                sprintf('Order completed automatically after purchasing shipping label %s. Tracking %s.', $label_id, $tracking),
                true
            );
        } elseif (!$order->has_status('completed')) {
            return new WP_Error(
                'phaseone_shipping_status_conflict',
                sprintf('Tracking was saved, but the order is %s and was not completed automatically.', $order->get_status()),
                ['status' => 409]
            );
        }

        $order->update_meta_data('_phaseone_shipping_completed_label_id', $label_id);
        $order->update_meta_data('_phaseone_shipping_completed_at', gmdate('c'));
        $order->save();
        return [
            'customer_notified' => $customer_notified,
            'order_status' => $order->get_status(),
        ];
    }

    public static function save_shipping_label(WP_REST_Request $request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error('phaseone_woocommerce_missing', 'WooCommerce is not available.', ['status' => 503]);
        }
        $order = wc_get_order(absint($request['id']));
        if (!$order) {
            return new WP_Error('phaseone_order_missing', 'Order not found.', ['status' => 404]);
        }
        $input = $request->get_json_params();
        $event_id = sanitize_text_field($input['event_id'] ?? '');
        $label_id = sanitize_text_field($input['label_id'] ?? '');
        $tracking = sanitize_text_field($input['tracking_number'] ?? '');
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $event_id) || $label_id === '' || $tracking === '') {
            return new WP_Error('phaseone_shipping_invalid', 'A valid event, label and tracking number are required.', ['status' => 400]);
        }
        $existing_label = (string) $order->get_meta('_phaseone_shipping_label_id', true);
        $replayed = $existing_label !== '' && hash_equals($existing_label, $label_id);
        if ($existing_label !== '' && !hash_equals($existing_label, $label_id)) {
            return new WP_Error('phaseone_shipping_conflict', 'This order already has a different native shipping label.', ['status' => 409]);
        }
        $carrier = sanitize_text_field($input['carrier'] ?? '');
        $service = sanitize_text_field($input['service'] ?? '');
        if (!$replayed) {
            $order->update_meta_data('_phaseone_shipping_event_id', $event_id);
            $order->update_meta_data('_phaseone_shipping_label_id', $label_id);
            $order->update_meta_data('_phaseone_shipping_shipment_id', sanitize_text_field($input['shipment_id'] ?? ''));
            $order->update_meta_data('_phaseone_shipping_tracking_number', $tracking);
            $order->update_meta_data('_phaseone_shipping_carrier', $carrier);
            $order->update_meta_data('_phaseone_shipping_service', $service);
            $order->update_meta_data('_phaseone_shipping_amount', wc_format_decimal($input['amount'] ?? 0, 2));
            $order->update_meta_data('_phaseone_shipping_currency', strtoupper(sanitize_text_field($input['currency'] ?? 'USD')));
            $order->update_meta_data('_phaseone_shipping_purchased_at', sanitize_text_field($input['purchased_at'] ?? ''));
            $order->update_meta_data('_phaseone_native_shipping_managed', 'yes');
            $order->add_order_note(sprintf('Shipping label purchased in Phase One Operations. %s · %s · Tracking %s.',
                $carrier, $service, $tracking));
            $order->save();
        }
        $finalized = self::finalize_shipping_label($order, $label_id, $tracking, $carrier, $service);
        if (is_wp_error($finalized)) {
            return $finalized;
        }
        return rest_ensure_response([
            'replayed' => $replayed,
            'customer_notified' => $finalized['customer_notified'],
            'order_status' => $finalized['order_status'],
            'message' => 'Tracking saved, customer notified and order completed.',
        ]);
    }

    public static function void_shipping_label(WP_REST_Request $request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error('phaseone_woocommerce_missing', 'WooCommerce is not available.', ['status' => 503]);
        }
        $order = wc_get_order(absint($request['id']));
        if (!$order) {
            return new WP_Error('phaseone_order_missing', 'Order not found.', ['status' => 404]);
        }
        $input = $request->get_json_params();
        $event_id = sanitize_text_field($input['event_id'] ?? '');
        $label_id = sanitize_text_field($input['label_id'] ?? '');
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $event_id) || $label_id === '') {
            return new WP_Error('phaseone_shipping_invalid', 'A valid event and label are required.', ['status' => 400]);
        }
        $existing_label = (string) $order->get_meta('_phaseone_shipping_label_id', true);
        $voided_label = (string) $order->get_meta('_phaseone_shipping_voided_label_id', true);
        if ($existing_label === '' && $voided_label !== '' && hash_equals($voided_label, $label_id)) {
            return rest_ensure_response(['replayed' => true, 'message' => 'The voided label was already removed from the source order.']);
        }
        if ($existing_label === '' || !hash_equals($existing_label, $label_id)) {
            return new WP_Error('phaseone_shipping_conflict', 'The source order does not contain this native shipping label.', ['status' => 409]);
        }
        foreach (['_phaseone_shipping_event_id', '_phaseone_shipping_label_id', '_phaseone_shipping_shipment_id',
            '_phaseone_shipping_tracking_number', '_phaseone_shipping_carrier', '_phaseone_shipping_service',
            '_phaseone_shipping_amount', '_phaseone_shipping_currency', '_phaseone_shipping_purchased_at',
            '_phaseone_native_shipping_managed', '_phaseone_shipping_customer_notified_label_id',
            '_phaseone_shipping_customer_notified_at', '_phaseone_shipping_completed_label_id',
            '_phaseone_shipping_completed_at', '_tracking_number', '_tracking_provider', '_tracking_link',
            '_date_shipped'] as $key) {
            $order->delete_meta_data($key);
        }
        $order->update_meta_data('_phaseone_shipping_voided_label_id', $label_id);
        $order->update_meta_data('_phaseone_shipping_voided_at', gmdate('c'));
        $order->add_order_note('The native shipping label was voided in Phase One Operations.');
        if ($order->has_status('completed')) {
            $order->update_status('processing', 'Order returned to Processing because its native shipping label was voided.', true);
        } else {
            $order->save();
        }
        return rest_ensure_response(['replayed' => false, 'message' => 'Voided tracking removed and the order returned to Processing.']);
    }

    public static function upload_order_evidence(WP_REST_Request $request) {
        return self::proxy_request('POST', '/phaseone/v1/order-evidence/orders/' . absint($request['id']) . '/upload', $request);
    }

    public static function delete_order_evidence(WP_REST_Request $request) {
        return self::proxy_request('DELETE', '/phaseone/v1/order-evidence/orders/' . absint($request['id']) . '/' . sanitize_key($request['evidence']), $request);
    }

    /**
     * Email the dashboard's two confirmed packaging photos through WordPress.
     *
     * The files exist only for this request and as wp_mail() temporary
     * attachments. WordPress' configured SMTP/delivery plugin remains the sole
     * transport owner. The event id makes repeated dashboard requests safe.
     */
    public static function email_order_evidence(WP_REST_Request $request) {
        if (!class_exists('WooCommerce')) {
            return new WP_Error('phaseone_commerce_unavailable', 'Commerce is unavailable.', ['status' => 503]);
        }

        $order = wc_get_order(absint($request['id']));
        if (!$order instanceof WC_Order) {
            return new WP_Error('phaseone_order_not_found', 'Order not found.', ['status' => 404]);
        }
        if (in_array($order->get_status(), ['cancelled', 'refunded', 'failed', 'trash'], true)) {
            return new WP_Error('phaseone_evidence_email_ineligible', 'This order is not eligible for packaging evidence email.', ['status' => 409]);
        }

        $event_id = sanitize_text_field((string) $request->get_param('event_id'));
        if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i', $event_id)) {
            return new WP_Error('phaseone_evidence_email_event_invalid', 'A valid delivery event id is required.', ['status' => 400]);
        }

        $sent_events = $order->get_meta('_phaseone_packaging_evidence_email_events', true);
        $sent_events = is_array($sent_events) ? $sent_events : [];
        if (!empty($sent_events[$event_id])) {
            return rest_ensure_response([
                'state' => 'sent',
                'sent_at' => sanitize_text_field((string) $sent_events[$event_id]),
                'replayed' => true,
                'message' => 'Customer packaging evidence email was already sent through WordPress SMTP.',
            ]);
        }

        $lock_key = 'phaseone_evidence_mail_lock_' . md5($order->get_id() . '|' . $event_id);
        if (!add_option($lock_key, gmdate('c'), '', false)) {
            return rest_ensure_response([
                'state' => 'uncertain',
                'sent_at' => null,
                'replayed' => true,
                'message' => 'A previous delivery attempt is still locked. Review the WordPress mail log before retrying.',
            ]);
        }

        $temp_files = [];
        $accepted = false;
        try {
            $recipient = sanitize_email($order->get_billing_email());
            if (!is_email($recipient)) {
                throw new RuntimeException('The order billing email is invalid.');
            }

            $files = $request->get_file_params();
            $requirements = [
                'contents' => 'Packed-Contents',
                'sealed_label' => 'Sealed-Package-and-Label',
            ];
            $allowed_mimes = [
                'image/jpeg' => 'jpg',
                'image/png' => 'png',
                'image/webp' => 'webp',
            ];
            $attachment_bytes = 0;
            foreach ($requirements as $field => $filename) {
                $file = isset($files[$field]) && is_array($files[$field]) ? $files[$field] : [];
                if (empty($file['tmp_name']) && empty($file['size'])) {
                    continue;
                }
                if (
                    empty($file['tmp_name']) ||
                    !is_uploaded_file($file['tmp_name']) ||
                    !empty($file['error']) ||
                    empty($file['size']) ||
                    (int) $file['size'] > 6 * MB_IN_BYTES
                ) {
                    throw new RuntimeException('Every packaging evidence attachment must be a valid image smaller than 6 MB.');
                }
                $attachment_bytes += (int) $file['size'];
                $image_info = @getimagesize($file['tmp_name']); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
                $mime = is_array($image_info) && isset($image_info['mime']) ? (string) $image_info['mime'] : '';
                if (!isset($allowed_mimes[$mime])) {
                    throw new RuntimeException('Packaging evidence attachments must be JPEG, PNG or WebP images.');
                }
                $attachment_name = sprintf(
                    'Phase-One-Labz-Order-%s-%s.%s',
                    sanitize_file_name($order->get_order_number()),
                    $filename,
                    $allowed_mimes[$mime]
                );
                $temp_path = trailingslashit(get_temp_dir()) . wp_unique_filename(get_temp_dir(), $attachment_name);
                if (!copy($file['tmp_name'], $temp_path)) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_copy
                    throw new RuntimeException('A packaging evidence attachment could not be prepared.');
                }
                $temp_files[] = $temp_path;
            }
            if (count($temp_files) < 1 || count($temp_files) > 2) {
                throw new RuntimeException('One or two packaging evidence photos are required.');
            }
            if ($attachment_bytes > 10 * MB_IN_BYTES) {
                throw new RuntimeException('Packaging evidence attachments exceed the safe email size.');
            }

            $customer_name = trim((string) $order->get_formatted_billing_full_name());
            $confirmed_at = sanitize_text_field((string) $request->get_param('confirmed_at'));
            $body = sprintf(
                '<p>Hello %s,</p><p>Your order <strong>#%s</strong> has been packed.</p><p>For your records, we attached %s from the verified packaging process.</p>%s<p>Please keep this email with your order records.</p>',
                esc_html($customer_name ?: 'there'),
                esc_html($order->get_order_number()),
                count($temp_files) === 1 ? 'one evidence photo' : 'two evidence photos',
                $confirmed_at ? '<p><strong>Packaging confirmed:</strong> ' . esc_html($confirmed_at) . '</p>' : ''
            );
            $mailer = WC()->mailer();
            $message = method_exists($mailer, 'wrap_message')
                ? $mailer->wrap_message('Your Phase One Labz packaging evidence', $body)
                : $body;
            $content_type_filter = static function () {
                return 'text/html';
            };
            add_filter('wp_mail_content_type', $content_type_filter);
            try {
                $accepted = (bool) wp_mail(
                    $recipient,
                    sprintf('Your Phase One Labz packaging evidence - Order #%s', $order->get_order_number()),
                    $message,
                    [],
                    $temp_files
                );
            } finally {
                remove_filter('wp_mail_content_type', $content_type_filter);
            }
            if (!$accepted) {
                throw new RuntimeException('WordPress mail delivery returned false.');
            }

            $sent_at = gmdate('c');
            $sent_events[$event_id] = $sent_at;
            if (count($sent_events) > 25) {
                $sent_events = array_slice($sent_events, -25, null, true);
            }
            $order->update_meta_data('_phaseone_packaging_evidence_email_events', $sent_events);
            $order->update_meta_data('_phaseone_packaging_evidence_email_status', 'sent');
            $order->update_meta_data('_phaseone_packaging_evidence_email_sent_at', $sent_at);
            $order->delete_meta_data('_phaseone_packaging_evidence_email_last_error');
            $attachment_count = count($temp_files);
            $order->add_order_note(sprintf('Packaging evidence emailed through WordPress with %d photo attachment%s.', $attachment_count, $attachment_count === 1 ? '' : 's'));
            $order->save();
            delete_option($lock_key);

            return rest_ensure_response([
                'state' => 'sent',
                'sent_at' => $sent_at,
                'replayed' => false,
                'message' => sprintf('Customer email sent through WordPress SMTP with %d evidence photo%s attached.', $attachment_count, $attachment_count === 1 ? '' : 's'),
            ]);
        } catch (Throwable $error) {
            $message = sanitize_text_field($error->getMessage());
            $order->update_meta_data('_phaseone_packaging_evidence_email_status', $accepted ? 'uncertain' : 'failed');
            $order->update_meta_data('_phaseone_packaging_evidence_email_last_error', $message);
            $order->add_order_note('Packaging evidence email failed: ' . $message);
            $order->save();
            if (!$accepted) {
                delete_option($lock_key);
            }
            if ($accepted) {
                return rest_ensure_response([
                    'state' => 'uncertain',
                    'sent_at' => null,
                    'replayed' => false,
                    'message' => 'WordPress accepted the email but could not finalize its delivery record. Review the mail log before retrying.',
                ]);
            }
            return new WP_Error('phaseone_evidence_email_failed', $message, ['status' => 502]);
        } finally {
            foreach ($temp_files as $temp_file) {
                if ($temp_file && file_exists($temp_file)) {
                    wp_delete_file($temp_file);
                }
            }
        }
    }

    public static function order_coas(WP_REST_Request $request) {
        return self::proxy_request('GET', '/phaseone/v1/order-coas/orders/' . absint($request['id']), $request);
    }

    public static function assign_order_coa(WP_REST_Request $request) {
        $input = $request->get_json_params();
        if (!is_array($input) || empty($input['coa_id']) || empty($input['quantity'])) {
            return new WP_Error('phaseone_invalid_coa_assignment', 'COA and quantity are required.', ['status' => 400]);
        }
        $event_id = strtolower(sanitize_text_field((string) ($input['event_id'] ?? '')));
        if ($event_id !== '' && !preg_match('/^[a-f0-9]{64}$/', $event_id)) {
            return new WP_Error('phaseone_invalid_coa_event', 'A valid COA assignment event id is required.', ['status' => 400]);
        }
        $order_id = absint($request['id']);
        $item_id = absint($request['item']);
        $coa_id = sanitize_text_field($input['coa_id']);
        $quantity = max(1, absint($input['quantity']));
        $lock_key = $event_id !== '' ? 'phaseone_coa_event_' . $event_id : '';
        $fingerprint = hash('sha256', implode('|', [$order_id, $item_id, $coa_id, $quantity]));
        if ($lock_key !== '') {
            $existing = get_option($lock_key, null);
            if (is_array($existing)) {
                if (!hash_equals((string) ($existing['fingerprint'] ?? ''), $fingerprint)) {
                    return new WP_Error('phaseone_coa_event_conflict', 'This COA event id belongs to another assignment.', ['status' => 409]);
                }
                if (($existing['state'] ?? '') === 'succeeded') {
                    return self::proxy_request('GET', '/phaseone/v1/order-coas/orders/' . $order_id);
                }
                return new WP_Error('phaseone_coa_event_processing', 'This COA assignment is already being processed.', ['status' => 409]);
            }
            $locked = add_option($lock_key, [
                'state' => 'processing',
                'fingerprint' => $fingerprint,
                'created_at' => gmdate('c'),
            ], '', false);
            if (!$locked) {
                return new WP_Error('phaseone_coa_event_processing', 'This COA assignment is already being processed.', ['status' => 409]);
            }
        }
        $result = self::proxy_request(
            'POST',
            '/phaseone/v1/order-coas/orders/' . $order_id . '/items/' . $item_id . '/assign',
            null,
            ['coa_id' => $coa_id, 'quantity' => $quantity]
        );
        if (is_wp_error($result)) {
            if ($lock_key !== '') {
                delete_option($lock_key);
            }
            return $result;
        }
        if ($lock_key !== '') {
            update_option($lock_key, [
                'state' => 'succeeded',
                'fingerprint' => $fingerprint,
                'completed_at' => gmdate('c'),
            ], false);
        }
        return $result;
    }

    public static function remove_order_coa(WP_REST_Request $request) {
        return self::proxy_request(
            'DELETE',
            '/phaseone/v1/order-coas/orders/' . absint($request['id']) . '/items/' . absint($request['item']) . '/assignments/' . sanitize_key($request['assignment']),
            $request
        );
    }

    public static function restocks(WP_REST_Request $request) {
        return self::proxy_request('GET', '/phase/v1/restocks', $request);
    }

    public static function waitlist(WP_REST_Request $request) {
        $input = $request->get_json_params();
        $input = is_array($input) ? $input : [];
        $product_id = absint($input['product_id'] ?? $input['productId'] ?? $input['product'] ?? 0);
        if (!$product_id) {
            return new WP_Error('phaseone_invalid_product', 'A valid product is required.', ['status' => 400]);
        }

        $records = array_merge(
            self::legacy_waitlist_subscribers($product_id, $input),
            self::official_waitlist_subscribers($product_id)
        );
        $subscribers = [];
        foreach ($records as $record) {
            if (!is_array($record)) {
                continue;
            }
            $status = sanitize_key((string) ($record['status'] ?? 'subscribed'));
            if (in_array($status, ['sent', 'notified', 'unsubscribed', 'cancelled', 'canceled', 'deleted', 'inactive'], true)) {
                continue;
            }
            $email = strtolower((string) ($record['email'] ?? ''));
            $variation_id = absint($record['variation_id'] ?? 0);
            $source = sanitize_key((string) ($record['source'] ?? 'store'));
            $record_id = sanitize_text_field((string) ($record['id'] ?? ''));
            $identity = $email
                ? $email . ':' . $product_id . ':' . $variation_id
                : $source . ':' . $record_id . ':' . $product_id . ':' . $variation_id;
            if (!$identity || isset($subscribers[$identity])) {
                continue;
            }
            $subscribers[$identity] = $record;
        }

        return rest_ensure_response([
            'product_id' => $product_id,
            'subscribers' => array_values($subscribers),
            'sources' => [
                'store_notifier' => count(array_filter($subscribers, function ($item) {
                    return ($item['source'] ?? '') === 'store_notifier';
                })),
                'back_in_stock' => count(array_filter($subscribers, function ($item) {
                    return ($item['source'] ?? '') === 'back_in_stock';
                })),
            ],
        ]);
    }

    /**
     * Read the legacy notifier through its own REST controller. Errors are
     * intentionally isolated so the official back-in-stock list can still load.
     */
    private static function legacy_waitlist_subscribers($product_id, $input) {
        unset($input);
        if (!post_type_exists('cwginstocknotifier')) {
            return [];
        }

        // The notifier stores each active request as a custom post. Querying the
        // posts directly preserves parent/variation relationships and avoids the
        // plugin REST list formatter, which separates one subscriber across
        // multiple array entries in current releases.
        $posts = get_posts([
            'numberposts' => -1,
            'post_type' => 'cwginstocknotifier',
            'post_status' => 'cwg_subscribed',
            'fields' => 'ids',
            'no_found_rows' => true,
            'meta_query' => [
                'relation' => 'OR',
                [
                    'key' => 'cwginstock_product_id',
                    'value' => $product_id,
                    'compare' => '=',
                    'type' => 'NUMERIC',
                ],
                [
                    'key' => 'cwginstock_pid',
                    'value' => $product_id,
                    'compare' => '=',
                    'type' => 'NUMERIC',
                ],
            ],
        ]);
        $normalized = [];
        foreach (is_array($posts) ? $posts : [] as $subscriber_id) {
            $record = [
                'id' => absint($subscriber_id),
                'product_id' => absint(get_post_meta($subscriber_id, 'cwginstock_product_id', true)),
                'variation_id' => absint(get_post_meta($subscriber_id, 'cwginstock_variation_id', true)),
                'email' => get_post_meta($subscriber_id, 'cwginstock_subscriber_email', true),
                'name' => get_post_meta($subscriber_id, 'cwginstock_subscriber_name', true),
                'phone' => get_post_meta($subscriber_id, 'cwginstock_subscriber_phone', true),
                'status' => get_post_status($subscriber_id) ?: 'cwg_subscribed',
                'subscribed_at' => get_post_field('post_date_gmt', $subscriber_id),
            ];
            $subscriber = self::normalize_waitlist_record($record, 'store_notifier', $product_id);
            if ($subscriber) {
                $normalized[] = $subscriber;
            }
        }
        return $normalized;
    }

    /**
     * WooCommerce Back In Stock Notifications persists subscriptions in its own
     * tables and does not expose a list endpoint. Read those tables without
     * changing notification state or invoking its delivery scheduler.
     */
    private static function official_waitlist_subscribers($product_id) {
        global $wpdb;

        $base_tables = [
            $wpdb->prefix . 'woocommerce_bis_notifications',
            $wpdb->prefix . 'woocommerce_bis_activity',
            $wpdb->prefix . 'wc_bis_notifications',
            $wpdb->prefix . 'wc_bis_activity',
            $wpdb->prefix . 'wc_bis_subscribed_emails',
        ];
        $meta_tables = [
            $wpdb->prefix . 'woocommerce_bis_notificationsmeta',
            $wpdb->prefix . 'wc_bis_notificationsmeta',
        ];
        $meta_by_id = [];
        foreach ($meta_tables as $meta_table) {
            foreach (self::back_in_stock_meta($meta_table) as $reference => $values) {
                $meta_by_id[$reference] = array_merge($meta_by_id[$reference] ?? [], $values);
            }
        }
        $subscribers = [];

        foreach ($base_tables as $table) {
            if (!self::safe_table_exists($table)) {
                continue;
            }
            $rows = $wpdb->get_results("SELECT * FROM `{$table}` LIMIT 1000", ARRAY_A);
            foreach (is_array($rows) ? $rows : [] as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $row_id = absint(self::first_record_value($row, ['id', 'notification_id', 'activity_id']));
                if ($row_id && isset($meta_by_id[$row_id])) {
                    $row = array_merge($row, $meta_by_id[$row_id]);
                }
                $subscriber = self::normalize_waitlist_record($row, 'back_in_stock', $product_id);
                if ($subscriber) {
                    $subscribers[] = $subscriber;
                }
            }
        }

        return $subscribers;
    }

    private static function back_in_stock_meta($table) {
        global $wpdb;
        if (!self::safe_table_exists($table)) {
            return [];
        }
        $columns = self::safe_table_columns($table);
        $reference_column = self::first_available_column($columns, ['notification_id', 'object_id', 'activity_id']);
        $key_column = self::first_available_column($columns, ['meta_key', 'key']);
        $value_column = self::first_available_column($columns, ['meta_value', 'value']);
        if (!$reference_column || !$key_column || !$value_column) {
            return [];
        }

        $rows = $wpdb->get_results(
            "SELECT `{$reference_column}`, `{$key_column}`, `{$value_column}` FROM `{$table}` LIMIT 5000",
            ARRAY_A
        );
        $meta = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            $reference = absint($row[$reference_column] ?? 0);
            $key = sanitize_key((string) ($row[$key_column] ?? ''));
            if (!$reference || !$key) {
                continue;
            }
            $value = maybe_unserialize($row[$value_column] ?? '');
            if (is_scalar($value) || $value === null) {
                $meta[$reference][$key] = $value;
            }
        }
        return $meta;
    }

    private static function normalize_waitlist_record($record, $source, $requested_product_id) {
        if (is_object($record)) {
            $record = get_object_vars($record);
        }
        if (!is_array($record)) {
            return null;
        }

        $product_id = absint(self::first_record_value($record, [
            'product_id', '_product_id', 'wc_product_id', 'object_id', 'item_id', 'post_id', 'product',
        ]));
        $variation_id = absint(self::first_record_value($record, [
            'variation_id', '_variation_id', 'variant_id', 'variation',
        ]));
        if ($product_id !== $requested_product_id && $variation_id !== $requested_product_id) {
            return null;
        }

        $user_id = absint(self::first_record_value($record, ['user_id', 'customer_id', 'subscriber_user_id']));
        $user = $user_id ? get_userdata($user_id) : false;
        $email = sanitize_email((string) self::first_record_value($record, [
            'email', '_email', 'user_email', 'subscriber_email', 'customer_email', 'billing_email',
        ]));
        if (!$email && $user) {
            $email = sanitize_email($user->user_email);
        }
        $first_name = sanitize_text_field((string) self::first_record_value($record, ['first_name', 'billing_first_name']));
        $last_name = sanitize_text_field((string) self::first_record_value($record, ['last_name', 'billing_last_name']));
        $name = sanitize_text_field((string) self::first_record_value($record, [
            'name', 'subscriber_name', 'display_name', 'customer_name', 'user_name',
        ]));
        if (!$name) {
            $name = trim($first_name . ' ' . $last_name);
        }
        if (!$name && $user) {
            $name = sanitize_text_field($user->display_name);
        }
        if (!$name && $email) {
            $name = sanitize_text_field(strstr($email, '@', true));
        }

        $id = sanitize_text_field((string) self::first_record_value($record, [
            'id', 'subscriber_id', 'notification_id', 'activity_id', 'ID',
        ]));
        if (!$id) {
            $id = substr(hash('sha256', $source . '|' . $email . '|' . $product_id . '|' . $variation_id), 0, 24);
        }

        return [
            'id' => $source . ':' . $id,
            'product_id' => $product_id ?: $requested_product_id,
            'variation_id' => $variation_id,
            'name' => $name ?: 'Subscriber',
            'email' => $email,
            'phone' => sanitize_text_field((string) self::first_record_value($record, [
                'phone', 'billing_phone', 'subscriber_phone', 'customer_phone',
            ])),
            'status' => sanitize_text_field((string) self::first_record_value($record, [
                'status', 'subscriber_status', 'state', 'notification_status',
            ])) ?: 'subscribed',
            'subscribed_at' => sanitize_text_field((string) self::first_record_value($record, [
                'subscribed_at', 'created_at', 'date_created', 'created', 'date_added',
            ])),
            'notified_at' => sanitize_text_field((string) self::first_record_value($record, [
                'notified_at', 'sent_at', 'date_notified', 'last_notified', 'updated_at', 'date_modified',
            ])),
            'source' => $source,
        ];
    }

    private static function subscriber_records_from_payload($payload) {
        if (is_object($payload)) {
            $payload = get_object_vars($payload);
        }
        if (!is_array($payload)) {
            return [];
        }
        $keys = array_keys($payload);
        if ($keys === range(0, count($payload) - 1)) {
            return $payload;
        }
        foreach (['subscribers', 'subscriber', 'items', 'data', 'results', 'records'] as $key) {
            if (isset($payload[$key])) {
                $records = self::subscriber_records_from_payload($payload[$key]);
                if ($records) {
                    return $records;
                }
            }
        }
        return [];
    }

    private static function first_record_value($record, $keys) {
        foreach ($keys as $key) {
            if (array_key_exists($key, $record) && $record[$key] !== '' && $record[$key] !== null) {
                return $record[$key];
            }
        }
        return '';
    }

    private static function safe_table_exists($table) {
        global $wpdb;
        if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) {
            return false;
        }
        return $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    }

    private static function safe_table_columns($table) {
        global $wpdb;
        if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) {
            return [];
        }
        $rows = $wpdb->get_results("SHOW COLUMNS FROM `{$table}`", ARRAY_A);
        return array_values(array_filter(array_map(function ($row) {
            $field = (string) ($row['Field'] ?? '');
            return preg_match('/^[A-Za-z0-9_]+$/', $field) ? $field : '';
        }, is_array($rows) ? $rows : [])));
    }

    private static function first_available_column($columns, $candidates) {
        foreach ($candidates as $candidate) {
            if (in_array($candidate, $columns, true)) {
                return $candidate;
            }
        }
        return '';
    }

    public static function notify_waitlist(WP_REST_Request $request) {
        $input = $request->get_json_params();
        $product_id = absint(is_array($input) ? ($input['product_id'] ?? 0) : 0);
        if (!$product_id) {
            return new WP_Error('phaseone_invalid_product', 'A valid product is required.', ['status' => 400]);
        }
        $product = wc_get_product($product_id);
        if (!$product) {
            return new WP_Error('phaseone_product_not_found', 'The product no longer exists.', ['status' => 404]);
        }
        if (!$product->is_in_stock()) {
            return new WP_Error('phaseone_product_out_of_stock', 'Add available inventory before notifying the waitlist.', ['status' => 409]);
        }
        return self::proxy_request('POST', '/wc/v3/back-in-stock/notifications/force-send', null, ['productIds' => [$product_id]]);
    }

    public static function customer_rewards() {
        global $wpdb;

        $keys = [
            '_lab_points_balance',
            '_lab_store_credit_balance',
            '_lab_points_transaction_history',
            '_lab_store_credit_redemptions',
        ];
        $placeholders = implode(', ', array_fill(0, count($keys), '%s'));
        $query = $wpdb->prepare(
            "SELECT user_id, meta_key, meta_value FROM {$wpdb->usermeta} WHERE meta_key IN ({$placeholders})",
            $keys
        );
        $rows = $wpdb->get_results($query);
        $rewards = [];

        foreach ($rows as $row) {
            $user_id = absint($row->user_id);
            if ($user_id < 1) {
                continue;
            }
            if (!isset($rewards[$user_id])) {
                $rewards[$user_id] = [
                    'points_balance' => null,
                    'store_credit' => null,
                    'history' => [],
                    'redemptions' => [],
                ];
            }

            if ($row->meta_key === '_lab_points_balance') {
                $rewards[$user_id]['points_balance'] = max(0, (int) $row->meta_value);
            } elseif ($row->meta_key === '_lab_store_credit_balance') {
                $rewards[$user_id]['store_credit'] = max(0, (float) $row->meta_value);
            } elseif ($row->meta_key === '_lab_points_transaction_history') {
                $history = maybe_unserialize($row->meta_value);
                if (is_array($history)) {
                    $rewards[$user_id]['history'] = array_values(array_filter(array_map(
                        [__CLASS__, 'clean_reward_activity'],
                        array_slice($history, 0, 100)
                    )));
                }
            } elseif ($row->meta_key === '_lab_store_credit_redemptions') {
                $redemptions = json_decode((string) $row->meta_value, true);
                if (!is_array($redemptions)) {
                    $redemptions = maybe_unserialize($row->meta_value);
                }
                if (is_array($redemptions)) {
                    $rewards[$user_id]['redemptions'] = array_values(array_filter(array_map(
                        [__CLASS__, 'clean_redemption'],
                        array_slice($redemptions, 0, 50)
                    )));
                }
            }
        }

        return rest_ensure_response([
            'version' => '1.3.0',
            'rewards' => (object) $rewards,
        ]);
    }

    /**
     * Preserve the current rewards behavior as the default while allowing an
     * administrator to govern future earning and redemption rules.
     */
    public static function rewards_defaults() {
        return [
            'earning_enabled' => true,
            'redemption_enabled' => true,
            'points_per_currency' => 1.0,
            'redemption_block_points' => 500,
            'redemption_block_credit' => 5.0,
            'minimum_order_amount' => 0.0,
            'maximum_points_per_order' => 0,
            'include_shipping' => false,
            'include_tax' => false,
            'rounding' => 'floor',
            'award_statuses' => ['processing', 'completed'],
        ];
    }

    public static function get_rewards_settings() {
        $saved = get_option(self::REWARDS_SETTINGS_OPTION, []);
        $saved = is_array($saved) ? $saved : [];
        return self::sanitize_rewards_settings(array_merge(self::rewards_defaults(), $saved));
    }

    private static function sanitize_rewards_settings($input) {
        $defaults = self::rewards_defaults();
        $input = is_array($input) ? $input : [];
        $statuses = array_values(array_intersect(
            array_map('sanitize_key', (array) ($input['award_statuses'] ?? $defaults['award_statuses'])),
            ['processing', 'completed']
        ));
        if (empty($statuses)) {
            $statuses = ['completed'];
        }
        $rounding = sanitize_key((string) ($input['rounding'] ?? 'floor'));
        if (!in_array($rounding, ['floor', 'round', 'ceil'], true)) {
            $rounding = 'floor';
        }

        return [
            'earning_enabled' => rest_sanitize_boolean($input['earning_enabled'] ?? true),
            'redemption_enabled' => rest_sanitize_boolean($input['redemption_enabled'] ?? true),
            'points_per_currency' => max(0.01, min(100, (float) ($input['points_per_currency'] ?? 1))),
            'redemption_block_points' => max(1, min(1000000, absint($input['redemption_block_points'] ?? 500))),
            'redemption_block_credit' => max(0.01, min(100000, (float) ($input['redemption_block_credit'] ?? 5))),
            'minimum_order_amount' => max(0, min(1000000, (float) ($input['minimum_order_amount'] ?? 0))),
            'maximum_points_per_order' => max(0, min(1000000, absint($input['maximum_points_per_order'] ?? 0))),
            'include_shipping' => rest_sanitize_boolean($input['include_shipping'] ?? false),
            'include_tax' => rest_sanitize_boolean($input['include_tax'] ?? false),
            'rounding' => $rounding,
            'award_statuses' => $statuses,
        ];
    }

    public static function rewards_settings() {
        if (!current_user_can('manage_woocommerce') && !current_user_can('manage_options')) {
            return new WP_Error('phaseone_rewards_forbidden', 'This API owner cannot manage loyalty rules.', ['status' => 403]);
        }
        if (!function_exists('lab_points_get_points_balance_safe')) {
            return new WP_Error('phaseone_rewards_unavailable', 'The active rewards engine is required.', ['status' => 503]);
        }
        return rest_ensure_response(self::rewards_payload());
    }

    private static function rewards_payload() {
        global $wpdb;
        $settings = self::get_rewards_settings();
        $points_key = '_lab_points_balance';
        $credit_key = '_lab_store_credit_balance';
        $total_points = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(CAST(meta_value AS SIGNED)), 0) FROM {$wpdb->usermeta} WHERE meta_key = %s",
            $points_key
        ));
        $members_with_points = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->usermeta} WHERE meta_key = %s AND CAST(meta_value AS SIGNED) > 0",
            $points_key
        ));
        $store_credit = (float) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(CAST(meta_value AS DECIMAL(20,2))), 0) FROM {$wpdb->usermeta} WHERE meta_key = %s",
            $credit_key
        ));
        $block_points = max(1, (int) $settings['redemption_block_points']);
        $redeemable_blocks = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(FLOOR(GREATEST(CAST(meta_value AS SIGNED), 0) / %d)), 0) FROM {$wpdb->usermeta} WHERE meta_key = %s",
            $block_points,
            $points_key
        ));
        $role_counts = count_users();
        $customers = isset($role_counts['avail_roles']['customer']) ? (int) $role_counts['avail_roles']['customer'] : 0;
        $audit = get_option(self::REWARDS_AUDIT_OPTION, []);

        return [
            'version' => '1.3.0',
            'settings' => $settings,
            'metrics' => [
                'customers' => max(0, $customers),
                'members_with_points' => max(0, $members_with_points),
                'points_outstanding' => max(0, $total_points),
                'store_credit_outstanding' => max(0, $store_credit),
                'redeemable_credit_liability' => max(0, $redeemable_blocks * (float) $settings['redemption_block_credit']),
            ],
            'audit' => is_array($audit) ? array_slice(array_values($audit), 0, 25) : [],
        ];
    }

    public static function update_rewards_settings(WP_REST_Request $request) {
        if (!current_user_can('manage_woocommerce') && !current_user_can('manage_options')) {
            return new WP_Error('phaseone_rewards_forbidden', 'This API owner cannot manage loyalty rules.', ['status' => 403]);
        }
        if (!function_exists('lab_points_get_points_balance_safe')) {
            return new WP_Error('phaseone_rewards_unavailable', 'The active rewards engine is required.', ['status' => 503]);
        }
        $input = $request->get_json_params();
        if (!is_array($input) || !isset($input['settings']) || !is_array($input['settings'])) {
            return new WP_Error('phaseone_rewards_invalid', 'A complete loyalty policy is required.', ['status' => 400]);
        }
        $reason = sanitize_text_field((string) ($input['reason'] ?? ''));
        if (strlen($reason) < 5) {
            return new WP_Error('phaseone_rewards_reason_required', 'Enter an internal reason for this policy change.', ['status' => 400]);
        }
        $before = self::get_rewards_settings();
        $after = self::sanitize_rewards_settings(array_merge($before, $input['settings']));
        $conversion_changed =
            (int) $before['redemption_block_points'] !== (int) $after['redemption_block_points'] ||
            abs((float) $before['redemption_block_credit'] - (float) $after['redemption_block_credit']) > 0.0001;
        if ($conversion_changed && empty($input['confirm_liability_change'])) {
            return new WP_Error(
                'phaseone_rewards_liability_confirmation_required',
                'Confirm the liability impact before changing the redemption value of outstanding points.',
                ['status' => 409]
            );
        }

        update_option(self::REWARDS_SETTINGS_OPTION, $after, false);
        $audit = get_option(self::REWARDS_AUDIT_OPTION, []);
        $audit = is_array($audit) ? $audit : [];
        $actor = wp_get_current_user();
        array_unshift($audit, [
            'id' => wp_generate_uuid4(),
            'created_at' => current_time('mysql'),
            'actor_id' => get_current_user_id(),
            'actor_name' => $actor && $actor->exists() ? $actor->display_name : 'Operations administrator',
            'reason' => $reason,
            'before' => $before,
            'after' => $after,
        ]);
        update_option(self::REWARDS_AUDIT_OPTION, array_slice($audit, 0, 50), false);
        if (function_exists('lab_points_clear_admin_stats_cache')) {
            lab_points_clear_admin_stats_cache();
        }
        return rest_ensure_response(self::rewards_payload());
    }

    public static function adjust_customer_points(WP_REST_Request $request) {
        if (!current_user_can('manage_woocommerce') && !current_user_can('manage_options')) {
            return new WP_Error('phaseone_rewards_forbidden', 'This API owner cannot adjust loyalty balances.', ['status' => 403]);
        }
        $required = ['lab_points_get_points_balance_safe', 'lab_points_record_transaction'];
        foreach ($required as $function_name) {
            if (!function_exists($function_name)) {
                return new WP_Error('phaseone_rewards_unavailable', 'The active rewards engine is required.', ['status' => 503]);
            }
        }
        $user_id = absint($request['id']);
        $user = get_userdata($user_id);
        $input = $request->get_json_params();
        $input = is_array($input) ? $input : [];
        $operation = sanitize_key((string) ($input['operation'] ?? 'add'));
        $amount = absint($input['amount'] ?? 0);
        $reason = sanitize_text_field((string) ($input['reason'] ?? ''));
        $notify = !empty($input['notify_customer']);
        if (!$user || !in_array($operation, ['add', 'subtract', 'set'], true) || $amount > 1000000 || strlen($reason) < 5) {
            return new WP_Error('phaseone_rewards_adjustment_invalid', 'Choose a customer, enter a valid amount and include an internal reason.', ['status' => 400]);
        }
        if ('set' !== $operation && $amount < 1) {
            return new WP_Error('phaseone_rewards_adjustment_invalid', 'The adjustment amount must be greater than zero.', ['status' => 400]);
        }

        $before = max(0, (int) lab_points_get_points_balance_safe($user_id));
        $after = 'set' === $operation ? $amount : ('subtract' === $operation ? $before - $amount : $before + $amount);
        if ($after < 0 || $after > 1000000) {
            return new WP_Error('phaseone_rewards_adjustment_out_of_range', 'The resulting balance must stay between zero and 1,000,000 points.', ['status' => 409]);
        }
        $change = $after - $before;
        if (0 === $change) {
            return new WP_Error('phaseone_rewards_no_change', 'The requested adjustment does not change the customer balance.', ['status' => 409]);
        }

        update_user_meta($user_id, '_lab_points_balance', $after);
        $email_sent = null;
        if ($notify && function_exists('lab_points_send_adjustment_email')) {
            $email_sent = (bool) lab_points_send_adjustment_email($user, $change, $after, $reason);
        }
        lab_points_record_transaction($user_id, $change, $before, $after, 'manual_adjustment', $reason, [
            'actor_id' => get_current_user_id(),
            'email_sent' => $email_sent,
        ]);
        if (function_exists('lab_points_clear_admin_stats_cache')) {
            lab_points_clear_admin_stats_cache();
        }
        $history = function_exists('lab_points_get_transaction_history')
            ? lab_points_get_transaction_history($user_id)
            : [];
        return rest_ensure_response([
            'success' => true,
            'customer' => [
                'id' => $user_id,
                'name' => $user->display_name,
                'email' => $user->user_email,
                'points_balance' => $after,
            ],
            'adjustment' => [
                'operation' => $operation,
                'change' => $change,
                'balance_before' => $before,
                'balance_after' => $after,
                'reason' => $reason,
                'email_sent' => $email_sent,
            ],
            'history' => is_array($history) ? array_slice($history, 0, 20) : [],
        ]);
    }

    /**
     * Replace the fixed award callbacks with a compatible policy-aware engine.
     * Existing balances and awarded order metadata are left untouched.
     */
    public static function configure_rewards_engine() {
        if (!function_exists('lab_points_get_points_balance_safe')) {
            return;
        }
        remove_action('woocommerce_order_status_processing', 'lab_points_award_for_order', 10);
        remove_action('woocommerce_order_status_completed', 'lab_points_award_for_order', 10);
        add_action('woocommerce_order_status_processing', [__CLASS__, 'award_points_for_order'], 10, 1);
        add_action('woocommerce_order_status_completed', [__CLASS__, 'award_points_for_order'], 10, 1);
    }

    public static function award_points_for_order($order_id) {
        $settings = self::get_rewards_settings();
        if (empty($settings['earning_enabled']) || !$order_id) {
            return;
        }
        $order = wc_get_order($order_id);
        if (!$order || 'yes' === $order->get_meta('_lab_points_awarded')) {
            return;
        }
        $status = $order->get_status();
        if (!in_array($status, $settings['award_statuses'], true)) {
            return;
        }
        $user_id = $order->get_user_id();
        if (!$user_id) {
            $order->add_order_note('Loyalty: No points awarded because this was a guest order.');
            return;
        }

        $eligible = (float) $order->get_total();
        if (empty($settings['include_shipping'])) {
            $eligible -= (float) $order->get_shipping_total();
        }
        if (empty($settings['include_tax'])) {
            $eligible -= (float) $order->get_total_tax();
        }
        $eligible = max(0, $eligible);
        if ($eligible < (float) $settings['minimum_order_amount']) {
            $order->add_order_note('Loyalty: No points awarded because the eligible amount was below the configured minimum.');
            return;
        }
        $raw_points = $eligible * (float) $settings['points_per_currency'];
        if ('ceil' === $settings['rounding']) {
            $points = (int) ceil($raw_points);
        } elseif ('round' === $settings['rounding']) {
            $points = (int) round($raw_points);
        } else {
            $points = (int) floor($raw_points);
        }
        if ((int) $settings['maximum_points_per_order'] > 0) {
            $points = min($points, (int) $settings['maximum_points_per_order']);
        }
        if ($points <= 0) {
            return;
        }

        $before = max(0, (int) lab_points_get_points_balance_safe($user_id));
        $after = $before + $points;
        update_user_meta($user_id, '_lab_points_balance', $after);
        lab_points_record_transaction(
            $user_id,
            $points,
            $before,
            $after,
            'order_earned',
            sprintf('Points earned from order #%s.', $order->get_order_number()),
            ['order_id' => $order_id, 'actor_id' => 0]
        );
        if (function_exists('lab_points_clear_admin_stats_cache')) {
            lab_points_clear_admin_stats_cache();
        }
        $order->update_meta_data('_lab_points_awarded', 'yes');
        $order->update_meta_data('_lab_points_earned', $points);
        $order->save();
        $order->add_order_note(sprintf('Loyalty: %d points awarded. New balance: %d.', $points, $after));
    }

    public static function register_rewards_redemption_override() {
        if (!function_exists('lab_points_get_user_by_token')) {
            return;
        }
        register_rest_route('lab/v1', '/rewards-policy', [
            'methods' => WP_REST_Server::READABLE,
            'callback' => [__CLASS__, 'public_rewards_policy'],
            'permission_callback' => '__return_true',
        ], true);
        register_rest_route('lab/v1', '/redeem-points', [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => [__CLASS__, 'redeem_points'],
            'permission_callback' => '__return_true',
        ], true);
    }

    public static function public_rewards_policy() {
        $settings = self::get_rewards_settings();
        return rest_ensure_response([
            'earning_enabled' => (bool) $settings['earning_enabled'],
            'points_per_currency' => (float) $settings['points_per_currency'],
            'minimum_order_amount' => (float) $settings['minimum_order_amount'],
            'maximum_points_per_order' => (int) $settings['maximum_points_per_order'],
            'include_shipping' => (bool) $settings['include_shipping'],
            'include_tax' => (bool) $settings['include_tax'],
            'rounding' => (string) $settings['rounding'],
            'redemption_enabled' => (bool) $settings['redemption_enabled'],
            'redemption_block_points' => (int) $settings['redemption_block_points'],
            'redemption_block_credit' => (float) $settings['redemption_block_credit'],
        ]);
    }

    public static function redeem_points(WP_REST_Request $request) {
        $settings = self::get_rewards_settings();
        if (empty($settings['redemption_enabled'])) {
            return new WP_Error('phaseone_redemption_paused', 'Point redemption is temporarily paused.', ['status' => 409]);
        }
        $auth_header = $request->get_header('authorization');
        if (!$auth_header || stripos($auth_header, 'Bearer ') !== 0) {
            return new WP_Error('missing_token', 'Authorization token is required.', ['status' => 401]);
        }
        $token = trim(str_ireplace('Bearer ', '', $auth_header));
        $user = lab_points_get_user_by_token($token);
        if (!$user) {
            return new WP_Error('invalid_token', 'Invalid or expired token.', ['status' => 401]);
        }
        $input = $request->get_json_params();
        $input = is_array($input) ? $input : [];
        $points = intval($input['points'] ?? 0);
        $credit = (float) ($input['credit'] ?? 0);
        $block_points = max(1, (int) $settings['redemption_block_points']);
        $block_credit = max(0.01, (float) $settings['redemption_block_credit']);
        if ($points <= 0 || $points % $block_points !== 0) {
            return new WP_Error('invalid_points_block', 'Points must be redeemed in blocks of ' . $block_points . '.', ['status' => 400]);
        }
        $expected_credit = ($points / $block_points) * $block_credit;
        if ($credit > 0 && abs($credit - $expected_credit) > 0.0001) {
            return new WP_Error('invalid_credit_amount', 'Credit amount does not match the current conversion rule.', [
                'status' => 400,
                'expected_credit' => $expected_credit,
                'received_credit' => $credit,
            ]);
        }
        $available = max(0, (int) lab_points_get_points_balance_safe($user->ID));
        if ($available < $points) {
            return new WP_Error('not_enough_points', 'Not enough points available.', ['status' => 400, 'available_points' => $available]);
        }
        $current_credit = (float) lab_points_get_store_credit_balance($user->ID);
        $next_points = $available - $points;
        $next_credit = $current_credit + $expected_credit;
        update_user_meta($user->ID, '_lab_points_balance', $next_points);
        update_user_meta($user->ID, '_lab_store_credit_balance', $next_credit);
        lab_points_record_transaction(
            $user->ID,
            -$points,
            $available,
            $next_points,
            'store_credit_redemption',
            sprintf('%s points converted into $%s store credit.', number_format_i18n($points), wc_format_decimal($expected_credit, 2)),
            ['actor_id' => $user->ID]
        );
        $history = lab_points_get_store_credit_redemptions($user->ID);
        $record = [
            'id' => 'redemption_' . wp_generate_uuid4(),
            'points' => $points,
            'credit' => $expected_credit,
            'currency' => 'USD',
            'created_at' => current_time('mysql'),
            'status' => 'completed',
            'note' => $points . ' points converted into $' . $expected_credit . ' store credit.',
        ];
        array_unshift($history, $record);
        lab_points_save_store_credit_redemptions($user->ID, $history);
        if (function_exists('lab_points_clear_admin_stats_cache')) {
            lab_points_clear_admin_stats_cache();
        }
        return rest_ensure_response([
            'success' => true,
            'message' => number_format_i18n($points) . ' points were converted into $' . wc_format_decimal($expected_credit, 2) . ' store credit.',
            'points' => $next_points,
            'pointsBalance' => $next_points,
            'points_balance' => $next_points,
            'store_credit' => $next_credit,
            'storeCredit' => $next_credit,
            'credit' => $next_credit,
            'store_credit_redemptions' => lab_points_get_store_credit_redemptions($user->ID),
            'redemption' => $record,
        ]);
    }

    public static function update_site_controls(WP_REST_Request $request) {
        if (!current_user_can('manage_woocommerce') && !current_user_can('manage_options')) {
            return new WP_Error('phaseone_site_controls_forbidden', 'This API owner cannot manage storefront controls.', ['status' => 403]);
        }
        $required_functions = [
            'phaseone_site_controls_get',
            'phaseone_site_controls_apply_promo_fields',
            'phaseone_site_controls_apply_maintenance_fields',
            'phaseone_site_controls_restore_persisted_sale',
            'phaseone_site_controls_promo_is_live',
            'phaseone_site_controls_apply_persisted_sale',
            'phaseone_site_controls_payload',
        ];
        foreach ($required_functions as $function_name) {
            if (!function_exists($function_name)) {
                return new WP_Error('phaseone_site_controls_unavailable', 'Phase One Site Controls 1.7.0 or newer is required.', ['status' => 503]);
            }
        }

        $input = $request->get_json_params();
        $promo = is_array($input) && isset($input['promo']) && is_array($input['promo']) ? $input['promo'] : [];
        $maintenance = is_array($input) && isset($input['maintenance']) && is_array($input['maintenance']) ? $input['maintenance'] : [];
        $type = sanitize_key((string) ($promo['type'] ?? 'general'));
        if (!in_array($type, ['general', 'product', 'simple_gifts'], true)) {
            return new WP_Error('phaseone_site_controls_invalid_type', 'Select a valid promotion type.', ['status' => 400]);
        }

        $settings = phaseone_site_controls_get();
        $duration_days = max(0, min(30, absint($promo['durationDays'] ?? 0)));
        $duration_hours = max(0, min(23, absint($promo['durationHours'] ?? 0)));
        $duration_minutes = max(0, min(59, absint($promo['durationMinutes'] ?? 0)));
        $post = [
            'promo_type' => $type,
            'promo_product_id' => absint($promo['productId'] ?? 0),
            'promo_sale_price' => wc_format_decimal((string) ($promo['salePrice'] ?? ''), false),
            'promo_sitewide_label' => sanitize_text_field((string) ($promo['sitewideLabel'] ?? '10% SITEWIDE')),
            'promo_eyebrow' => sanitize_text_field((string) ($promo['eyebrow'] ?? '')),
            'promo_title' => sanitize_text_field((string) ($promo['title'] ?? '')),
            'promo_info' => sanitize_textarea_field((string) ($promo['info'] ?? '')),
            'promo_cta_label' => sanitize_text_field((string) ($promo['ctaLabel'] ?? '')),
            'promo_cta_url' => (string) ($promo['ctaUrl'] ?? '/shop'),
            'promo_duration_days' => $duration_days,
            'promo_duration_hours' => $duration_hours,
            'promo_duration_minutes_part' => $duration_minutes,
            'maintenance_title' => sanitize_text_field((string) ($maintenance['title'] ?? '')),
            'maintenance_message' => sanitize_textarea_field((string) ($maintenance['message'] ?? '')),
            'maintenance_support_email' => sanitize_email((string) ($maintenance['supportEmail'] ?? '')),
        ];
        if (!empty($promo['enabled'])) {
            $post['promo_enabled'] = '1';
        }
        if (!empty($promo['restart'])) {
            $post['promo_restart'] = '1';
        }
        if (!empty($settings['promo_auto_copy'])) {
            $post['promo_auto_copy'] = '1';
        }

        $post['promo_variant_ids'] = [];
        $post['promo_variant_sale_prices'] = [];
        foreach ((array) ($settings['promo_variant_sales'] ?? []) as $row) {
            if (!is_array($row)) {
                continue;
            }
            $post['promo_variant_ids'][] = absint($row['variation_id'] ?? 0);
            $post['promo_variant_sale_prices'][] = (string) ($row['sale_price'] ?? '');
        }
        $post['promo_gift_tiers'] = [];
        foreach ((array) ($settings['promo_gift_tiers'] ?? []) as $tier_index => $tier) {
            if (!is_array($tier)) {
                continue;
            }
            $post['promo_gift_tiers'][$tier_index] = [
                'threshold' => (string) ($tier['threshold'] ?? ''),
                'rewards' => [],
            ];
            foreach ((array) ($tier['rewards'] ?? []) as $reward_index => $reward) {
                $options = [];
                foreach ((array) ($reward['options'] ?? []) as $option) {
                    if (!is_array($option)) {
                        continue;
                    }
                    $product_id = absint($option['product_id'] ?? 0);
                    if ($product_id) {
                        $options[] = $product_id . ':' . absint($option['variation_id'] ?? 0);
                    }
                }
                $post['promo_gift_tiers'][$tier_index]['rewards'][$reward_index] = ['options' => $options];
            }
        }

        $previous_post = $_POST;
        $_POST = $post;
        phaseone_site_controls_restore_persisted_sale();
        $settings = phaseone_site_controls_apply_promo_fields($settings);
        $validation_notice = isset($settings['_phaseone_validation_notice']) ? sanitize_key($settings['_phaseone_validation_notice']) : '';
        unset($settings['_phaseone_validation_notice']);
        $settings = phaseone_site_controls_apply_maintenance_fields($settings);
        $_POST = $previous_post;

        $settings['maintenance_enabled'] = !empty($maintenance['enabled']);
        $settings['maintenance_updated_at'] = gmdate('c');
        update_option('phaseone_site_controls', $settings, false);
        if ($validation_notice !== '') {
            return new WP_Error($validation_notice, 'The promotion was not activated because its configuration is incomplete or invalid.', ['status' => 400]);
        }
        if ('product' === ($settings['promo_type'] ?? 'general') && phaseone_site_controls_promo_is_live($settings)) {
            if (!phaseone_site_controls_apply_persisted_sale($settings)) {
                $settings['promo_enabled'] = false;
                update_option('phaseone_site_controls', $settings, false);
                return new WP_Error('promo_sale_apply_failed', 'The temporary sale price could not be applied. The campaign remains off.', ['status' => 409]);
            }
        }
        return rest_ensure_response(phaseone_site_controls_payload($settings));
    }

    public static function clean_reward_activity($item) {
        if (!is_array($item)) {
            return null;
        }
        $context = isset($item['context']) && is_array($item['context']) ? $item['context'] : [];
        return [
            'id' => sanitize_text_field((string) ($item['id'] ?? '')),
            'change' => (int) ($item['change'] ?? 0),
            'balance_before' => max(0, (int) ($item['balance_before'] ?? 0)),
            'balance_after' => max(0, (int) ($item['balance_after'] ?? 0)),
            'type' => sanitize_key((string) ($item['type'] ?? 'activity')),
            'reason' => sanitize_text_field((string) ($item['reason'] ?? '')),
            'created_at' => sanitize_text_field((string) ($item['created_at'] ?? '')),
            'context' => ['order_id' => absint($context['order_id'] ?? $item['order_id'] ?? 0)],
        ];
    }

    public static function clean_redemption($item) {
        if (!is_array($item)) {
            return null;
        }
        return [
            'points' => max(0, (int) ($item['points'] ?? $item['points_redeemed'] ?? 0)),
            'credit' => max(0, (float) ($item['credit'] ?? $item['credit_amount'] ?? 0)),
            'created_at' => sanitize_text_field((string) ($item['created_at'] ?? $item['date'] ?? '')),
        ];
    }

    public static function authenticate_write_key(WP_REST_Request $request) {
        if (current_user_can('edit_posts')) {
            return true;
        }

        if (!function_exists('wc_api_hash')) {
            return new WP_Error('phaseone_bridge_unavailable', 'Commerce authentication is unavailable.', ['status' => 503]);
        }

        $consumer_key = trim((string) $request->get_header('x_phaseone_consumer_key'));
        $consumer_secret = trim((string) $request->get_header('x_phaseone_consumer_secret'));
        if ($consumer_key === '' || $consumer_secret === '' || strpos($consumer_key, 'ck_') !== 0) {
            return new WP_Error('phaseone_bridge_unauthorized', 'Valid write credentials are required.', ['status' => 401]);
        }

        global $wpdb;
        $table = $wpdb->prefix . 'woocommerce_api_keys';
        $key = $wpdb->get_row($wpdb->prepare(
            "SELECT user_id, permissions, consumer_secret FROM {$table} WHERE consumer_key = %s LIMIT 1",
            wc_api_hash($consumer_key)
        ));

        if (!$key || !hash_equals((string) $key->consumer_secret, $consumer_secret)) {
            return new WP_Error('phaseone_bridge_unauthorized', 'The supplied credentials were rejected.', ['status' => 401]);
        }
        if (!in_array((string) $key->permissions, ['write', 'read_write'], true)) {
            return new WP_Error('phaseone_bridge_read_only', 'This connection is read only.', ['status' => 403]);
        }

        $user_id = absint($key->user_id);
        if ($user_id < 1 || !user_can($user_id, 'edit_posts')) {
            return new WP_Error('phaseone_bridge_forbidden', 'The API owner cannot edit COA records.', ['status' => 403]);
        }

        wp_set_current_user($user_id);
        return true;
    }

    public static function update_coa(WP_REST_Request $request) {
        $post_id = self::find_coa_post_id(sanitize_text_field((string) $request['id']));
        if (!$post_id) {
            return new WP_Error('phaseone_coa_not_found', 'COA record not found.', ['status' => 404]);
        }
        if (!current_user_can('edit_post', $post_id)) {
            return new WP_Error('phaseone_coa_forbidden', 'This API owner cannot edit the requested COA.', ['status' => 403]);
        }

        $input = $request->get_json_params();
        if (!is_array($input)) {
            return new WP_Error('phaseone_coa_invalid', 'A JSON COA record is required.', ['status' => 400]);
        }

        $text_fields = [
            'coaNumber' => 'coa_number', 'productName' => 'product_name', 'compound' => 'compound',
            'familyName' => 'family_name', 'familyKey' => 'family_key', 'strength' => 'strength',
            'batch' => 'batch', 'lot' => 'lot', 'date' => 'date', 'status' => 'status',
            'purity' => 'purity', 'laboratory' => 'laboratory', 'method' => 'method', 'tested' => 'tested',
        ];
        foreach ($text_fields as $source => $target) {
            if (!array_key_exists($source, $input)) {
                continue;
            }
            $value = sanitize_text_field((string) $input[$source]);
            if ($target === 'family_key') {
                $value = sanitize_title($value);
            }
            update_post_meta($post_id, self::META_PREFIX . $target, $value);
        }

        foreach (['verifyUrl' => 'verify_url', 'fileUrl' => 'file_url'] as $source => $target) {
            if (array_key_exists($source, $input)) {
                update_post_meta($post_id, self::META_PREFIX . $target, esc_url_raw((string) $input[$source]));
            }
        }

        foreach (['matchedProductId' => 'matched_product_id', 'matchedVariationId' => 'matched_variation_id', 'fileAttachmentId' => 'file_attachment_id'] as $source => $target) {
            if (array_key_exists($source, $input)) {
                update_post_meta($post_id, self::META_PREFIX . $target, absint($input[$source]));
            }
        }

        foreach (['skus' => 'skus', 'aliases' => 'aliases', 'keywords' => 'keywords'] as $source => $target) {
            if (array_key_exists($source, $input)) {
                update_post_meta($post_id, self::META_PREFIX . $target, self::clean_text_list($input[$source]));
            }
        }

        if (array_key_exists('panelTypes', $input)) {
            $panels = array_values(array_intersect(self::clean_text_list($input['panelTypes']), ['3x', 'standard', 'full', '8x']));
            update_post_meta($post_id, self::META_PREFIX . 'panel_types', $panels);
        }

        if (array_key_exists('currentShippingLot', $input)) {
            $is_current = rest_sanitize_boolean($input['currentShippingLot']);
            self::set_current_state($post_id, $is_current);
            if ($is_current && get_option('p1coa_auto_unmark_current', '1') === '1') {
                self::unmark_family_lots($post_id);
            }
        }

        $title = trim((string) get_post_meta($post_id, self::META_PREFIX . 'product_name', true));
        if ($title === '') {
            $title = trim((string) get_post_meta($post_id, self::META_PREFIX . 'family_name', true));
        }
        if ($title !== '') {
            wp_update_post(['ID' => $post_id, 'post_title' => $title]);
        }

        clean_post_cache($post_id);
        $record_id = trim((string) get_post_meta($post_id, self::META_PREFIX . 'custom_id', true));
        if ($record_id === '') {
            $record_id = trim((string) get_post_meta($post_id, self::META_PREFIX . 'coa_number', true));
        }
        $record_response = rest_do_request('/phaseone/v1/coas/' . rawurlencode($record_id));
        if (!$record_response->is_error()) {
            return rest_ensure_response($record_response->get_data());
        }

        return rest_ensure_response(['updated' => true, 'id' => $record_id, 'wpPostId' => $post_id]);
    }

    private static function find_coa_post_id($id) {
        if (ctype_digit((string) $id)) {
            $numeric_id = absint($id);
            if ($numeric_id > 0 && get_post_type($numeric_id) === self::COA_POST_TYPE) {
                return $numeric_id;
            }
        }

        $posts = get_posts([
            'post_type' => self::COA_POST_TYPE,
            'post_status' => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => 1,
            'fields' => 'ids',
            'meta_query' => [
                'relation' => 'OR',
                ['key' => self::META_PREFIX . 'custom_id', 'value' => $id, 'compare' => '='],
                ['key' => self::META_PREFIX . 'coa_number', 'value' => $id, 'compare' => '='],
            ],
        ]);
        return empty($posts) ? 0 : absint($posts[0]);
    }

    private static function clean_text_list($value) {
        if (!is_array($value)) {
            $value = preg_split('/[\r\n,]+/', (string) $value);
        }
        $value = array_map('sanitize_text_field', array_map('strval', $value));
        $value = array_values(array_unique(array_filter(array_map('trim', $value))));
        return $value;
    }

    private static function set_current_state($post_id, $is_current) {
        $value = $is_current ? '1' : '0';
        foreach (['current_shipping_lot', 'active_shipping_lot', 'current_coa_current_shipping_lot'] as $key) {
            update_post_meta($post_id, self::META_PREFIX . $key, $value);
        }
    }

    private static function unmark_family_lots($post_id) {
        $family_key = sanitize_title((string) get_post_meta($post_id, self::META_PREFIX . 'family_key', true));
        $strength = strtolower(trim((string) get_post_meta($post_id, self::META_PREFIX . 'strength', true)));
        if ($family_key === '') {
            return;
        }
        $ids = get_posts([
            'post_type' => self::COA_POST_TYPE,
            'post_status' => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => -1,
            'fields' => 'ids',
            'post__not_in' => [$post_id],
            'meta_key' => self::META_PREFIX . 'family_key',
            'meta_value' => $family_key,
        ]);
        foreach ($ids as $other_id) {
            $other_strength = strtolower(trim((string) get_post_meta($other_id, self::META_PREFIX . 'strength', true)));
            if ($strength !== '' && $other_strength !== $strength) {
                continue;
            }
            self::set_current_state($other_id, false);
        }
    }
}

Phase_One_Operations_Bridge::init();

