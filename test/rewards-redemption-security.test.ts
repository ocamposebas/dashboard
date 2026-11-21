import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginPath = new URL(
  "../wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php",
  import.meta.url,
);

test("rewards redemption uses a per-customer database lock and transaction", async () => {
  const source = await readFile(pluginPath, "utf8");

  assert.match(source, /Version: 2\.2\.4/);
  assert.match(source, /'version' => '2\.2\.4'/);
  assert.match(source, /SELECT GET_LOCK\(%s, %d\)/);
  assert.match(source, /SELECT RELEASE_LOCK\(%s\)/);
  assert.match(source, /START TRANSACTION/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /COMMIT/);
  assert.match(source, /ROLLBACK/);
  assert.match(source, /write_reward_balance/);
});
test("rewards redemption requires and persists an idempotency key", async () => {
  const source = await readFile(pluginPath, "utf8");

  assert.match(source, /x-phaseone-idempotency-key/);
  assert.match(source, /missing_idempotency_key/);
  assert.match(source, /hash_hmac\('sha256'/);
  assert.match(source, /phaseone_ops_rewards_security_secret_v1/);
  assert.match(source, /add_option\(self::REWARDS_SECURITY_SECRET_OPTION, \$candidate, '', false\)/);
  assert.match(source, /random_bytes\(32\)/);
  assert.match(source, /rewards-idempotency:v1:/);
  assert.match(source, /rewards-lock:v1:/);
  assert.doesNotMatch(source, /wp_salt\('auth'\)/);
  assert.match(source, /redemption_by_idempotency/);
  assert.match(source, /redemption_idempotency_meta_key/);
  assert.match(source, /_p1_reward_idem_/);
  assert.match(source, /idempotency_conflict/);
  assert.match(source, /'idempotency_key' => \$idempotency_hash/);
  assert.match(source, /'idempotent' => !empty\(\$record\['idempotent_replay'\]\)/);
  assert.doesNotMatch(
    source,
    /lab_points_save_store_credit_redemptions\([^;]*array_slice/,
  );
});

test("points and store credit are not updated by separate user-meta calls", async () => {
  const source = await readFile(pluginPath, "utf8");
  const redeemFunction = source.slice(
    source.indexOf("public static function redeem_points"),
    source.indexOf("public static function update_site_controls"),
  );

  assert.doesNotMatch(
    redeemFunction,
    /update_user_meta\(\$user->ID, '_lab_(?:points|store_credit)_balance'/,
  );
  assert.match(
    redeemFunction,
    /write_reward_balance\(\$user->ID, '_lab_points_balance', \$next_points\)/,
  );
  assert.match(
    redeemFunction,
    /write_reward_balance\(\$user->ID, '_lab_store_credit_balance', \$next_credit\)/,
  );
});

test("every points mutation shares the customer lock and database transaction", async () => {
  const source = await readFile(pluginPath, "utf8");
  const adjustment = source.slice(
    source.indexOf("public static function adjust_customer_points"),
    source.indexOf("public static function configure_rewards_engine"),
  );
  const award = source.slice(
    source.indexOf("public static function award_points_for_order"),
    source.indexOf("public static function register_rewards_redemption_override"),
  );

  for (const operation of [adjustment, award]) {
    assert.match(operation, /rewards_lock_name\(/);
    assert.match(operation, /acquire_rewards_lock\(/);
    assert.match(operation, /release_rewards_lock\(/);
    assert.match(operation, /START TRANSACTION/);
    assert.match(operation, /locked_reward_balances\(/);
    assert.match(operation, /write_reward_balance\(/);
    assert.match(operation, /COMMIT/);
    assert.match(operation, /ROLLBACK/);
    assert.doesNotMatch(
      operation,
      /update_user_meta\([^\n]*_lab_points_balance/,
    );
  }
});

test("order points award is atomically marked and safely retryable", async () => {
  const source = await readFile(pluginPath, "utf8");
  const award = source.slice(
    source.indexOf("public static function award_points_for_order"),
    source.indexOf("public static function register_rewards_redemption_override"),
  );

  assert.match(source, /phaseone_retry_award_points_for_order/);
  assert.match(award, /read_meta_data\(true\)/);
  assert.match(award, /get_meta\('_lab_points_awarded', true\)/);
  assert.match(award, /update_meta_data\('_lab_points_awarded', 'yes'\)/);
  assert.ok(
    award.indexOf("update_meta_data('_lab_points_awarded', 'yes')") <
      award.indexOf("$wpdb->query('COMMIT')"),
    "the awarded marker must be persisted before the transaction commits",
  );
  assert.match(award, /schedule_points_award_retry\(\$order_id\)/);
  assert.match(award, /reload_order_after_rewards_rollback\(\$order, \$order_id\)/);
  assert.ok(
    award.indexOf("reload_order_after_rewards_rollback($order, $order_id)") <
      award.lastIndexOf("schedule_points_award_retry($order_id)"),
    "rolled-back order metadata must be evicted and reloaded before scheduling the retry",
  );
});

test("rolled-back order awards clear WooCommerce caches before reloading metadata", async () => {
  const source = await readFile(pluginPath, "utf8");
  const reload = source.slice(
    source.indexOf("private static function reload_order_after_rewards_rollback"),
    source.indexOf("private static function points_for_order"),
  );

  assert.match(reload, /clear_caches/);
  assert.match(reload, /wp_cache_delete\(\$order_id, 'post_meta'\)/);
  assert.match(reload, /wp_cache_delete\('orders-' \. \$order_id, 'orders'\)/);
  assert.match(reload, /read_meta_data\(true\)/);
  assert.match(reload, /wc_get_order\(\$order_id\)/);
});

test("operations bridge removes WordPress disclosure headers and disables XML-RPC pingbacks", async () => {
  const source = await readFile(pluginPath, "utf8");

  assert.match(source, /header_remove\('X-Powered-By'\)/);
  assert.match(source, /header_remove\('X-Pingback'\)/);
  assert.match(source, /add_filter\('the_generator', '__return_empty_string'/);
  assert.match(source, /add_filter\('xmlrpc_enabled', '__return_false'/);
  assert.match(source, /add_filter\('xmlrpc_methods', \[__CLASS__, 'disable_xmlrpc_methods'\]/);
  assert.match(source, /add_filter\('pings_open', '__return_false'/);
  assert.match(source, /unset\(\$headers\['X-Pingback'\]/);
  assert.match(source, /remove_action\('wp_head', 'wp_generator'\)/);
  assert.match(source, /header\('X-Content-Type-Options: nosniff', true\)/);
  assert.match(source, /header\('Referrer-Policy: strict-origin-when-cross-origin', true\)/);
  assert.match(source, /header\('X-Frame-Options: SAMEORIGIN', true\)/);
  assert.match(source, /function_exists\('is_ssl'\) && is_ssl\(\)/);
  assert.match(source, /header\('Strict-Transport-Security: max-age=31536000', true\)/);
  assert.match(source, /header_remove\('Strict-Transport-Security'\)/);
});
