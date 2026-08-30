import { Currency } from "../../generated/prisma/client.js";

// ─── API ──────────────────────────────────────────────────────

export const API_PREFIX = "/api/v1";

export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100,
} as const;

// ─── Common Currencies ────────────────────────────────────────

export const SUPPORTED_CURRENCIES: Currency[] = Object.values(Currency);

export const DEFAULT_CURRENCY = Currency.USD;

// ─── Category Colors ─────────────────────────────────────────

/** Suggested hex color palette for categories (used in validation and UI). */
export const CATEGORY_COLORS = [
  "#10B981",
  "#F59E0B",
  "#06B6D4",
  "#8B5CF6",
  "#F43F5E",
  "#EC4899",
  "#6366F1",
  "#D946EF",
  "#14B8A6",
  "#EAB308",
  "#3B82F6",
  "#EF4444",
  "#F97316",
  "#A855F7",
  "#E879F9",
  "#22C55E",
  "#64748B",
  "#94A3B8",
] as const;

// ─── Category Icon Names ─────────────────────────────────────

/** Allowed Lucide icon names for categories (used in validation). */
export const CATEGORY_ICONS = [
  "Tag",
  "UtensilsCrossed",
  "Car",
  "Home",
  "Zap",
  "Film",
  "Heart",
  "Cloud",
  "Wine",
  "ShoppingBag",
  "Briefcase",
  "GraduationCap",
  "Plane",
  "Gift",
  "PawPrint",
  "Dumbbell",
  "BookOpen",
  "Sparkles",
  "Apple",
  "Repeat",
  "Shield",
  "TrendingUp",
  "MoreHorizontal",
] as const;

// ─── Regular Expressions ──────────────────────────────────────

export const REGEX = {
  /** UUID v4 format */
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /** ISO 8601 date (YYYY-MM-DD) */
  DATE: /^\d{4}-\d{2}-\d{2}$/,
  /** Hexadecimal color */
  HEX_COLOR: /^#[0-9a-fA-F]{6}$/,
} as const;

// ─── System Category Defaults ─────────────────────────────────

export const SYSTEM_CATEGORIES = [
  { name: "Food & Dining", icon: "UtensilsCrossed", color: "#F59E0B" },
  { name: "Transportation", icon: "Car", color: "#06B6D4" },
  { name: "Housing & Rent", icon: "Home", color: "#8B5CF6" },
  { name: "Utilities", icon: "Zap", color: "#10B981" },
  { name: "Entertainment", icon: "Film", color: "#F43F5E" },
  { name: "Healthcare", icon: "Heart", color: "#EC4899" },
  { name: "Shopping", icon: "ShoppingBag", color: "#F97316" },
  { name: "Education", icon: "BookOpen", color: "#A855F7" },
  { name: "Travel", icon: "Plane", color: "#14B8A6" },
  { name: "Personal Care", icon: "Sparkles", color: "#E879F9" },
  { name: "Groceries", icon: "Apple", color: "#22C55E" },
  { name: "Subscriptions", icon: "Repeat", color: "#3B82F6" },
  { name: "Insurance", icon: "Shield", color: "#64748B" },
  { name: "Savings & Investments", icon: "TrendingUp", color: "#10B981" },
  { name: "Income", icon: "Briefcase", color: "#22C55E" },
  { name: "Other", icon: "MoreHorizontal", color: "#94A3B8" },
] as const;

// ─── Default Onboarding Categories ──────────────────────────

/**
 * Starter categories auto-created for every new user on registration.
 * These are marked as isSystem so they cannot be renamed or deleted.
 */
export const DEFAULT_CATEGORIES = [
  { name: "Food", icon: "UtensilsCrossed", color: "#F59E0B" },
  { name: "Transportation", icon: "Car", color: "#06B6D4" },
  { name: "Shopping", icon: "ShoppingBag", color: "#F97316" },
  { name: "Salary", icon: "Briefcase", color: "#22C55E" },
  { name: "Entertainment", icon: "Film", color: "#F43F5E" },
  { name: "Health", icon: "Heart", color: "#EC4899" },
  { name: "Housing", icon: "Home", color: "#8B5CF6" },
  { name: "Utilities", icon: "Zap", color: "#10B981" },
  { name: "Other", icon: "MoreHorizontal", color: "#94A3B8" },
] as const;

// ─── Payment Method Colors ──────────────────────────────────

/** Suggested hex color palette for payment methods. */
export const PAYMENT_METHOD_COLORS = [
  "#3B82F6",
  "#8B5CF6",
  "#10B981",
  "#F59E0B",
  "#EC4899",
  "#F43F5E",
  "#6366F1",
  "#14B8A6",
  "#D946EF",
  "#EAB308",
  "#06B6D4",
  "#A855F7",
  "#F97316",
  "#22C55E",
  "#64748B",
  "#94A3B8",
] as const;

// ─── Payment Method Icon Names ──────────────────────────────

/** Allowed Lucide icon names for payment methods. */
export const PAYMENT_METHOD_ICONS = [
  "CreditCard",
  "Wallet",
  "Building2",
  "Landmark",
  "Smartphone",
  "Banknote",
  "CircleDollarSign",
  "PiggyBank",
  "Shield",
  "Zap",
  "Vault",
  "BadgeCheck",
] as const;

// ─── Default Onboarding Payment Methods ────────────────────

/**
 * Starter payment methods auto-created for every new user on registration.
 */
export const DEFAULT_PAYMENT_METHODS = [
  { name: "Cash", type: "CASH" as const, icon: "Wallet", color: "#10B981" },
  { name: "Credit Card", type: "CREDIT_CARD" as const, icon: "CreditCard", color: "#3B82F6" },
  { name: "Debit Card", type: "DEBIT_CARD" as const, icon: "CreditCard", color: "#8B5CF6" },
  { name: "Bank Account", type: "BANK_TRANSFER" as const, icon: "Building2", color: "#F59E0B" },
  { name: "Digital Wallet", type: "DIGITAL_WALLET" as const, icon: "Smartphone", color: "#EC4899" },
] as const;

// ─── Notification Defaults ────────────────────────────────────

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  budgetAlerts: true,
  emailWarnings: true,
  weeklyDigest: false,
} as const;
