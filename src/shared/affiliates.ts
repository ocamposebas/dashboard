export type AffiliateStatus = "pending_invite" | "active" | "suspended" | "closed";
export type AffiliatePayoutStatus = "requested" | "approved" | "processing" | "paid" | "rejected" | "cancelled";
export type AffiliateApplicationStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type AffiliateCommissionStatus = "reserved" | "pending" | "approved" | "paid" | "reversed";

export interface LegacyAffiliateCoupon {
  wpCouponId: number;
  wpUserId: number;
  code: string;
  status: "active" | "paused" | "expired" | "archived";
  discountType: "percent" | "fixed_cart" | "fixed_product";
  discountValue: number;
  commissionType: "percent" | "fixed";
  commissionValue: number;
  usageCount: number;
  grossSales: number;
  totalDiscount: number;
  totalCommission: number;
  availableCommission: number;
  pendingPayout: number;
  referralUrl: string;
  displayName: string;
  username: string;
  email: string;
}

export interface AffiliateCouponSummary {
  id: string;
  wpCouponId: number | null;
  code: string;
  status: string;
  discountValue: number;
  commissionValue: number;
  usageCount: number;
  referralUrl: string;
}

export interface AffiliateSummary {
  id: string;
  wpUserId: number | null;
  displayName: string;
  username: string;
  email: string;
  status: AffiliateStatus;
  source: string;
  grossSales: number;
  totalCommission: number;
  availableBalance: number;
  pendingPayout: number;
  paidPayouts: number;
  shadowOrders: number;
  shadowSales: number;
  shadowCommission: number;
  coupons: AffiliateCouponSummary[];
  joinedAt: string | null;
  lastLoginAt: string | null;
}

export interface AffiliateShadowSummary {
  mode: "shadow";
  enabled: boolean;
  startedAt: string | null;
  lastSyncedAt: string | null;
  trackedOrders: number;
  trackedSales: number;
  trackedCommission: number;
  reservedOrders: number;
  pendingOrders: number;
  approvedOrders: number;
  reversedOrders: number;
  pluginOrderDelta: number;
  pluginSalesDelta: number;
  pluginCommissionDelta: number;
  commissionVariance: number;
  commissionVariancePercent: number | null;
  status: "not_started" | "collecting" | "aligned" | "review";
}

export interface AffiliatePayoutSummary {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  amount: number;
  currency: string;
  status: AffiliatePayoutStatus;
  payoutMethod: string;
  payoutDestination: string;
  note: string;
  externalReference: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
}

export interface AffiliateApplicationSummary {
  id: string;
  wpUserId: number | null;
  displayName: string;
  email: string;
  preferredCoupon: string;
  platform: string;
  socialHandle: string;
  audienceSize: string;
  promotionNotes: string;
  source: "public_form" | "account_form";
  status: AffiliateApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AffiliateCommissionSummary {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  couponCode: string;
  orderId: number;
  orderNumber: string;
  currency: string;
  orderTotal: number;
  eligibleAmount: number;
  commissionType: "percent" | "fixed";
  commissionRate: number;
  commissionAmount: number;
  status: AffiliateCommissionStatus;
  orderStatus: string;
  heldUntil: string | null;
  approvedAt: string | null;
  reversedAt: string | null;
  attributedAt: string;
  updatedAt: string;
}

export interface AffiliateAdminDirectory {
  configured: boolean;
  source: "phaseone";
  syncedAt: string;
  metrics: {
    affiliates: number;
    activeAffiliates: number;
    couponUses: number;
    grossSales: number;
    totalCommission: number;
    availableBalance: number;
    pendingPayoutAmount: number;
    pendingPayoutRequests: number;
  };
  settings: {
    defaultCommissionRate: number;
    minimumPayout: number;
    approvalHoldDays: number;
    currency: string;
  };
  shadow: AffiliateShadowSummary;
  management: {
    couponProvisioningEnabled: boolean;
  };
  affiliates: AffiliateSummary[];
  commissions: AffiliateCommissionSummary[];
  payouts: AffiliatePayoutSummary[];
  applications: AffiliateApplicationSummary[];
}

export interface AffiliatePortalDashboard {
  affiliate: AffiliateSummary;
  settings: AffiliateAdminDirectory["settings"];
  payouts: AffiliatePayoutSummary[];
  recentCommissions: Array<{
    id: string;
    orderNumber: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
  }>;
}
