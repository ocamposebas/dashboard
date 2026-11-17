import type { QueryResultRow } from "pg";

import type {
  DeliveryAlertKind,
  DeliveryMonitorItem,
  DeliveryMonitorSettings,
  DeliveryMonitorStatus,
} from "../shared/deliveryMonitor.js";
import type { Database } from "./database.js";

export interface TrackableShippingLabel {
  labelId: string;
  fulfillmentId: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  trackingNumber: string;
  carrierCode: string;
  serviceCode: string;
  createdAt: string;
}

interface SettingsRow extends QueryResultRow {
  delay_days: string | number;
  recipient_user_id: string | null;
  email_enabled: boolean;
  initialized_at: Date | string | null;
  last_run_at: Date | string | null;
  last_run_error: string | null;
}

interface ShipmentRow extends QueryResultRow {
  label_id: string;
  fulfillment_id: string;
  order_id: string | number;
  order_number: string;
  customer_name: string;
  tracking_number: string;
  carrier_code: string;
  service_code: string;
  shipped_at: Date | string;
  estimated_delivery_at: Date | string | null;
  delivered_at: Date | string | null;
  last_event_at: Date | string | null;
  last_event_description: string | null;
  status: DeliveryMonitorStatus;
  status_description: string;
  exception_description: string | null;
  days_in_transit: string | number;
  is_delayed: boolean;
  alert_kind: DeliveryAlertKind;
  alert_sent_at: Date | string | null;
  alert_error: string | null;
  acknowledged_at: Date | string | null;
  acknowledged_by: string | null;
  last_checked_at: Date | string | null;
  last_check_error: string | null;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function settingsFromRow(row: SettingsRow): DeliveryMonitorSettings {
  return {
    delayDays: Number(row.delay_days),
    recipientUserId: row.recipient_user_id,
    emailEnabled: row.email_enabled,
    initializedAt: iso(row.initialized_at),
    lastRunAt: iso(row.last_run_at),
    lastRunError: row.last_run_error,
  };
}

function itemFromRow(row: ShipmentRow): DeliveryMonitorItem {
  return {
    labelId: row.label_id,
    fulfillmentId: row.fulfillment_id,
    orderId: Number(row.order_id),
    orderNumber: row.order_number,
    customerName: row.customer_name,
    trackingNumber: row.tracking_number,
    carrierCode: row.carrier_code,
    serviceCode: row.service_code,
    shippedAt: iso(row.shipped_at) || new Date(0).toISOString(),
    estimatedDeliveryAt: iso(row.estimated_delivery_at),
    deliveredAt: iso(row.delivered_at),
    lastEventAt: iso(row.last_event_at),
    lastEventDescription: row.last_event_description,
    status: row.status,
    statusDescription: row.status_description,
    exceptionDescription: row.exception_description,
    daysInTransit: Number(row.days_in_transit),
    delayed: row.is_delayed,
    alertKind: row.alert_kind,
    alertSentAt: iso(row.alert_sent_at),
    alertError: row.alert_error,
    acknowledgedAt: iso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by,
    lastCheckedAt: iso(row.last_checked_at),
    lastCheckError: row.last_check_error,
  };
}

const SHIPMENT_COLUMNS = `label_id, fulfillment_id, order_id, order_number, customer_name,
  tracking_number, carrier_code, service_code, shipped_at, estimated_delivery_at,
  delivered_at, last_event_at, last_event_description, status, status_description,
  exception_description, days_in_transit, is_delayed, alert_kind, alert_sent_at,
  alert_error, acknowledged_at, acknowledged_by, last_checked_at, last_check_error`;

export class DeliveryMonitorRepository {
  constructor(private readonly database: Database) {}

  async getSettings(): Promise<DeliveryMonitorSettings> {
    const result = await this.database.query<SettingsRow>(`
      SELECT delay_days, recipient_user_id, email_enabled, initialized_at,
        last_run_at, last_run_error
      FROM delivery_monitor_settings WHERE id = 1
    `);
    const row = result.rows[0];
    if (!row) throw new Error("Delivery monitor settings are not initialized");
    return settingsFromRow(row);
  }

  async saveSettings(input: {
    delayDays: number;
    recipientUserId: string | null;
    emailEnabled: boolean;
  }): Promise<DeliveryMonitorSettings> {
    const delayDays = Math.max(1, Math.min(30, Math.trunc(input.delayDays) || 5));
    const recipientUserId = input.recipientUserId?.trim().slice(0, 100) || null;
    const result = await this.database.query<SettingsRow>(`
      UPDATE delivery_monitor_settings
      SET delay_days = $1, recipient_user_id = $2, email_enabled = $3, updated_at = now()
      WHERE id = 1
      RETURNING delay_days, recipient_user_id, email_enabled, initialized_at,
        last_run_at, last_run_error
    `, [delayDays, recipientUserId, input.emailEnabled]);
    return settingsFromRow(result.rows[0]!);
  }

  async completeRun(error: string | null, initialize = false): Promise<DeliveryMonitorSettings> {
    const result = await this.database.query<SettingsRow>(`
      UPDATE delivery_monitor_settings
      SET last_run_at = now(), last_run_error = $1,
        initialized_at = CASE WHEN $2::boolean AND initialized_at IS NULL THEN now() ELSE initialized_at END,
        updated_at = now()
      WHERE id = 1
      RETURNING delay_days, recipient_user_id, email_enabled, initialized_at,
        last_run_at, last_run_error
    `, [error?.slice(0, 1000) || null, initialize]);
    return settingsFromRow(result.rows[0]!);
  }

  async listTrackableLabels(limit = 250): Promise<TrackableShippingLabel[]> {
    const result = await this.database.query<{
      label_id: string; fulfillment_id: string; order_id: string | number; order_number: string;
      customer_name: string; tracking_number: string; carrier_code: string; service_code: string;
      created_at: Date | string;
    }>(`
      SELECT labels.label_id, labels.fulfillment_id, labels.order_id, labels.order_number,
        COALESCE(labels.destination_snapshot->>'name', '') AS customer_name,
        labels.tracking_number, labels.carrier_code, labels.service_code, labels.created_at
      FROM fulfillment_shipping_labels labels
      LEFT JOIN delivery_monitor_shipments monitored ON monitored.label_id = labels.label_id
      WHERE labels.state = 'label_ready'
        AND labels.voided_at IS NULL
        AND labels.label_id IS NOT NULL AND length(trim(labels.label_id)) > 0
        AND labels.tracking_number IS NOT NULL AND length(trim(labels.tracking_number)) > 0
        AND labels.created_at >= now() - interval '180 days'
        AND (monitored.label_id IS NULL OR monitored.status <> 'delivered')
      ORDER BY labels.created_at DESC
      LIMIT $1
    `, [Math.max(1, Math.min(1000, Math.trunc(limit) || 250))]);
    return result.rows.map((row) => ({
      labelId: row.label_id,
      fulfillmentId: row.fulfillment_id,
      orderId: Number(row.order_id),
      orderNumber: row.order_number,
      customerName: row.customer_name,
      trackingNumber: row.tracking_number,
      carrierCode: row.carrier_code,
      serviceCode: row.service_code,
      createdAt: iso(row.created_at) || new Date().toISOString(),
    }));
  }

  async getByLabelId(labelId: string): Promise<DeliveryMonitorItem | null> {
    const result = await this.database.query<ShipmentRow>(`
      SELECT ${SHIPMENT_COLUMNS} FROM delivery_monitor_shipments WHERE label_id = $1
    `, [labelId]);
    return result.rows[0] ? itemFromRow(result.rows[0]) : null;
  }

  async list(limit = 500): Promise<DeliveryMonitorItem[]> {
    const result = await this.database.query<ShipmentRow>(`
      SELECT ${SHIPMENT_COLUMNS}
      FROM delivery_monitor_shipments
      ORDER BY
        CASE WHEN status = 'exception' THEN 0 WHEN is_delayed THEN 1 WHEN status = 'delivery_attempt' THEN 2 ELSE 3 END,
        shipped_at ASC
      LIMIT $1
    `, [Math.max(1, Math.min(1000, Math.trunc(limit) || 500))]);
    return result.rows.map(itemFromRow);
  }

  async upsertTracking(input: Omit<DeliveryMonitorItem,
    "alertSentAt" | "alertError" | "acknowledgedAt" | "acknowledgedBy" |
    "lastCheckedAt" | "lastCheckError"
  >): Promise<DeliveryMonitorItem> {
    const result = await this.database.query<ShipmentRow>(`
      INSERT INTO delivery_monitor_shipments (
        label_id, fulfillment_id, order_id, order_number, customer_name,
        tracking_number, carrier_code, service_code, shipped_at,
        estimated_delivery_at, delivered_at, last_event_at, last_event_description,
        status, status_description, exception_description, days_in_transit,
        is_delayed, alert_kind, last_checked_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now()
      )
      ON CONFLICT (label_id) DO UPDATE SET
        fulfillment_id = EXCLUDED.fulfillment_id,
        order_id = EXCLUDED.order_id,
        order_number = EXCLUDED.order_number,
        customer_name = EXCLUDED.customer_name,
        tracking_number = EXCLUDED.tracking_number,
        carrier_code = EXCLUDED.carrier_code,
        service_code = EXCLUDED.service_code,
        shipped_at = EXCLUDED.shipped_at,
        estimated_delivery_at = EXCLUDED.estimated_delivery_at,
        delivered_at = EXCLUDED.delivered_at,
        last_event_at = EXCLUDED.last_event_at,
        last_event_description = EXCLUDED.last_event_description,
        status = EXCLUDED.status,
        status_description = EXCLUDED.status_description,
        exception_description = EXCLUDED.exception_description,
        days_in_transit = EXCLUDED.days_in_transit,
        is_delayed = EXCLUDED.is_delayed,
        alert_kind = EXCLUDED.alert_kind,
        acknowledged_at = CASE
          WHEN delivery_monitor_shipments.status IS DISTINCT FROM EXCLUDED.status
            OR delivery_monitor_shipments.is_delayed IS DISTINCT FROM EXCLUDED.is_delayed
          THEN NULL ELSE delivery_monitor_shipments.acknowledged_at END,
        acknowledged_by = CASE
          WHEN delivery_monitor_shipments.status IS DISTINCT FROM EXCLUDED.status
            OR delivery_monitor_shipments.is_delayed IS DISTINCT FROM EXCLUDED.is_delayed
          THEN NULL ELSE delivery_monitor_shipments.acknowledged_by END,
        last_checked_at = now(),
        last_check_error = NULL,
        updated_at = now()
      RETURNING ${SHIPMENT_COLUMNS}
    `, [
      input.labelId, input.fulfillmentId, input.orderId, input.orderNumber, input.customerName,
      input.trackingNumber, input.carrierCode, input.serviceCode, input.shippedAt,
      input.estimatedDeliveryAt, input.deliveredAt, input.lastEventAt,
      input.lastEventDescription, input.status, input.statusDescription,
      input.exceptionDescription, input.daysInTransit, input.delayed, input.alertKind,
    ]);
    return itemFromRow(result.rows[0]!);
  }

  async recordCheckFailure(labelId: string, message: string): Promise<void> {
    await this.database.query(`
      UPDATE delivery_monitor_shipments
      SET last_checked_at = now(), last_check_error = $2, updated_at = now()
      WHERE label_id = $1
    `, [labelId, message.slice(0, 1000)]);
  }

  async recordAlert(input: {
    labelId: string;
    eventId: string;
    sent: boolean;
    error: string | null;
  }): Promise<void> {
    await this.database.query(`
      UPDATE delivery_monitor_shipments
      SET alert_event_id = $2::uuid,
        alert_sent_at = CASE WHEN $3::boolean THEN now() ELSE alert_sent_at END,
        alert_error = $4,
        updated_at = now()
      WHERE label_id = $1
    `, [input.labelId, input.eventId, input.sent, input.error?.slice(0, 1000) || null]);
  }

  async acknowledge(labelId: string, actorId: string): Promise<DeliveryMonitorItem | null> {
    const result = await this.database.query<ShipmentRow>(`
      UPDATE delivery_monitor_shipments
      SET acknowledged_at = now(), acknowledged_by = $2, updated_at = now()
      WHERE label_id = $1
      RETURNING ${SHIPMENT_COLUMNS}
    `, [labelId, actorId.slice(0, 100)]);
    return result.rows[0] ? itemFromRow(result.rows[0]) : null;
  }
}
